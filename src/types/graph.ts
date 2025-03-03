import { KubernetesObjectWithSpecAndStatus } from "./kubernetes";
import { ValueFunction, ResourceFunction } from "./function";
import { WorkflowParent, Workflow } from "./workflow";

export type NodeType =
  | "Parent"
  | "Workflow"
  | "ValueFunction"
  | "ResourceFunction"
  | "RefSwitch"
  | "SubWorkflow"
  | "ManagedResource";

export type EdgeType = "ParentToWorkflow" | "WorkflowToStep" | "StepToStep";

export type KNode =
  | WorkflowNode
  | FunctionNode
  | SubWorkflowNode
  | RefSwitchNode
  | ParentNode;

export type KEdge = {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  metadata?: Record<string, unknown>;
};

export type Graph = {
  nodes: KNode[];
  edges: KEdge[];
  managedResources?: ManagedKubernetesResource[];
};

export type LogicNode = FunctionNode | SubWorkflowNode;

export type FunctionNode = ValueFunctionNode | ResourceFunctionNode;

export type ValueFunctionNode = {
  id: string;
  type: "ValueFunction";
  krm: ValueFunction;
  metadata?: Record<string, unknown>;
};

export type ResourceFunctionNode = {
  id: string;
  type: "ResourceFunction";
  krm: ResourceFunction;
  managedResources?: ManagedKubernetesResource[];
  metadata?: Record<string, unknown>;
};

export type WorkflowNode = {
  id: string;
  type: "Workflow";
  krm: Workflow;
  metadata?: Record<string, unknown>;
};

export type RefSwitchNode = {
  id: string;
  type: "RefSwitch";
  switchOn: string;
  caseNodes: Record<string, FunctionNode | SubWorkflowNode>;
  managedResources?: ManagedKubernetesResource[];
  metadata?: Record<string, unknown>;
};

export type SubWorkflowNode = {
  id: string;
  type: "SubWorkflow";
  workflowGraph: Graph;
  workflowLeafNodeIds: string[];
  metadata?: Record<string, unknown>;
};

export type ParentNode = {
  id: string;
  type: "Parent";
  krm: WorkflowParent;
  metadata?: Record<string, unknown>;
};

export type ManagedKubernetesResource = {
  resource: KubernetesObjectWithSpecAndStatus;
  readonly: boolean;
};
