import { v4 as uuidv4 } from "uuid";
import { getWorkflow, getWorkflowInstance } from "./workflows";
import {
  KNode,
  KEdge,
  Graph,
  EdgeType,
  ParentNode,
  LogicNode,
  SubWorkflowNode,
  RefSwitchNode,
  WorkflowNode,
  ValueFunctionNode,
  ResourceFunctionNode,
  FunctionNode,
  ManagedKubernetesResource,
} from "../types/graph";
import {
  Step,
  ConfigStep,
  WorkflowParent,
  Workflow,
  RefSwitch,
} from "../types/workflow";
import { getResourceFunction, getValueFunction } from "./functions";
import { ValueFunction, ResourceFunction } from "../types/function";
import { KubernetesObjectWithSpecAndStatus } from "../types/kubernetes";
import {
  ManagedResources,
  ManagedResource,
  KubernetesResource,
} from "../types/managed-resource";
import {
  parseManagedResources,
  isKubernetesResource,
  isKubernetesResourceArray,
  isKubernetesResourceOrManagedResourcesArray,
  isManagedResources,
  isManagedResourcesArray,
} from "./managed-resources";
import { getK8sObjectApi } from "./kubernetes";

const WORKFLOW_STEP_DEPENDENCY_REGEX = /=steps\.([a-zA-Z0-9_-]+)\.?.*/;
const DEFAULT_CONFIG_STEP_LABEL = "config";

type DedupedGraph = {
  nodes: Record<string, KNode>;
  edges: Record<string, KEdge>;
  managedResources: ManagedKubernetesResource[];
};

export const getWorkflowGraph = async (
  namespace: string,
  workflowId: string,
  instanceId?: string
): Promise<Graph> => {
  const { graph } = await getWorkflowGraphWithLeafNodes(
    namespace,
    workflowId,
    undefined,
    instanceId
  );
  return graph;
};

const getWorkflowGraphWithLeafNodes = async (
  namespace: string,
  workflowId: string,
  stepLabel?: string,
  instanceId?: string,
  managedResources?: ManagedResources
): Promise<{
  graph: Graph;
  leafNodes: string[];
}> => {
  const graph: DedupedGraph = { nodes: {}, edges: {}, managedResources: [] };
  const leafNodes: string[] = [];
  const stepNodes: Record<string, string> = {}; // Map step label to node id

  const workflow = await getWorkflow(workflowId, namespace);
  if (!workflow) {
    return { graph: dedupedGraphToGraph(graph), leafNodes };
  }

  // Create a node for the Workflow itself.
  const workflowNode = createWorkflowNode(workflow, stepLabel);
  graph.nodes[workflowNode.id] = workflowNode;

  // Create a node for the Workflow parent if an instanceId is specified with
  // an edge to the Workflow node. Also parse the ManagedResources on the
  // parent.
  let parentNode = undefined;
  if (instanceId) {
    const parent = await getWorkflowInstance(workflow, instanceId);
    if (!parent) {
      return {
        graph: dedupedGraphToGraph(graph),
        leafNodes,
      };
    }
    parentNode = createParentNode(parent);
    graph.nodes[parentNode.id] = parentNode;
    const parentEdge = createEdge(
      parentNode.id,
      workflowNode.id,
      "ParentToWorkflow"
    );
    graph.edges[parentEdge.id] = parentEdge;
    managedResources = parseManagedResources(parent);
  }

  const allSteps: (Step | ConfigStep)[] = [];
  if (workflow.spec.configStep) {
    allSteps.push(workflow.spec.configStep);
  }
  allSteps.push(...workflow.spec.steps);

  // Create nodes for all steps.
  for (const step of allSteps) {
    await addStepNodes(namespace, step, graph, stepNodes, managedResources);
  }

  // For each step, create edges back to the nodes for the steps it depends on.
  // If the step doesn't depend on anything, then create an edge back to the
  // Workflow since this indicates it's a root step.
  const nodesWithDependents = new Set<string>();
  allSteps.forEach((step) => {
    const stepLabel = step.label || DEFAULT_CONFIG_STEP_LABEL;
    let hasDependency = false;
    const stepNode = stepNodes[stepLabel];
    if (!stepNode) {
      return;
    }

    if (step.inputs) {
      Object.values(step.inputs).forEach((inputValue) => {
        if (typeof inputValue !== "string") {
          return;
        }
        const match = inputValue.match(WORKFLOW_STEP_DEPENDENCY_REGEX);
        if (match) {
          hasDependency = true;
          const parentLabel = match[1];
          const parentNode = stepNodes[parentLabel];
          if (!parentNode) {
            return;
          }
          const edge = createEdge(parentNode, stepNode, "StepToStep");
          graph.edges[edge.id] = edge;
          nodesWithDependents.add(parentNode);
        }
      });
    }

    if (hasDependency) {
      return;
    }

    // It's a root step so add an edge back to the Workflow.
    const edge = createEdge(workflowNode.id, stepNode, "WorkflowToStep");
    graph.edges[edge.id] = edge;
  });

  // Calculate leaf nodes by taking the difference of all nodes and nodes with
  // dependents.
  const allNodes = new Set(Object.values(stepNodes));
  leafNodes.push(
    ...Array.from(
      new Set([...allNodes].filter((node) => !nodesWithDependents.has(node)))
    )
  );

  return { graph: dedupedGraphToGraph(graph), leafNodes };
};

