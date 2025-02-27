import { KubernetesObjectWithSpecAndStatus } from "./kubernetes";

export type Function = ResourceFunction | ValueFunction;

export interface ValueFunction extends KubernetesObjectWithSpecAndStatus {
  spec: ValueFunctionSpec;
}

export type ValueFunctionSpec = {
  return?: Record<string, any>;
};

export interface ResourceFunction extends KubernetesObjectWithSpecAndStatus {
  spec: ResourceFunctionSpec;
}

export type ResourceFunctionSpec = {
  apiConfig: APIConfig;
};

export type APIConfig = {
  apiVersion: string;
  kind: string;
  name: string;
  namespace?: string;
  namespaced?: boolean;
  owned?: boolean;
  plural?: string;
  readonly?: boolean;
};
