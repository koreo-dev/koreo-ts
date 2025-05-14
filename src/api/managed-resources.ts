import {
  ManagedResources,
  ManagedResource,
  KubernetesResource,
  KubernetesResourceOrManagedResources,
} from "../types/managed-resource";
import { WorkflowParent } from "../types/workflow";

const MANAGED_RESOURCES_ANNOTATION = "koreo.dev/managed-resources";

export const parseManagedResources = (
  managedResourcesStringOrParent: string | WorkflowParent
): ManagedResources => {
  const managedResourcesString =
    typeof managedResourcesStringOrParent !== "string"
      ? managedResourcesStringOrParent.metadata.annotations[
          MANAGED_RESOURCES_ANNOTATION
        ]
      : managedResourcesStringOrParent;

  if (!managedResourcesString) {
    return { workflow: "", resources: {} };
  }

  try {
    const parsed = JSON.parse(managedResourcesString);
    return parsed;
  } catch (error) {
    console.error("Failed to parse managed-resources:", error);
    return { workflow: "", resources: {} };
  }
};

export const collectManagedResources = (
  resources: ManagedResources
): KubernetesResource[] => {
  const collected: KubernetesResource[] = [];
  Object.values(resources).forEach((resource) => {
    // Handle null case
    if (resource === null) {
      return;
    }

    // Handle single KubernetesResource (ResourceFunction)
    if (isKubernetesResource(resource)) {
      collected.push(resource);
      return;
    }

    // Handle array of KubernetesResources/ManagedResources
    if (isKubernetesResourceOrManagedResourcesArray(resource)) {
      resource.forEach((k8sResourceOrManagedResources) => {
        if (isKubernetesResource(k8sResourceOrManagedResources)) {
          collected.push(k8sResourceOrManagedResources);
        } else {
          collected.push(
            ...collectManagedResources(k8sResourceOrManagedResources)
          );
        }
      });
      return;
    }

    // Handle nested ManagedResources (sub-workflow)
    if (isManagedResources(resource)) {
      collected.push(...collectManagedResources(resource));
      return;
    }
  });
  return collected;
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

    // Handle array of KubernetesResources/ManagedResources
    if (isKubernetesResourceOrManagedResourcesArray(resource)) {
      resource.forEach((k8sResourceOrManagedResources) => {
        if (isKubernetesResource(k8sResourceOrManagedResources)) {
          sum += 1;
        } else {
          sum += countManagedResources(k8sResourceOrManagedResources);
        }
      });
      return sum;
    }

    // Handle nested ManagedResources (sub-workflow)
    if (isManagedResources(resource)) {
      return sum + countManagedResources(resource);
    }

    return sum;
  }, 0);
};

export const isKubernetesResource = (
  value: ManagedResource | null
): value is KubernetesResource => {
  return (
    typeof value === "object" &&
    value !== null &&
    "apiVersion" in value &&
    "kind" in value &&
    "name" in value &&
    "readonly" in value &&
    "resourceFunction" in value
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

export const isKubernetesResourceOrManagedResourcesArray = (
  value: ManagedResource | null
): value is KubernetesResourceOrManagedResources[] => {
  return (
    Array.isArray(value) &&
    value.every(
      (item) => isKubernetesResource(item) || isManagedResources(item)
    )
  );
};
