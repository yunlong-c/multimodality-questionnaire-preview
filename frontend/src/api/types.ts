import type { StimulusFormat } from "../data/manifestTypes";
import type { AllocationMetadata } from "../experiment/experimentTypes";

export interface BootstrapResponse extends AllocationMetadata {
  participant_id: string;
  client_token: string;
  format_assignment: StimulusFormat;
  session_id: string;
  is_returning: boolean;
  dataset_classification?: "formal" | "test";
  formal_collection_allowed?: boolean;
  stimulus_set_version?: string;
  catalog_hash?: string;
}
