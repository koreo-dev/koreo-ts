import { KubernetesObject } from "@kubernetes/client-node/dist/types";

export type KubernetesTerminalCondition = {
  lastTransitionTime: string;
  message: string;
  reason: string;
  revisionReason: string;
  severity: string;
  state: string;
  type: string;
};

export type KubernetesCondition = {
  message: string;
  reason: string;
  status: string;
  type: string;
  lastUpdateTime?: string;
  lastTransitionTime?: string;
};

export type KubernetesStatus = {
  url?: string;
  conditions?: KubernetesCondition[];
};

export interface KubernetesObjectWithSpecAndStatus extends KubernetesObject {
  spec: any;
  status: {
    uniqueId?: string;
    conditions?: KubernetesCondition[];
    terminalCondition?: KubernetesTerminalCondition;
    state?: any;
  };
}
