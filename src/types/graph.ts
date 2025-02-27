import { KubernetesObjectWithSpecAndStatus } from "./kubernetes";
import { Workflow, WorkflowParent } from "./workflow";
import { Function } from "./function";

export type KNode = WorkflowNode | FunctionNode;

export type KEdge = {
  id: string;
  source: string;
  target: string;
};

export type Graph = {
  nodes: KNode[];
  edges: KEdge[];
};

export type WorkflowNode = {
  id: string;
  workflow: Workflow;
  parent?: WorkflowParent;
};

export type FunctionNode = {
  id: string;
  label: string;
  logic: Function;
  resources?: KubernetesObjectWithSpecAndStatus[];
};
