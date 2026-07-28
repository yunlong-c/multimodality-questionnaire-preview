import type {
  PoolName,
  PoolVariant,
  ResponseType,
  StimulusFormat
} from "../data/manifestTypes";

export type DatasetClassification = "formal" | "test";
export type AllocationMethod = "variable_block" | "client_fallback";
export type AllocationStatus = "confirmed" | "unreconciled";
export type FallbackReasonCode =
  | "allocation_timeout"
  | "allocation_network_error"
  | "allocation_server_error";

export interface AllocationMetadata {
  allocation_id: string | null;
  randomization_version: string | null;
  allocation_method: AllocationMethod | null;
  allocation_status: AllocationStatus | null;
  assigned_at: string | null;
  fallback_reason_code: FallbackReasonCode | null;
  fallback_reconciled_at: string | null;
}

export type AssetLoadStatus =
  | "not_applicable"
  | "pending"
  | "loaded"
  | "failed";

export type VideoPlaybackVersion = "single-play-gif-v1";

export interface StartExperimentOptions {
  mount: HTMLElement;
  formatAssignment: StimulusFormat;
  participantId: string;
  sessionId: string;
  datasetClassification: DatasetClassification;
  formalCollectionAllowed: boolean;
  allocationMetadata: AllocationMetadata;
  onComplete: (payload: ExperimentPayload) => void;
}

export interface ExperimentSession extends AllocationMetadata {
  session_id: string;
  participant_id: string;
  format_assignment: StimulusFormat;
  stimulus_set_version: string;
  catalog_hash: string;
  dataset_classification: DatasetClassification;
  formal_collection_allowed: boolean;
  started_at: string;
  submitted_at: string;
  duration_ms: number;
}

export interface ExperimentDemographics {
  gender: string | null;
  age: number | null;
  education: string | null;
  experience: string | null;
  stat_course: string | null;
  started_at: string | null;
  submitted_at: string | null;
  duration_ms: number | null;
}

export interface ExperimentTrial {
  session_id: string;
  format_assignment: StimulusFormat;
  stimulus_set_version: string;
  catalog_hash: string;
  dataset_classification: DatasetClassification;
  trial_no: number;
  pool: PoolName;
  sequence_uid: string;
  canonical_key: string;
  presentation_uid: string;
  source_id: number;
  stimulus_id: string | null;
  display_index: number;
  legacy_asset_no: number;
  pair_uid: string | null;
  format: StimulusFormat;
  variant: PoolVariant;
  response_type: ResponseType;
  legacy_path: string;
  legacy_asset_path: string;
  stimulus_path: string;
  legacy_asset_sha256: string;
  asset_sha256: string | null;
  renderer_version: string | null;
  video_playback_version: VideoPlaybackVersion | null;
  playback_asset_path: string | null;
  playback_asset_sha256: string | null;
  video_replay_used: boolean;
  video_replay_completed: boolean;
  video_initial_restart_count: number;
  values_sha256: string;
  pool2_speed: "fast" | "slow" | null;
  source_data_file: string | null;
  rho: number | null;
  trend: string | null;
  beta: number | null;
  condition: string | null;
  tau_obs: number | null;
  beta1: number | null;
  beta2: number | null;
  structure: string | null;
  direction: string | null;
  sigma1: number | null;
  sigma2: number | null;
  point: number | null;
  trial_started_at: string | null;
  trial_submitted_at: string | null;
  trial_duration_ms: number | null;
  visit_count: number;
  revision_count: number;
  fullscreen_open_count: number | null;
  fullscreen_duration_ms: number | null;
  asset_load_duration_ms: number | null;
  asset_load_attempt_count: number;
  asset_load_status: AssetLoadStatus;
  s1: number | null;
  s2: number | null;
  s3: number | null;
  s4: number | null;
  s5: number | null;
  p1: number | null;
  p2: number | null;
  p3: number | null;
  p4: number | null;
  p5: number | null;
  gender: string | null;
  age: number | null;
  education: string | null;
  experience: string | null;
  stat_course: string | null;
  sumS: number | null;
  sumP: number | null;
}

export const trialCsvHeaders = [
  "session_id",
  "format_assignment",
  "stimulus_set_version",
  "catalog_hash",
  "dataset_classification",
  "trial_no",
  "pool",
  "sequence_uid",
  "canonical_key",
  "presentation_uid",
  "source_id",
  "stimulus_id",
  "display_index",
  "legacy_asset_no",
  "pair_uid",
  "format",
  "variant",
  "response_type",
  "legacy_path",
  "legacy_asset_path",
  "stimulus_path",
  "legacy_asset_sha256",
  "asset_sha256",
  "renderer_version",
  "video_playback_version",
  "playback_asset_path",
  "playback_asset_sha256",
  "video_replay_used",
  "video_replay_completed",
  "video_initial_restart_count",
  "values_sha256",
  "pool2_speed",
  "source_data_file",
  "rho",
  "trend",
  "beta",
  "condition",
  "tau_obs",
  "beta1",
  "beta2",
  "structure",
  "direction",
  "sigma1",
  "sigma2",
  "point",
  "trial_started_at",
  "trial_submitted_at",
  "trial_duration_ms",
  "visit_count",
  "revision_count",
  "fullscreen_open_count",
  "fullscreen_duration_ms",
  "asset_load_duration_ms",
  "asset_load_attempt_count",
  "asset_load_status",
  "s1",
  "s2",
  "s3",
  "s4",
  "s5",
  "p1",
  "p2",
  "p3",
  "p4",
  "p5",
  "gender",
  "age",
  "education",
  "experience",
  "stat_course",
  "sumS",
  "sumP"
] as const satisfies readonly (keyof ExperimentTrial)[];

export interface ExperimentPayload {
  session: ExperimentSession;
  trials: ExperimentTrial[];
  demographics: ExperimentDemographics;
}
