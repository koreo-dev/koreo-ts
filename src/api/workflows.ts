import { getK8sCRDApi } from "./kubernetes";
import { Workflow, CRDRef, WorkflowParent } from "../types/workflow";

const GROUP = "koreo.dev";
const VERSION = "v1beta1";
const PLURAL = "workflows";

export const listWorkflows = async (
  namespaces: string | string[]
): Promise<Workflow[]> => {
  const api = getK8sCRDApi();
  const namespaceArray = Array.isArray(namespaces) ? namespaces : [namespaces];

  try {
    const workflowPromises = namespaceArray.map((namespace) =>
      api.listNamespacedCustomObject({
        group: GROUP,
        version: VERSION,
        namespace,
        plural: PLURAL,
      })
    );

    const results = await Promise.all(workflowPromises);

    return results.flatMap((result) => result.items);
  } catch (err) {
    console.error(`Failed to get workflows for namespaces ${namespaceArray}`);
    return [];
  }
};

export const getWorkflowsForCrdRef = async (
  namespaces: string | string[],
  crdRef: CRDRef
): Promise<Workflow[]> => {
  const api = getK8sCRDApi();
  const namespaceArray = Array.isArray(namespaces) ? namespaces : [namespaces];

  try {
    const workflowPromises = namespaceArray.map((namespace) =>
      api.listNamespacedCustomObject({
        group: GROUP,
        version: VERSION,
        namespace,
        plural: PLURAL,
      })
    );

    const results = await Promise.all(workflowPromises);
    const workflows = results.flatMap((result) => result.items);

    return workflows.filter(
      (workflow) =>
        workflow.spec.crdRef?.apiGroup === crdRef.apiGroup &&
        workflow.spec.crdRef?.kind === crdRef.kind &&
        workflow.spec.crdRef?.version === crdRef.version
    );
  } catch (err) {
    console.error(`Failed to get workflows for namespaces ${namespaceArray}`);
    return [];
  }
};

export const getWorkflow = async (
  workflowId: string,
  namespace: string
): Promise<Workflow | null> => {
  const api = getK8sCRDApi();
  try {
    return api.getNamespacedCustomObject({
      group: GROUP,
      version: VERSION,
      namespace,
      plural: PLURAL,
      name: workflowId,
    });
  } catch (err) {
    console.error(
      `Failed to get workflow ${workflowId} in namespace ${namespace}`
    );
    return null;
  }
};

export const getWorkflowInstances = async (
  workflow: Workflow
): Promise<WorkflowParent[]> => {
  if (!workflow.spec.crdRef || !workflow.metadata?.namespace) {
    return [];
  }
  const crdRef = workflow.spec.crdRef;

  // TODO: Change this to first list all custom resources, then match against
  // the kind + apiGroup, then lookup the plural.
  let plural = crdRef.kind.toLowerCase();
  if (plural.endsWith("y")) {
    plural = plural.substring(0, plural.length - 1) + "ies";
  } else {
    plural += "s";
  }

  const api = getK8sCRDApi();

  try {
    const crds = await api.listNamespacedCustomObject({
      group: crdRef.apiGroup,
      version: crdRef.version,
      namespace: workflow.metadata.namespace,
      plural,
    });
    return crds.items;
  } catch (err) {
    return [];
  }
};

export const getWorkflowInstance = async (
  workflow: Workflow,
  instanceId: string
): Promise<WorkflowParent | null> => {
  if (!workflow.spec.crdRef || !workflow.metadata?.namespace) {
    return null;
  }
  const crdRef = workflow.spec.crdRef;

  // TODO: Change this to first list all custom resources, then match against
  // the kind + apiGroup, then lookup the plural.
  let plural = crdRef.kind.toLowerCase();
  if (plural.endsWith("y")) {
    plural = plural.substring(0, plural.length - 1) + "ies";
  } else {
    plural += "s";
  }

  const api = getK8sCRDApi();

  try {
    return api.getNamespacedCustomObject({
      group: crdRef.apiGroup,
      version: crdRef.version,
      namespace: workflow.metadata.namespace,
      plural,
      name: instanceId,
    });
  } catch (err) {
    return null;
  }
};
