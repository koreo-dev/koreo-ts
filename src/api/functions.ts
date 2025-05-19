import { getK8sCRDApi } from "./kubernetes";
import { Function, ValueFunction, ResourceFunction } from "../types/function";

const GROUP = "koreo.dev";
const VERSION = "v1beta1";
const RESOURCE_FUNCTION_PLURAL = "resourcefunctions";
const VALUE_FUNCTION_PLURAL = "valuefunctions";

export const listFunctions = async (
  namespaces: string | string[]
): Promise<Function[]> => {
  const api = getK8sCRDApi();
  const namespaceArray = Array.isArray(namespaces) ? namespaces : [namespaces];

  try {
    const valueFunctionPromises = namespaceArray.map((namespace) =>
      api.listNamespacedCustomObject({
        group: GROUP,
        version: VERSION,
        namespace,
        plural: VALUE_FUNCTION_PLURAL,
      })
    );
    const resourceFunctionPromises = namespaceArray.map((namespace) =>
      api.listNamespacedCustomObject({
        group: GROUP,
        version: VERSION,
        namespace,
        plural: RESOURCE_FUNCTION_PLURAL,
      })
    );

    const [valueResults, resourceResults] = await Promise.all([
      Promise.all(valueFunctionPromises),
      Promise.all(resourceFunctionPromises),
    ]);

    const valueFunctions = valueResults.flatMap((result) => result.items);
    const resourceFunctions = resourceResults.flatMap((result) => result.items);

    return [...valueFunctions, ...resourceFunctions];
  } catch (err) {
    console.error(
      `Failed to get functions for namespaces ${namespaceArray}`,
      err
    );
    return [];
  }
};

export const getFunction = async (
  functionId: string,
  kind: string,
  namespace: string
): Promise<Function | null> => {
  if (kind === "ResourceFunction") {
    return getResourceFunction(functionId, namespace);
  } else if (kind === "ValueFunction") {
    return getValueFunction(functionId, namespace);
  }
  console.error(`Invalid function kind ${kind}`);
  return null;
};

export const getResourceFunction = async (
  functionId: string,
  namespace: string
): Promise<ResourceFunction | null> => {
  const api = getK8sCRDApi();
  try {
    return api.getNamespacedCustomObject({
      group: GROUP,
      version: VERSION,
      namespace,
      plural: RESOURCE_FUNCTION_PLURAL,
      name: functionId,
    });
  } catch (err) {
    return null;
  }
};

export const getValueFunction = async (
  functionId: string,
  namespace: string
): Promise<ValueFunction | null> => {
  const api = getK8sCRDApi();
  try {
    return api.getNamespacedCustomObject({
      group: GROUP,
      version: VERSION,
      namespace,
      plural: VALUE_FUNCTION_PLURAL,
      name: functionId,
    });
  } catch (err) {
    return null;
  }
};
