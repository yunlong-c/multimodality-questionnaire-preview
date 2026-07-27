import type { StimulusFormat } from "../data/manifestTypes";
import { runControlledQuestionnaire } from "./controlledQuestionnaire";
import type { StartExperimentOptions } from "./experimentTypes";

export type {
  PoolName,
  PoolVariant,
  ResponseType,
  StimulusFormat
} from "../data/manifestTypes";
export {
  trialCsvHeaders,
  type AllocationMetadata,
  type AllocationMethod,
  type AllocationStatus,
  type DatasetClassification,
  type ExperimentDemographics,
  type ExperimentPayload,
  type ExperimentSession,
  type ExperimentTrial,
  type FallbackReasonCode
} from "./experimentTypes";
export { buildTrialHtml } from "./trialRendering";

export function assignFormat(): StimulusFormat {
  const formats: StimulusFormat[] = ["table", "graph", "video"];
  const index = Math.floor(Math.random() * formats.length);
  return formats[index];
}

export function startExperiment(options: StartExperimentOptions): void {
  runControlledQuestionnaire(options);
}
