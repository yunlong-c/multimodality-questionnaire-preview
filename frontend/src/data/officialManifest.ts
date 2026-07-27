import {
  catalogHash,
  sequenceCatalog,
  stimulusSetVersion
} from "./sequenceCatalog.generated";
import { selectExperimentTrials } from "./manifestSelectors";
import type { AssembledTrial, StimulusFormat } from "./manifestTypes";

export { catalogHash, sequenceCatalog, stimulusSetVersion };

export function buildExperimentTrials(
  formatAssignment: StimulusFormat
): AssembledTrial[] {
  return selectExperimentTrials(
    sequenceCatalog,
    formatAssignment,
    stimulusSetVersion,
    catalogHash
  );
}