const addStepNodes = async (
  namespace: string,
  step: Step | ConfigStep,
  graph: DedupedGraph,
  stepNodes: Record<string, string>,
  managedResources?: ManagedResources
) => {
  if (!("ref" in step) && !("refSwitch" in step)) {
    // This is an invalid step.
    return;
  }

  const stepLabel = step.label || DEFAULT_CONFIG_STEP_LABEL;

  if ("refSwitch" in step && step.refSwitch) {
    // Handle refSwitch step.
    await addRefSwitchNode(
      graph,
      stepNodes,
      step.refSwitch,
      namespace,
      stepLabel,
      managedResources?.[stepLabel]
    );
    return;
  }

  // Step has to be a ref because of the preceding checks.
  if (step.ref!.kind === "Workflow") {
    // Recurse on sub-Workflow and add its nodes/edges.
    const subWorkflowNode = await getSubWorkflowNode(
      namespace,
      stepLabel,
      step.ref!.name,
      managedResources?.[stepLabel]
    );
    if (subWorkflowNode) {
      graph.nodes[subWorkflowNode.id] = subWorkflowNode;
      stepNodes[stepLabel] = subWorkflowNode.id;
      if (subWorkflowNode.workflowGraph.managedResources) {
        graph.managedResources.push(
          ...subWorkflowNode.workflowGraph.managedResources
        );
      }
    }
    return;
  }

  // Handle simple Function step.
  let stepNode: FunctionNode | null;
  if (step.ref!.kind === "ValueFunction") {
    stepNode = await getValueFunctionNode(namespace, step.ref!.name, stepLabel);
  } else {
    stepNode = await getResourceFunctionNode(
      namespace,
      step.ref!.name,
      stepLabel,
      managedResources?.[stepLabel]
    );
    if (stepNode && stepNode.managedResources) {
      graph.managedResources.push(...stepNode.managedResources);
    }
  }
  if (stepNode) {
    graph.nodes[stepNode.id] = stepNode;
    stepNodes[stepLabel] = stepNode.id;
  }
};

const getValueFunctionNode = async (
  namespace: string,
  name: string,
  stepLabel: string
): Promise<ValueFunctionNode | null> => {
  const func = await getValueFunction(name, namespace);
  if (!func) {
    return null;
  }

  return createValueFunctionNode(func, stepLabel);
};

const getResourceFunctionNode = async (
  namespace: string,
  name: string,
  stepLabel: string,
  managedResource?: ManagedResource
): Promise<ResourceFunctionNode | null> => {
  const func = await getResourceFunction(name, namespace);
  if (!func) {
    return null;
  }

  const node = createResourceFunctionNode(func as ResourceFunction, stepLabel);

  if (!managedResource) {
    return node;
  }

  node.managedResources = [];

  // Plain ResourceFunction
  if (isKubernetesResource(managedResource)) {
    const k8sResource = await addManagedResource(
      managedResource,
      node as ResourceFunctionNode
    );
    if (k8sResource) {
      node.managedResources.push(k8sResource);
    }
    return node;
  }

  // forEach on a ResourceFunction
  if (isKubernetesResourceArray(managedResource)) {
    const results = await Promise.all(
      managedResource.map((resource) =>
        addManagedResource(resource, node as ResourceFunctionNode)
      )
    );
    node.managedResources.push(
      ...results.filter((k8sResource) => k8sResource !== null)
    );
    return node;
  }

  // forEach on a refSwitch
  if (isKubernetesResourceOrManagedResourcesArray(managedResource)) {
    const results = await Promise.all(
      managedResource
        .filter((k8sResourceOrManagedResources) =>
          isKubernetesResource(k8sResourceOrManagedResources)
        )
        .map((resource) =>
          addManagedResource(
            resource as KubernetesResource,
            node as ResourceFunctionNode
          )
        )
    );
    node.managedResources.push(
      ...results.filter((k8sResource) => k8sResource !== null)
    );
    return node;
  }

  return node;
};

