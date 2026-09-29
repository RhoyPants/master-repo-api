export const runSapStagingSync = async () => {
  return {
    module: "sap-staging",
    status: "queued",
    message: "SAP -> Staging sync module is ready",
    availableSubModules: ["warehouse", "item-class", "uom", "item"],
    startedAt: new Date().toISOString(),
  };
};
