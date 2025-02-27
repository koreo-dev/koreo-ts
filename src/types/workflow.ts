import { V1ObjectMeta } from "@kubernetes/client-node/dist/api";
import { KubernetesObjectWithSpecAndStatus } from "./kubernetes";

export interface Workflow extends KubernetesObjectWithSpecAndStatus {
  apiVersion: "koreo.realkinetic.com/v1beta1";
  kind: "Workflow";
  spec: WorkflowSpec;
}

export type WorkflowSpec = {
  crdRef?: CRDRef;
  configStep?: ConfigStep;
  steps: Step[];
};

export type CRDRef = {
  apiGroup: string;
  version: string;
  kind: string;
};

export type ConfigStep = {
  label?: string;
  ref: LogicRef;
  inputs?: Record<string, unknown>;
  condition?: Condition;
  state?: Record<string, unknown>;
};

export type Step = {
  label: string;
  ref?: LogicRef;
  refSwitch?: RefSwitch;
  skipIf?: string;
  forEach?: ForEach;
  inputs?: Record<string, unknown>;
  condition?: Condition;
};

export type LogicRef = {
  kind: "ResourceFunction" | "ValueFunction" | "Workflow";
  name: string;
};

export type RefSwitch = {
  switchOn: string;
  cases?: RefSwitchCase[];
};

export type RefSwitchCase = {
  case: string;
  default?: boolean;
  kind: "ResourceFunction" | "ValueFunction" | "Workflow";
  name: string;
};

export type ForEach = {
  itemIn: string;
  inputKey: string;
};

export type Condition = {
  type: string;
  name: string;
};

export type WorkflowParentMeta = V1ObjectMeta & {
  annotations: {
    "koreo.realkinetic.com/managed-resources": string;
  };
};

export interface WorkflowParent extends KubernetesObjectWithSpecAndStatus {
  metadata: WorkflowParentMeta;
  spec: unknown;
}

export type WorkflowResource<T extends WorkflowParent> = {
  resource: T;
  workflow: Workflow;
};

export type WorkflowResourceList<T extends WorkflowParent> = {
  resources: T[];
  workflow: Workflow;
};
