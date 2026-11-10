import { createMappingStore } from "../store";
import { parseSapConfig } from "./domain";

export const sapMappingStore = createMappingStore("sap-staging", parseSapConfig);
