export type KubernetesResource = {
  apiVersion: string;
  kind: string;
  plural: string;
  name: string;
  readonly: boolean;
  namespace: string;
};

export type KubernetesResourceOrManagedResources =
  | KubernetesResource
  | ManagedResources;

export type ManagedResource =
  | KubernetesResource // ResourceFunction
  | KubernetesResource[] // forEach on a ResourceFunction
  | ManagedResources // sub-workflow
  | ManagedResources[] // forEach on a sub-workflow
  | KubernetesResourceOrManagedResources[] // forEach on a refSwitch
  | null;

export interface ManagedResources {
  [key: string]: ManagedResource;
}
