import {
  ManagedResources,
  ManagedResource,
  KubernetesResource,
  KubernetesResourceOrManagedResources,
} from "../types/managed-resource";
import { WorkflowParent } from "../types/workflow";

export const parseManagedResources = (
  managedResourcesStringOrParent: string | WorkflowParent
): ManagedResources => {
  const managedResourcesString =
    typeof managedResourcesStringOrParent !== "string"
      ? managedResourcesStringOrParent.metadata.annotations[
          "koreo.realkinetic.com/managed-resources"
        ]
      : managedResourcesStringOrParent;

  try {
    const parsed = JSON.parse(managedResourcesString);
    return parsed;
  } catch (error) {
    console.error("Failed to parse managed-resources:", error);
    return {};
  }
};

export const countManagedResources = (resources: ManagedResources): number => {
  return Object.values(resources).reduce((sum, resource) => {
    // Handle null case
    if (resource === null) {
      return sum;
    }

    // Handle single KubernetesResource (ResourceFunction)
    if (isKubernetesResource(resource)) {
      return sum + 1;
    }

    // Handle array of KubernetesResources (forEach on a ResourceFunction)
    if (isKubernetesResourceArray(resource)) {
      return sum + resource.length;
    }

    // Handle nested ManagedResources (sub-workflow)
    if (isManagedResources(resource)) {
      return sum + countManagedResources(resource);
    }

    // Handle array of ManagedResources (forEach on a sub-workflow)
    if (isManagedResourcesArray(resource)) {
      return (
        sum +
        resource.reduce(
          (subtotal, managedResources) =>
            subtotal + countManagedResources(managedResources),
          0
        )
      );
    }

    // Handle array of KubernetesResourceOrManagedResources (forEach on a
    // refSwitch)
    if (isKubernetesResourceOrManagedResourcesArray(resource)) {
      return (
        sum +
        resource.reduce((subtotal, k8sResourceOrManagedResources) => {
          if (isKubernetesResource(k8sResourceOrManagedResources)) {
            return subtotal + 1;
          }
          if (isManagedResources(k8sResourceOrManagedResources)) {
            return (
              subtotal + countManagedResources(k8sResourceOrManagedResources)
            );
          }
          return subtotal;
        }, 0)
      );
    }

    return sum;
  }, 0);
};

const isKubernetesResource = (value: ManagedResource | null): boolean => {
  return (
    typeof value === "object" &&
    value !== null &&
    "apiVersion" in value &&
    "kind" in value &&
    "plural" in value &&
    "name" in value &&
    "readonly" in value &&
    "namespace" in value
  );
};

const isKubernetesResourceArray = (
  value: ManagedResource | null
): value is KubernetesResource[] => {
  return (
    Array.isArray(value) && value.every((item) => isKubernetesResource(item))
  );
};

export const isManagedResources = (
  value: ManagedResource | null
): value is ManagedResources => {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !isKubernetesResource(value)
  );
};

export const isManagedResourcesArray = (
  value: ManagedResource | null
): value is ManagedResources[] => {
  return (
    Array.isArray(value) && value.every((item) => isManagedResources(item))
  );
};

const isKubernetesResourceOrManagedResourcesArray = (
  value: ManagedResource | null
): value is KubernetesResourceOrManagedResources[] => {
  return (
    Array.isArray(value) &&
    value.every(
      (item) => isKubernetesResource(item) || isManagedResources(item)
    )
  );
};
