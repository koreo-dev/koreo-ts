export type KubernetesResource = {
  apiVersion: string;
  kind: string;
  plural?: string;
  name: string;
  readonly: boolean;
  namespace?: string;
  resourceFunction: string;
};

export type KubernetesResourceOrManagedResources =
  | KubernetesResource
  | ManagedResources;

export type ManagedResource =
  | KubernetesResource // ResourceFunction
  | ManagedResources // sub-workflow
  | KubernetesResourceOrManagedResources[] // forEach
  | null;

export interface ManagedResources {
  workflow: string;
  resources: Record<string, ManagedResource>;
}
