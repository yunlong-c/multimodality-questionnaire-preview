export type StimulusFormat = "table" | "graph" | "video";
export type ResponseType = "point_only" | "point_spd";
export type PoolName = "Pool_1" | "Pool_2" | "Pool_3" | "Pool_4";
export type PoolVariant = "base" | "fast" | "slow";

export interface StimulusMetadata {
  rho?: number | null;
  trend?: string | null;
  beta?: number | null;
  condition?: string | null;
  tau_obs?: number | null;
  beta1?: number | null;
  beta2?: number | null;
  structure?: string | null;
  direction?: string | null;
  sigma1?: number | null;
  sigma2?: number | null;
}

/**
 * A modality-specific rendering of one underlying sequence.
 *
 * `legacy_path` is retained for auditability. The table presentation is rendered
 * from `StimulusSequence.values`, so its legacy PNG is never participant-facing.
 */
export interface StimulusPresentation {
  presentation_uid: string;
  presentation_revision?: number;
  format: StimulusFormat;
  legacy_path: string;
  asset_sha256: string;
  semantic_qc?: string;
  renderer_version?: string | null;
  terminal_frame_path?: string | null;
  terminal_frame_sha256?: string | null;
  reveal_duration_ms?: number | null;
  gif_frame_count?: number | null;
  gif_total_duration_ms?: number | null;
  gif_loop?: number | null;
}

/**
 * Canonical, modality-independent research stimulus.
 *
 * A sequence occurs exactly once in the catalog. Pool 1 can be eligible for two
 * response roles without duplicating the sequence or any presentation.
 */
export interface StimulusSequence {
  stimulus_set_version: string;
  sequence_uid: string;
  sequence_revision?: number;
  canonical_key: string;
  pool: PoolName;
  variant: PoolVariant;
  source_id: number;
  display_index: number;
  legacy_asset_no: number;
  pair_uid: string | null;
  response_eligibility: readonly ResponseType[];
  values: readonly number[];
  values_sha256: string;
  source_data_file: string;
  source_sheet?: string;
  source_row?: number;
  metadata: StimulusMetadata | null;
  presentations: Record<StimulusFormat, StimulusPresentation>;
}

export interface AssembledTrial {
  trial_no: number;
  stimulus_set_version: string;
  catalog_hash: string;
  sequence_uid: string;
  canonical_key: string;
  presentation_uid: string;
  pool: PoolName;
  variant: PoolVariant;
  source_id: number;
  display_index: number;
  legacy_asset_no: number;
  pair_uid: string | null;
  response_type: ResponseType;
  format: StimulusFormat;
  values: readonly number[];
  values_sha256: string;
  legacy_path: string;
  legacy_asset_sha256: string;
  asset_sha256: string | null;
  renderer_version: string | null;
  terminal_frame_path: string | null;
  terminal_frame_sha256: string | null;
  reveal_duration_ms: number | null;
  video_playback_version: string | null;
  playback_asset_path: string | null;
  playback_asset_sha256: string | null;
  pool2_speed: "fast" | "slow" | null;
  source_data_file: string;
  metadata: StimulusMetadata;
}
