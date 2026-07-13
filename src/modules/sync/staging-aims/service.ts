export const runStagingAimsSync = async () => {
  return {
    module: "staging-aims",
    status: "queued",
    message: "Staging -> AIMS sync is ready",
    startedAt: new Date().toISOString(),
  };
};
