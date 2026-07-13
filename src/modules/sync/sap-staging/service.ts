export const runSapStagingSync = async () => {
  return {
    module: "sap-staging",
    status: "queued",
    message: "SAP -> Staging sync module is ready",
    availableSubModules: ["warehouse"],
    startedAt: new Date().toISOString(),
  };
};
