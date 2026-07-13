import { runItemGroupSync } from "./item-group/service";

export const runItemMasterStagingSync = async () => {
  const itemGroup = await runItemGroupSync();

  return {
    module: "itemmaster-staging",
    entity: "item-group",
    status: itemGroup.status,
    startedAt: itemGroup.startedAt,
    endedAt: itemGroup.endedAt,
    result: itemGroup,
  };
};
