export const runSapSharePointDirectSync = async () => {
  return {
    module: "sap-sp-direct",
    status: "queued",
    message: "SAP -> SharePoint direct sync is ready",
    startedAt: new Date().toISOString(),
  };
};
