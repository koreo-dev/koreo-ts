import { getWorkflowGraph } from "./graphs";
import {
  Graph,
  InflatedGraph,
  InflatedNode,
  WorkflowNode,
  KEdge,
  EdgeType,
} from "../types/graph";
import { KubernetesObjectWithSpecAndStatus } from "../types/kubernetes";
import { ManagedKubernetesResource } from "../types/graph";
import { v4 as uuidv4 } from "uuid";

export const getInflatedWorkflowGraph = async (
  namespace: string,
  workflowId: string,
  expanded?: boolean
): Promise<InflatedGraph> => {
  return inflateGraph(
    await getWorkflowGraph(namespace, workflowId),
    false,
    expanded
  );
};

export const getInflatedWorkflowInstanceGraph = async (
  namespace: string,
  workflowId: string,
  instanceId: string,
  expanded?: boolean
): Promise<InflatedGraph> => {
  return inflateGraph(
    await getWorkflowGraph(namespace, workflowId, instanceId),
    true,
    expanded
  );
};

const inflateGraph = (
  koreoGraph: Graph,
  includeResources: boolean,
  expanded?: boolean
): InflatedGraph => {
  const dedupedGraph = expanded
    ? convertGraphExpanded(koreoGraph, includeResources)
    : convertGraph(koreoGraph, includeResources);
  return {
    nodes: Object.values(dedupedGraph.nodes),
    edges: Object.values(dedupedGraph.edges),
  };
};

const convertGraph = (
  koreoGraph: Graph,
  includeResources: boolean
): { nodes: Record<string, InflatedNode>; edges: Record<string, KEdge> } => {
  const graph: {
    nodes: Record<string, InflatedNode>;
    edges: Record<string, KEdge>;
  } = {
    nodes: {},
    edges: {},
  };
  koreoGraph.nodes.forEach((knode) => {
    if (knode.type === "SubWorkflow") {
      if (!knode.workflowGraph.nodes) {
        return;
      }
      const workflowNode = knode.workflowGraph.nodes[0] as WorkflowNode;
      const node: InflatedNode = {
        id: knode.id,
        label: workflowNode.metadata?.label
          ? (workflowNode.metadata.label as string)
          : workflowNode.krm.metadata?.name!,
        type: "Sub-Workflow",
        krm: workflowNode.krm,
      };
      graph.nodes[node.id] = node;
      if (includeResources) {
        addResourceNodes(graph, node.id, knode.workflowGraph.managedResources);
      }
    } else if (knode.type === "RefSwitch") {
      const caseKRMs: KubernetesObjectWithSpecAndStatus[] = [];
      Object.values(knode.caseNodes).forEach((node) => {
        if (node.type === "SubWorkflow") {
          if (!node.workflowGraph.nodes) {
            return;
          }
          const subWorkflowNode = node.workflowGraph.nodes[0] as WorkflowNode;
          caseKRMs.push(subWorkflowNode.krm);
        } else {
          caseKRMs.push(node.krm);
        }
      });
      const node: InflatedNode = {
        id: knode.id,
        label: knode.metadata?.label
          ? (knode.metadata.label as string)
          : "RefSwitch",
        type: "RefSwitch",
      };
      graph.nodes[node.id] = node;
      if (includeResources) {
        addResourceNodes(graph, node.id, knode.managedResources);
      }
    } else if (knode.type === "ResourceFunction") {
      const node: InflatedNode = {
        id: knode.id,
        label: knode.metadata?.label
          ? (knode.metadata.label as string)
          : knode.krm.metadata?.name!,
        type: knode.krm.kind!,
        krm: knode.krm,
      };
      graph.nodes[node.id] = node;
      if (includeResources) {
        addResourceNodes(graph, node.id, knode.managedResources);
      }
    } else if (knode.type === "Parent") {
      // Use a special id in case the parent is also a managed resource to avoid cycles
      const parentNodeId = `parent-${knode.id}`;
      const node: InflatedNode = {
        id: parentNodeId,
        label: knode.metadata?.label
          ? (knode.metadata.label as string)
          : knode.krm.metadata?.name!,
        type: knode.krm.kind!,
        krm: knode.krm,
      };
      graph.nodes[node.id] = node;
      const parentEdge = koreoGraph.edges.find(
        (edge) => edge.source === knode.id
      );
      if (parentEdge) {
        parentEdge.source = parentNodeId;
      }
    } else {
      const node: InflatedNode = {
        id: knode.id,
        label: knode.metadata?.label
          ? (knode.metadata.label as string)
          : knode.krm.metadata?.name!,
        type: knode.krm.kind!,
        krm: knode.krm,
      };
      graph.nodes[node.id] = node;
    }
  });
  koreoGraph.edges.forEach((kedge) => {
    graph.edges[kedge.id] = kedge;
  });

  return graph;
};

