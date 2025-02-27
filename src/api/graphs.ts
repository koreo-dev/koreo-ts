import { v4 as uuidv4 } from "uuid";
import { getWorkflow } from "./workflows";
import {
  KNode,
  KEdge,
  WorkflowNode,
  FunctionNode,
  Graph,
} from "../types/graph";
import { Step, ConfigStep } from "../types/workflow";
import { getFunction } from "./functions";

const WORKFLOW_STEP_DEPENDENCY_REGEX = /=steps\.([a-zA-Z0-9_-]+)\.?.*/;

// Maps a step label to an object containing three things:
//
// 1) The node IDs for the nodes pertaining to the step which are used to link
// back to step nodes the step depends on according to its inputs.
//
// 2) The node IDs for "leaf nodes" for the step, i.e. the nodes that
// downstream steps that depend on the step should link back to. These are
// "leaf nodes" because in the case where the step is a sub-workflow, dependent
// steps should link to the leaf nodes of the sub-workflow. For
// non-sub-workflow cases this list is the same as the nodes list in practice.
//
// 3) The node IDs for any sub-workflows the step contains. This is used to
// create edges back from the sub-workflow node to the nodes for the steps it
// depends on based on its inputs.
type StepNodeIndex = Record<
  string,
  {
    nodeIds: string[];
    leafNodeIds: string[];
    subWorkflowNodeIds: string[];
  }
>;

const addStepNodeToIndex = (
  index: StepNodeIndex,
  nodeId: string,
  stepLabel: string
) => {
  if (!index[stepLabel]) {
    index[stepLabel] = { nodeIds: [], leafNodeIds: [], subWorkflowNodeIds: [] };
  }
  index[stepLabel].nodeIds.push(nodeId);
  index[stepLabel].leafNodeIds.push(nodeId);
};

const addSubWorkflowToIndex = (
  index: StepNodeIndex,
  subWorkflowNode: WorkflowNode | null,
  leafNodeIds: string[],
  stepLabel: string
) => {
  if (!subWorkflowNode) {
    return;
  }
  if (!index[stepLabel]) {
    index[stepLabel] = { nodeIds: [], leafNodeIds: [], subWorkflowNodeIds: [] };
  }
  index[stepLabel].subWorkflowNodeIds.push(subWorkflowNode.id);
  index[stepLabel].leafNodeIds.push(...leafNodeIds);
};

const getStepNodeIdsFromIndex = (
  index: StepNodeIndex,
  stepLabel: string
): string[] => {
  const stepIndex = index[stepLabel];
  if (!stepIndex) {
    return [];
  }
  const nodeIds = stepIndex.nodeIds;
  stepIndex.subWorkflowNodeIds.forEach((nodeId) => {
    nodeIds.push(nodeId);
  });

  return nodeIds;
};

const getStepLeafNodeIdsFromIndex = (
  index: StepNodeIndex,
  stepLabel: string
): string[] => {
  const stepIndex = index[stepLabel];
  if (!stepIndex) {
    return [];
  }
  return stepIndex.leafNodeIds;
};

type DedupedGraph = {
  nodes: Record<string, KNode>;
  edges: Record<string, KEdge>;
};

export const getWorkflowGraph = async (
  namespace: string,
  workflowId: string
): Promise<Graph> => {
  const dedupedGraph = await getDedupedWorkflowGraph(namespace, workflowId);
  return {
    nodes: Object.values(dedupedGraph.nodes),
    edges: Object.values(dedupedGraph.edges),
  };
};

const getDedupedWorkflowGraph = async (
  namespace: string,
  workflowId: string
): Promise<DedupedGraph> => {
  const { graph } = await getWorkflowGraphWithLeafNodes(namespace, workflowId);
  return graph;
};

