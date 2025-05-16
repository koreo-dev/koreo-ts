import { KubernetesObjectWithSpecAndStatus } from "./kubernetes";
import { ValueFunction, ResourceFunction } from "./function";
import { WorkflowParent, Workflow } from "./workflow";
import { KubernetesResource } from "./managed-resource";

export type KoreoType = {
  isKoreoType: true;
  name:
    | "Workflow"
    | "SubWorkflow"
    | "RefSwitch"
    | "RefSwitchResult"
    | "ResourceFunction"
    | "ValueFunction";
};

export type NonKoreoType = {
  isKoreoType: false;
  name: string;
};

export type InflatedNode = {
  id: string;
  label: string;
  type: KoreoType | NonKoreoType;
  krm?: KubernetesObjectWithSpecAndStatus;
  metadata?: Record<string, unknown>;
};

export type InflatedGraph = {
  nodes: InflatedNode[];
  edges: KEdge[];
};

export type NodeType =
  | "Parent"
  | "Workflow"
  | "ValueFunction"
  | "ResourceFunction"
  | "RefSwitch"
  | "SubWorkflow"
  | "ManagedResource";

export type EdgeType =
  | "ParentToWorkflow"
  | "WorkflowToStep"
  | "StepToStep"
  | "StepToResource";

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
  dependents: Record<string, KNode>;
  metadata?: Record<string, unknown>;
};

export type ResourceFunctionNode = {
  id: string;
  type: "ResourceFunction";
  krm: ResourceFunction;
  dependents: Record<string, KNode>;
  managedResources?: ManagedKubernetesResource[];
  metadata?: Record<string, unknown>;
};

export type WorkflowNode = {
  id: string;
  type: "Workflow";
  krm: Workflow;
  dependents: Record<string, KNode>;
  metadata?: Record<string, unknown>;
};

export type RefSwitchNode = {
  id: string;
  type: "RefSwitch";
  switchOn: string;
  caseNodes: Record<string, FunctionNode | SubWorkflowNode>;
  dependents: Record<string, KNode>;
  managedResources?: ManagedKubernetesResource[];
  metadata?: Record<string, unknown>;
};

export type SubWorkflowNode = {
  id: string;
  type: "SubWorkflow";
  workflowGraph: Graph;
  workflowLeafNodeIds: string[];
  dependents: Record<string, KNode>;
  metadata?: Record<string, unknown>;
};

export type ParentNode = {
  id: string;
  type: "Parent";
  krm: WorkflowParent;
  dependents: Record<string, KNode>;
  metadata?: Record<string, unknown>;
};

export type ManagedKubernetesResource = {
  resource: KubernetesObjectWithSpecAndStatus;
  readonly: boolean;
};
