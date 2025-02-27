import { getK8sCRDApi } from "./kubernetes";
import { ResourceTemplate } from "../types/resource-template";

const GROUP = "koreo.dev";
const VERSION = "v1beta1";
const PLURAL = "resourcetemplates";

export const listResourceTemplates = async (
  namespace: string
): Promise<ResourceTemplate[]> => {
  const api = getK8sCRDApi();
  try {
    const templates = await api.listNamespacedCustomObject({
      group: GROUP,
      version: VERSION,
      namespace,
      plural: PLURAL,
    });
    return templates.items;
  } catch (err) {
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
