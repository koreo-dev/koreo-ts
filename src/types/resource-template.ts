import { KubernetesObjectWithSpecAndStatus } from "./kubernetes";

export interface ResourceTemplate extends KubernetesObjectWithSpecAndStatus {
  spec: {
    context?: Record<string, any> | null;
    template: Record<string, any>;
  };
}
