import * as k8s from "@kubernetes/client-node";

let k8sObjectApiInstance: k8s.KubernetesObjectApi | null = null;
let k8sCRDApiInstance: k8s.CustomObjectsApi | null = null;
let k8sCoreV1ApiInstance: k8s.CoreV1Api | null = null;

export const getK8sObjectApi = (): k8s.KubernetesObjectApi => {
  if (!k8sObjectApiInstance) {
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    k8sObjectApiInstance = k8s.KubernetesObjectApi.makeApiClient(kc);
  }
  return k8sObjectApiInstance;
};

export const getK8sCRDApi = (): k8s.CustomObjectsApi => {
  if (!k8sCRDApiInstance) {
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    k8sCRDApiInstance = kc.makeApiClient(k8s.CustomObjectsApi);
  }
  return k8sCRDApiInstance;
};

export const getK8sCoreV1Api = (): k8s.CoreV1Api => {
  if (!k8sCoreV1ApiInstance) {
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    k8sCoreV1ApiInstance = kc.makeApiClient(k8s.CoreV1Api);
  }
  return k8sCoreV1ApiInstance;
};
