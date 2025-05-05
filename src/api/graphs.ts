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
import { Step, WorkflowParent, Workflow, RefSwitch } from "../types/workflow";
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
  isKubernetesResourceOrManagedResourcesArray,
  isManagedResources,
} from "./managed-resources";
import { getK8sObjectApi } from "./kubernetes";

const WORKFLOW_STEP_DEPENDENCY_REGEX = /steps\.([a-zA-Z0-9_-]+)/g;

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
    const parentEdge = createEdge(parentNode, workflowNode, "ParentToWorkflow");
    graph.edges[parentEdge.id] = parentEdge;
    managedResources = parseManagedResources(parent);
  }

  // Create nodes for all steps.
  await Promise.all(
    workflow.spec.steps.map((step) =>
      addStepNodes(namespace, step, graph, stepNodes, managedResources)
    )
  );

  // For each step, create edges back to the nodes for the steps it depends on.
  // If the step doesn't depend on anything, then create an edge back to the
  // Workflow since this indicates it's a root step.
  const nodesWithDependents = new Set<string>();
  workflow.spec.steps.forEach((step) => {
    const stepLabel = step.label;
    let hasDependency = false;
    const stepNodeId = stepNodes[stepLabel];
    if (!stepNodeId || !graph.nodes[stepNodeId]) {
      return;
    }
    const stepNode = graph.nodes[stepNodeId];

    if (step.inputs) {
      hasDependency = findAndAddStepDependencies(
        step.inputs,
        stepNode,
        stepNodes,
        graph,
        nodesWithDependents
      );
    }

    // If the step has a forEach, ensure we account for itemIn expressions
    // when computing dependencies.
    if (step.forEach) {
      hasDependency =
        findAndAddStepDependencies(
          step.forEach.itemIn,
          stepNode,
          stepNodes,
          graph,
          nodesWithDependents
        ) || hasDependency;
    }

    // Same for refSwitch switchOn expressions.
    if (step.refSwitch) {
      hasDependency =
        findAndAddStepDependencies(
          step.refSwitch.switchOn,
          stepNode,
          stepNodes,
          graph,
          nodesWithDependents
        ) || hasDependency;
    }

    if (hasDependency) {
      return;
    }

    // It's a root step so add an edge back to the Workflow.
    const edge = createEdge(workflowNode, stepNode, "WorkflowToStep");
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

const findAndAddStepDependencies = (
  value: unknown,
  stepNode: KNode,
  stepNodes: Record<string, string>,
  graph: DedupedGraph,
  nodesWithDependents: Set<string>
): boolean => {
  let foundDependency = false;

  const processValue = (val: unknown) => {
    if (typeof val === "string" && val.trim().startsWith("=")) {
      const matches = [...val.matchAll(WORKFLOW_STEP_DEPENDENCY_REGEX)];
      matches.forEach((match) => {
        const parentLabel = match[1];
        const parentNodeId = stepNodes[parentLabel];
        if (parentNodeId && graph.nodes[parentNodeId]) {
          const edge = createEdge(
            graph.nodes[parentNodeId],
            stepNode,
            "StepToStep"
          );
          graph.edges[edge.id] = edge;
          nodesWithDependents.add(parentNodeId);
        }
        foundDependency = true;
      });
    } else if (Array.isArray(val)) {
      val.forEach((item) => processValue(item));
    } else if (typeof val === "object" && val !== null) {
      Object.values(val).forEach((nestedVal) => processValue(nestedVal));
    }
  };

  processValue(value);
  return foundDependency;
};

const addStepNodes = async (
  namespace: string,
  step: Step,
  graph: DedupedGraph,
  stepNodes: Record<string, string>,
  managedResources?: ManagedResources
) => {
  if (!step.refSwitch && !step.ref) {
    // This is an invalid step.
    return;
  }

  const stepLabel = step.label;

  if (step.refSwitch) {
    // Handle refSwitch step.
    await addRefSwitchNode(
      graph,
      stepNodes,
      step.refSwitch,
      namespace,
      stepLabel,
      managedResources?.resources?.[stepLabel]
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
      getManagedResourcesForWorkflow(
        step.ref!.name,
        managedResources?.resources?.[stepLabel]
      )
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
      getManagedResourcesForResourceFunction(
        step.ref!.name,
        managedResources?.resources?.[stepLabel]
      )
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
  managedResource?: KubernetesResource[] // it's a list because it could be within a forEach
): Promise<ResourceFunctionNode | null> => {
  const func = await getResourceFunction(name, namespace);
  if (!func) {
    return null;
  }

  const node = createResourceFunctionNode(func as ResourceFunction, stepLabel);

  if (!managedResource) {
    return node;
  }

  await Promise.all(
    managedResource.map((resource) => addManagedResource(resource, node))
  );

  return node;
};

const addManagedResource = async (
  managedResource: KubernetesResource,
  parentNode: ResourceFunctionNode
) => {
  const k8sResource = await getKubernetesResource(managedResource);
  if (!k8sResource) {
    return;
  }
  if (!parentNode.managedResources) {
    parentNode.managedResources = [];
  }
  const resource = {
    resource: k8sResource,
    readonly: managedResource.readonly,
  };
  parentNode.managedResources.push(resource);
};

const getSubWorkflowNode = async (
  namespace: string,
  stepLabel: string,
  subWorkflowId: string,
  managedResources?: ManagedResources[] // it's a list because it could be within a forEach
): Promise<SubWorkflowNode | null> => {
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

  if (!managedResources) {
    return subWorkflowNode;
  }

  // Get the managed resources for each iteration.
  const subWorkflowResources: ManagedKubernetesResource[] = [];
  for (const iterationManagedResources of managedResources) {
    const { graph: workflowGraph } = await getWorkflowGraphWithLeafNodes(
      namespace,
      subWorkflowId,
      stepLabel,
      undefined,
      iterationManagedResources
    );

    // We need to add all the managed resources from the iteration's
    // ResourceFunctions and add them to the SubWorkflowNode we return. This is
    // a bit hacky...
    subWorkflowNode.workflowGraph.nodes.forEach((node) => {
      workflowGraph.nodes.forEach((iterationNode) => {
        if (
          node.id === iterationNode.id &&
          node.type === "ResourceFunction" &&
          iterationNode.type === "ResourceFunction" &&
          iterationNode.managedResources
        ) {
          if (!node.managedResources) {
            node.managedResources = [];
          }
          node.managedResources.push(...iterationNode.managedResources);
        }
      });
    });

    if (workflowGraph.managedResources) {
      subWorkflowResources.push(...workflowGraph.managedResources);
    }
  }
  subWorkflowNode.workflowGraph.managedResources = subWorkflowResources;
  return subWorkflowNode;
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

const getManagedResourcesForWorkflow = (
  workflowId: string,
  managedResource?: ManagedResource
): ManagedResources[] | undefined => {
  if (!managedResource) {
    return undefined;
  }

  if (
    isManagedResources(managedResource) &&
    managedResource.workflow === workflowId
  ) {
    return [managedResource];
  }

  if (isKubernetesResourceOrManagedResourcesArray(managedResource)) {
    const managedResources: ManagedResources[] = [];
    managedResource.forEach((k8sResourceOrManagedResources) => {
      if (
        isManagedResources(k8sResourceOrManagedResources) &&
        k8sResourceOrManagedResources.workflow === workflowId
      ) {
        managedResources.push(k8sResourceOrManagedResources);
      }
    });
    return managedResources;
  }

  return undefined;
};

const getManagedResourcesForResourceFunction = (
  functionId: string,
  managedResource?: ManagedResource
): KubernetesResource[] | undefined => {
  if (!managedResource) {
    return undefined;
  }

  if (
    isKubernetesResource(managedResource) &&
    managedResource.resourceFunction === functionId
  ) {
    return [managedResource];
  }

  if (isKubernetesResourceOrManagedResourcesArray(managedResource)) {
    const managedResources: KubernetesResource[] = [];
    managedResource.forEach((k8sResourceOrManagedResources) => {
      if (
        isKubernetesResource(k8sResourceOrManagedResources) &&
        k8sResourceOrManagedResources.resourceFunction === functionId
      ) {
        managedResources.push(k8sResourceOrManagedResources);
      }
    });
    return managedResources;
  }

  return undefined;
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
        getManagedResourcesForWorkflow(switchCase.name, managedResource)
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
          getManagedResourcesForResourceFunction(
            switchCase.name,
            managedResource
          )
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
    dependents: {},
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
    dependents: {},
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
    dependents: {},
    metadata: stepLabel ? { label: stepLabel } : undefined,
  };
};

const createParentNode = (parent: WorkflowParent): ParentNode => {
  return {
    id: parent.metadata?.uid || uuidv4(),
    krm: parent,
    type: "Parent",
    dependents: {},
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
    dependents: {},
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
    dependents: {},
  };
};

const createEdge = (source: KNode, target: KNode, type: EdgeType): KEdge => {
  source.dependents[target.id] = target;
  return {
    id: `${source.id}:${target.id}`,
    source: source.id,
    target: target.id,
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