const convertGraphExpanded = (
  koreoGraph: Graph,
  includeResources: boolean
): { nodes: Record<string, InflatedNode>; edges: Record<string, KEdge> } => {
  const graph: {
    nodes: Record<string, InflatedNode>;
    edges: Record<string, KEdge>;
  } = {
    nodes: {},
    edges: {},
  };
  const workflowLeafNodes: Record<string, string[]> = {};
  koreoGraph.nodes.forEach((knode) => {
    if (knode.type === "SubWorkflow") {
      if (!knode.workflowGraph.nodes) {
        return;
      }
      const workflowNode = knode.workflowGraph.nodes[0] as WorkflowNode;
      const prevWorkflowNodeId = workflowNode.id;
      workflowNode.id = knode.id;
      workflowLeafNodes[knode.id] = knode.workflowLeafNodeIds;
      const subGraph = convertGraphExpanded(knode.workflowGraph, true);
      Object.values(subGraph.edges).forEach((edge) => {
        if (edge.source === prevWorkflowNodeId) {
          edge.source = workflowNode.id;
        }
      });
      Object.values(subGraph.nodes).forEach(
        (node) => (graph.nodes[node.id] = node)
      );
      Object.values(subGraph.edges).forEach(
        (edge) => (graph.edges[edge.id] = edge)
      );
    } else if (knode.type === "RefSwitch") {
      const switchInName = knode.metadata?.label
        ? `${knode.metadata.label}`
        : "RefSwitch";
      const switchInNodeId = `switchIn-${knode.id}`;
      const switchInNode: InflatedNode = {
        id: switchInNodeId,
        label: switchInName,
        type: "RefSwitch",
      };
      graph.nodes[switchInNode.id] = switchInNode;
      const functionCaseNodes: string[] = [];
      const workflowCaseNodes: { workflowNode: string; leafNodes: string[] }[] =
        [];
      Object.entries(knode.caseNodes).forEach(([caseStr, caseNode]) => {
        if (caseNode.type === "SubWorkflow") {
          if (!caseNode.workflowGraph.nodes) {
            return;
          }
          if (!caseNode.workflowGraph.nodes[0].metadata) {
            caseNode.workflowGraph.nodes[0].metadata = {};
          }
          caseNode.workflowGraph.nodes[0].metadata.label = `case: ${caseStr}`;
          const subGraph = convertGraphExpanded(caseNode.workflowGraph, false);
          Object.values(subGraph.nodes).forEach(
            (node) => (graph.nodes[node.id] = node)
          );
          Object.values(subGraph.edges).forEach(
            (edge) => (graph.edges[edge.id] = edge)
          );
          workflowCaseNodes.push({
            workflowNode: caseNode.workflowGraph.nodes[0].id,
            leafNodes: caseNode.workflowLeafNodeIds,
          });
        } else {
          const node: InflatedNode = {
            id: caseNode.id,
            label: `case: ${caseStr}`,
            type: caseNode.krm.kind!,
            krm: caseNode.krm,
          };
          graph.nodes[node.id] = node;
          functionCaseNodes.push(node.id);
        }
      });

      const switchOutName = knode.metadata?.label
        ? `${knode.metadata.label}`
        : "RefSwitch Result";
      const switchOutNodeId = `switchOut-${knode.id}`;
      const switchOutNode: InflatedNode = {
        id: switchOutNodeId,
        label: switchOutName,
        type: "RefSwitch Result",
      };
      graph.nodes[switchOutNode.id] = switchOutNode;
      if (includeResources) {
        addResourceNodes(graph, switchOutNode.id, knode.managedResources);
      }

      // Change edges sourced from knode.id to switchOutNodeId and edges
      // targeting knode.id to switchInNodeId.
      koreoGraph.edges.forEach((edge) => {
        if (edge.source === knode.id) {
          edge.source = switchOutNodeId;
        }
        if (edge.target === knode.id) {
          edge.target = switchInNodeId;
        }
      });

      functionCaseNodes.forEach((functionCaseNodeId) => {
        const switchInEdge = createEdge(
          switchInNode.id,
          functionCaseNodeId,
          "StepToStep"
        );
        graph.edges[switchInEdge.id] = switchInEdge;
        const switchOutEdge = createEdge(
          functionCaseNodeId,
          switchOutNode.id,
          "StepToStep"
        );
        graph.edges[switchOutEdge.id] = switchOutEdge;
      });
      workflowCaseNodes.forEach(({ workflowNode, leafNodes }) => {
        const switchInEdge = createEdge(
          switchInNode.id,
          workflowNode,
          "StepToStep"
        );
        graph.edges[switchInEdge.id] = switchInEdge;
        leafNodes.forEach((leafNode) => {
          const switchOutEdge = createEdge(
            leafNode,
            switchOutNode.id,
            "StepToStep"
          );
          graph.edges[switchOutEdge.id] = switchOutEdge;
        });
      });
    } else if (knode.type === "ResourceFunction") {
      const node: InflatedNode = {
        id: knode.id,
        label: knode.metadata?.label
          ? (knode.metadata.label as string)
          : knode.krm.metadata?.name!,
        type: knode.krm.kind!,
        krm: knode.krm,
      };
      graph.nodes[node.id] = node;
      if (includeResources) {
        addResourceNodes(graph, node.id, knode.managedResources);
      }
    } else if (knode.type === "Parent") {
      // Use a special id in case the parent is also a managed resource to avoid cycles
      const parentNodeId = `parent-${knode.id}`;
      const node: InflatedNode = {
        id: parentNodeId,
        label: knode.metadata?.label
          ? (knode.metadata.label as string)
          : knode.krm.metadata?.name!,
        type: knode.krm.kind!,
        krm: knode.krm,
      };
      graph.nodes[node.id] = node;
      const parentEdge = koreoGraph.edges.find(
        (edge) => edge.source === knode.id
      );
      if (parentEdge) {
        parentEdge.source = parentNodeId;
      }
    } else {
      const node: InflatedNode = {
        id: knode.id,
        label: knode.metadata?.label
          ? (knode.metadata.label as string)
          : knode.krm.metadata?.name!,
        type: knode.krm.kind!,
        krm: knode.krm,
      };
      graph.nodes[node.id] = node;
    }
  });

  koreoGraph.edges.forEach((kedge) => {
    if (kedge.source in workflowLeafNodes) {
      const leafNodes = workflowLeafNodes[kedge.source];
      leafNodes.forEach((leafNodeId) => {
        const edge = createEdge(leafNodeId, kedge.target, "StepToStep");
        graph.edges[edge.id] = edge;
      });
    } else {
      graph.edges[kedge.id] = kedge;
    }
  });

  return graph;
};

const addResourceNodes = (
  graph: { nodes: Record<string, InflatedNode>; edges: Record<string, KEdge> },
  parentNodeId: string,
  managedResources: ManagedKubernetesResource[] | undefined
) => {
  (managedResources || []).forEach((managedResource) => {
    const resource = managedResource.resource;
    const resourceNode: InflatedNode = {
      id: resource.metadata!.uid || uuidv4(),
      label: resource.metadata!.name!,
      type: resource.kind!,
      krm: resource,
      metadata: {
        managedResource: true,
        readonly: managedResource.readonly,
      },
    };
    graph.nodes[resourceNode.id] = resourceNode;
    const edge = createEdge(parentNodeId, resourceNode.id, "StepToResource");
    graph.edges[edge.id] = edge;
  });
};

const createEdge = (
  sourceId: string,
  targetId: string,
  edgeType: EdgeType
): KEdge => {
  return {
    id: `${sourceId}:${targetId}`,
    source: sourceId,
    target: targetId,
    type: edgeType,
  };
};
