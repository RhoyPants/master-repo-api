export const runStagingSapSync = async () => {
  return {
    module: "staging-sap",
    status: "queued",
    message: "Staging -> SAP sync is ready",
    startedAt: new Date().toISOString(),
  };
};