const addManagedResource = async (
  managedResource: KubernetesResource,
  parentNode: ResourceFunctionNode
): Promise<ManagedKubernetesResource | null> => {
  const k8sResource = await getKubernetesResource(managedResource);
  if (!k8sResource) {
    return null;
  }
  if (!parentNode.managedResources) {
    parentNode.managedResources = [];
  }
  const resource = {
    resource: k8sResource,
    readonly: managedResource.readonly,
  };
  parentNode.managedResources.push(resource);
  return resource;
};

const getSubWorkflowNode = async (
  namespace: string,
  stepLabel: string,
  subWorkflowId: string,
  managedResource?: ManagedResource
): Promise<SubWorkflowNode | null> => {
  if (!managedResource) {
    const { graph: workflowGraph, leafNodes } =
      await getWorkflowGraphWithLeafNodes(namespace, subWorkflowId, stepLabel);

    if (!workflowGraph.nodes) {
      return null;
    }

    const subWorkflowNode = createSubWorkflowNode(
      workflowGraph.nodes[0] as WorkflowNode,
      workflowGraph,
      leafNodes
    );
    return subWorkflowNode;
  }

  if (isManagedResources(managedResource)) {
    // Simple sub-workflow
    const { graph: workflowGraph, leafNodes } =
      await getWorkflowGraphWithLeafNodes(
        namespace,
        subWorkflowId,
        stepLabel,
        undefined,
        managedResource
      );

    if (!workflowGraph.nodes) {
      return null;
    }

    const subWorkflowNode = createSubWorkflowNode(
      workflowGraph.nodes[0] as WorkflowNode,
      workflowGraph,
      leafNodes
    );
    return subWorkflowNode;
  }

  if (isManagedResourcesArray(managedResource)) {
    // forEach on a sub-workflow
    let subWorkflowNode: SubWorkflowNode | null = null;
    const subWorkflowResources: ManagedKubernetesResource[] = [];
    for (const iterationManagedResources of managedResource) {
      const { graph: workflowGraph, leafNodes } =
        await getWorkflowGraphWithLeafNodes(
          namespace,
          subWorkflowId,
          stepLabel,
          undefined,
          iterationManagedResources
        );

      if (workflowGraph.managedResources) {
        subWorkflowResources.push(...workflowGraph.managedResources);
      }

      if (!subWorkflowNode) {
        if (!workflowGraph.nodes) {
          return null;
        }

        subWorkflowNode = createSubWorkflowNode(
          workflowGraph.nodes[0] as WorkflowNode,
          workflowGraph,
          leafNodes
        );
      }
    }
    if (!subWorkflowNode) {
      return null;
    }
    subWorkflowNode.workflowGraph.managedResources = subWorkflowResources;
    return subWorkflowNode;
  }

  if (isKubernetesResourceOrManagedResourcesArray(managedResource)) {
    // forEach on a refSwitch

    // First get the graph structure
    const { graph: workflowGraph, leafNodes } =
      await getWorkflowGraphWithLeafNodes(namespace, subWorkflowId, stepLabel);
    if (!workflowGraph.nodes) {
      return null;
    }
    const subWorkflowNode = createSubWorkflowNode(
      workflowGraph.nodes[0] as WorkflowNode,
      workflowGraph,
      leafNodes
    );

    // Get the managed resources for each iteration.
    // NOTE: this currently has an issue if there are multiple switch cases
    // that are sub-workflows because we can't distinguish which managed
    // resources to pass down.
    const subWorkflowResources: ManagedKubernetesResource[] = [];
    const subWorkflowManagedResources = managedResource.filter(
      (k8sResourceOrManagedResources) =>
        isManagedResources(k8sResourceOrManagedResources)
    );
    for (const iterationManagedResources of subWorkflowManagedResources) {
      const { graph: workflowGraph } = await getWorkflowGraphWithLeafNodes(
        namespace,
        subWorkflowId,
        stepLabel,
        undefined,
        iterationManagedResources as ManagedResources
      );

      if (workflowGraph.managedResources) {
        subWorkflowResources.push(...workflowGraph.managedResources);
      }
    }
    if (!subWorkflowNode) {
      return null;
    }
    subWorkflowNode.workflowGraph.managedResources = subWorkflowResources;
    return subWorkflowNode;
  }

  return null;
};

const getKubernetesResource = async (
  resource: KubernetesResource
): Promise<KubernetesObjectWithSpecAndStatus | null> => {
  const k8sApi = getK8sObjectApi();

  try {
    const response = await k8sApi.read({
      apiVersion: resource.apiVersion,
      kind: resource.kind,
      metadata: {
        name: resource.name,
        namespace: resource.namespace,
      },
    });

    return response as KubernetesObjectWithSpecAndStatus;
  } catch (err) {
    console.error(
      `Failed to get resource ${resource.kind}/${resource.name}: ${err}`
    );
    return null;
  }
};