const getWorkflowGraphWithLeafNodes = async (
  namespace: string,
  workflowId: string
): Promise<{
  workflowNode: WorkflowNode | null;
  graph: DedupedGraph;
  leafNodes: string[];
}> => {
  const graph: DedupedGraph = { nodes: {}, edges: {} };
  const leafNodes: string[] = [];
  const workflow = await getWorkflow(workflowId, namespace);
  if (workflow === null) {
    return { workflowNode: null, graph, leafNodes };
  }

  const workflowNode: WorkflowNode = {
    id: workflow.metadata?.uid || uuidv4(),
    workflow: workflow,
  };
  graph.nodes[workflowNode.id] = workflowNode;

  const stepNodeIndex: StepNodeIndex = {};

  const allSteps: Record<string, Step | ConfigStep> = {};
  if (workflow.spec.configStep) {
    allSteps[workflow.spec.configStep.label || "config"] =
      workflow.spec.configStep;
  }
  workflow.spec.steps.forEach((step) => (allSteps[step.label] = step));

  // Create nodes for all steps.
  for (const step of Object.values(allSteps)) {
    await addStepNodes(namespace, step, graph, stepNodeIndex);
  }

  // For each step, create edges back to the nodes for the steps it depends on.
  // If the step doesn't depend on anything, then create an edge back to the
  // workflow since this indicates it's a root step.
  const dependedOn = new Set<string>();
  const allNodes = new Set<string>();
  for (const step of Object.values(allSteps)) {
    const stepLabel = step.label || "config";
    let hasDependency = false;
    const nodesForStep = getStepNodeIdsFromIndex(stepNodeIndex, stepLabel);
    nodesForStep.forEach((node) => allNodes.add(node));

    if (step.inputs) {
      for (const inputValue of Object.values(step.inputs)) {
        if (typeof inputValue !== "string") {
          continue;
        }
        const match = inputValue.match(WORKFLOW_STEP_DEPENDENCY_REGEX);
        if (match) {
          hasDependency = true;
          const parentLabel = match[1];
          const parents = getStepLeafNodeIdsFromIndex(
            stepNodeIndex,
            parentLabel
          );
          nodesForStep?.forEach((stepNode) => {
            parents?.forEach((parent) => {
              const edge = {
                id: `${parent}:${stepNode}`,
                source: parent,
                target: stepNode,
              };
              graph.edges[edge.id] = edge;
              dependedOn.add(parent);
            });
          });
        }
      }
    }

    if (hasDependency) {
      continue;
    }

    // It's root step so add an edge back to the workflow for each of the
    // step's nodes.
    nodesForStep.forEach((stepNode) => {
      const edge = {
        id: `$(workflowNode.id}:${stepNode}`,
        source: workflowNode.id,
        target: stepNode,
      };
      graph.edges[edge.id] = edge;
    });
  }

  leafNodes.push(
    ...Array.from(
      new Set([...allNodes].filter((node) => !dependedOn.has(node)))
    )
  );

  return { workflowNode, graph, leafNodes };
};

const addStepNodes = async (
  namespace: string,
  step: Step | ConfigStep,
  graph: DedupedGraph,
  stepNodeIndex: StepNodeIndex
) => {
  if (!("ref" in step) && !("refSwitch" in step)) {
    return;
  }

  const stepLabel = step.label || "config";

  if ("refSwitch" in step && step.refSwitch) {
    // Handle refSwitch step.
    for (const switchCase of step.refSwitch.cases || []) {
      if (switchCase.kind === "Workflow") {
        // Recurse on sub-workflow and add its nodes/edges.
        await addSubWorkflowGraph(
          graph,
          stepNodeIndex,
          namespace,
          stepLabel,
          switchCase.name
        );
      } else {
        await addFunctionNode(
          namespace,
          switchCase.kind,
          switchCase.name,
          stepLabel,
          graph,
          stepNodeIndex
        );
      }
    }
    return;
  }

  // Step has to be a ref because of the preceding checks.
  if (step.ref!.kind === "Workflow") {
    // Recurse on sub-workflow and add its nodes/edges.
    await addSubWorkflowGraph(
      graph,
      stepNodeIndex,
      namespace,
      stepLabel,
      step.ref!.name
    );
    return;
  }

  // Handle simple Function step.
  await addFunctionStepNode(namespace, step, graph, stepNodeIndex);
};

const addFunctionStepNode = async (
  namespace: string,
  step: ConfigStep | Step,
  graph: DedupedGraph,
  stepNodeIndex: StepNodeIndex
) => {
  if (
    step.ref?.kind !== "ValueFunction" &&
    step.ref?.kind !== "ResourceFunction"
  ) {
    return;
  }

  const stepLabel = step.label || "config";
  await addFunctionNode(
    namespace,
    step.ref.kind,
    step.ref.name,
    stepLabel,
    graph,
    stepNodeIndex
  );
};

const addFunctionNode = async (
  namespace: string,
  kind: "ValueFunction" | "ResourceFunction",
  name: string,
  stepLabel: string,
  graph: DedupedGraph,
  stepNodeIndex: StepNodeIndex
) => {
  const func = await getFunction(name, kind, namespace);
  if (func) {
    const node: FunctionNode = {
      id: func.metadata?.uid || uuidv4(),
      label: stepLabel,
      logic: func,
    };
    graph.nodes[node.id] = node;
    addStepNodeToIndex(stepNodeIndex, node.id, stepLabel);
  }
};

const addSubWorkflowGraph = async (
  parentGraph: DedupedGraph,
  stepNodeIndex: StepNodeIndex,
  namespace: string,
  stepLabel: string,
  subWorkflowId: string
) => {
  const {
    workflowNode: subWorkflowNode,
    graph: subWorkflowGraph,
    leafNodes,
  } = await getWorkflowGraphWithLeafNodes(namespace, subWorkflowId);

  Object.entries(subWorkflowGraph.nodes).forEach(
    ([id, node]) => (parentGraph.nodes[id] = node)
  );
  Object.entries(subWorkflowGraph.edges).forEach(
    ([id, edge]) => (parentGraph.edges[id] = edge)
  );
  addSubWorkflowToIndex(stepNodeIndex, subWorkflowNode, leafNodes, stepLabel);
  //if (subWorkflowGraph.nodes) {
  //  parentGraph.edges.push({
  //    source: subWorkflowParent.id,
  //    target: subWorkflowGraph.nodes[0].id,
  //  });
  //}
};
