import { createMappingStore } from "../store";
import { parseItemMasterConfig } from "./domain";

export const itemMasterMappingStore = createMappingStore("itemmaster-staging", parseItemMasterConfig);