const addRefSwitchNode = async (
  graph: DedupedGraph,
  stepNodes: Record<string, string>,
  refSwitch: RefSwitch,
  namespace: string,
  stepLabel: string,
  managedResource?: ManagedResource
) => {
  const caseNodes: Record<string, LogicNode> = {};
  const refSwitchResources: ManagedKubernetesResource[] = [];
  for (const switchCase of refSwitch.cases || []) {
    let logicNode: LogicNode | null;
    if (switchCase.kind === "Workflow") {
      // Recurse on sub-workflow and add its nodes/edges.
      const subWorkflowNode = await getSubWorkflowNode(
        namespace,
        stepLabel,
        switchCase.name,
        managedResource
      );
      logicNode = subWorkflowNode;
      if (subWorkflowNode?.workflowGraph.managedResources) {
        refSwitchResources.push(
          ...subWorkflowNode.workflowGraph.managedResources
        );
      }
    } else {
      if (switchCase.kind === "ValueFunction") {
        logicNode = await getValueFunctionNode(
          namespace,
          switchCase.name,
          stepLabel
        );
      } else {
        const resourceFuncNode = await getResourceFunctionNode(
          namespace,
          switchCase.name,
          stepLabel,
          managedResource
        );
        logicNode = resourceFuncNode;
        if (resourceFuncNode?.managedResources) {
          refSwitchResources.push(...resourceFuncNode.managedResources);
        }
      }
    }
    if (logicNode) {
      caseNodes[switchCase.case] = logicNode;
    }
  }
  const refSwitchNode = createRefSwitchNode(
    refSwitch.switchOn,
    caseNodes,
    refSwitchResources,
    stepLabel
  );
  graph.nodes[refSwitchNode.id] = refSwitchNode;
  stepNodes[stepLabel] = refSwitchNode.id;
  graph.managedResources.push(...refSwitchResources);
  return;
};

const createWorkflowNode = (
  workflow: Workflow,
  stepLabel?: string
): WorkflowNode => {
  return {
    id: workflow.metadata?.uid || uuidv4(),
    krm: workflow,
    type: "Workflow",
    metadata: stepLabel ? { label: stepLabel } : undefined,
  };
};

const createValueFunctionNode = (
  logic: ValueFunction,
  stepLabel?: string
): ValueFunctionNode => {
  return {
    id: logic.metadata?.uid || uuidv4(),
    krm: logic,
    type: "ValueFunction",
    metadata: stepLabel ? { label: stepLabel } : undefined,
  };
};

const createResourceFunctionNode = (
  logic: ResourceFunction,
  stepLabel?: string
): ResourceFunctionNode => {
  return {
    id: logic.metadata?.uid || uuidv4(),
    krm: logic,
    type: "ResourceFunction",
    metadata: stepLabel ? { label: stepLabel } : undefined,
  };
};

const createParentNode = (parent: WorkflowParent): ParentNode => {
  return {
    id: parent.metadata?.uid || uuidv4(),
    krm: parent,
    type: "Parent",
  };
};

const createRefSwitchNode = (
  switchOn: string,
  caseNodes: Record<string, LogicNode>,
  managedResources: ManagedKubernetesResource[],
  stepLabel?: string
): RefSwitchNode => {
  const id = `switch-${Object.values(caseNodes)
    .map((caseNode) => caseNode.id)
    .join("-")}`;
  return {
    id: id,
    type: "RefSwitch",
    switchOn: switchOn,
    caseNodes: caseNodes,
    managedResources: managedResources,
    metadata: stepLabel ? { label: stepLabel } : undefined,
  };
};

const createSubWorkflowNode = (
  workflowNode: WorkflowNode,
  workflowGraph: Graph,
  workflowLeafNodeIds: string[]
): SubWorkflowNode => {
  const id = workflowNode.krm.metadata?.uid
    ? `sub-${workflowNode.krm.metadata.uid}`
    : `sub-${uuidv4()}`;
  return {
    id: id,
    workflowGraph,
    workflowLeafNodeIds,
    type: "SubWorkflow",
  };
};

const createEdge = (
  sourceId: string,
  targetId: string,
  type: EdgeType
): KEdge => {
  return {
    id: `${sourceId}:${targetId}`,
    source: sourceId,
    target: targetId,
    type: type,
  };
};

const dedupedGraphToGraph = (dedupedGraph: DedupedGraph): Graph => {
  return {
    nodes: Object.values(dedupedGraph.nodes),
    edges: Object.values(dedupedGraph.edges),
    managedResources: dedupedGraph.managedResources
      ? dedupedGraph.managedResources
      : undefined,
  };
};
