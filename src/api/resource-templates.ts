import { getK8sCRDApi } from "./kubernetes";
import { ResourceTemplate } from "../types/resource-template";

const GROUP = "koreo.dev";
const VERSION = "v1beta1";
const PLURAL = "resourcetemplates";

export const listResourceTemplates = async (
  namespaces: string | string[]
): Promise<ResourceTemplate[]> => {
  const api = getK8sCRDApi();
  const namespaceArray = Array.isArray(namespaces) ? namespaces : [namespaces];

  try {
    const templatePromises = namespaceArray.map((namespace) =>
      api.listNamespacedCustomObject({
        group: GROUP,
        version: VERSION,
        namespace,
        plural: PLURAL,
      })
    );

    const results = await Promise.all(templatePromises);

    return results.flatMap((result) => result.items);
  } catch (err) {
    console.error(
      `Failed to get resource templates for namespaces ${namespaceArray}`
    );
    return [];
  }
};

export const getResourceTemplate = async (
  templateId: string,
  namespace: string
): Promise<ResourceTemplate | null> => {
  const api = getK8sCRDApi();
  try {
    return api.getNamespacedCustomObject({
      group: GROUP,
      version: VERSION,
      namespace,
      plural: PLURAL,
      name: templateId,
    });
  } catch (err) {
    return null;
  }
};
