export const runSharePointStagingSync = async () => {
  return {
    module: "sharepoint-staging",
    status: "queued",
    message: "SharePoint -> Staging sync is ready",
    startedAt: new Date().toISOString(),
  };
};
