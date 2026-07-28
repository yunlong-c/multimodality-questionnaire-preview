import type {
  AssembledTrial,
  PoolName,
  ResponseType,
  StimulusFormat,
  StimulusPresentation,
  StimulusSequence
} from "./manifestTypes";
import { TABLE_RENDERER_VERSION } from "../experiment/seriesTableRenderer";
import { getVideoPlaybackMetadata } from "./videoPlaybackManifest.generated";

const EXPECTED_SEQUENCE_COUNTS: Readonly<Record<PoolName, number>> = {
  Pool_1: 80,
  Pool_2: 64,
  Pool_3: 64,
  Pool_4: 64
};

export function assertCatalogReady(
  catalog: readonly StimulusSequence[],
  stimulusSetVersion: string,
  catalogHash: string
): void {
  if (stimulusSetVersion !== "mmq-stimuli-2026-07-r1") {
    throw new Error(`Unexpected stimulus set version '${stimulusSetVersion}'.`);
  }
  if (!/^[a-f0-9]{64}$/i.test(catalogHash)) {
    throw new Error("Catalog hash is missing or is not a SHA-256 digest.");
  }

  const expectedTotal = Object.values(EXPECTED_SEQUENCE_COUNTS).reduce(
    (sum, count) => sum + count,
    0
  );
  if (catalog.length !== expectedTotal) {
    throw new Error(
      `Catalog release gate failed: expected ${expectedTotal} sequences, found ${catalog.length}.`
    );
  }

  const sequenceUids = new Set<string>();
  const canonicalKeys = new Set<string>();
  const presentationUids = new Set<string>();
  const sourceIdsByScope = new Map<string, Set<number>>();
  const displayIndexesByScope = new Map<string, Set<number>>();
  const legacyAssetNumbersByScope = new Map<string, Set<number>>();

  for (const sequence of catalog) {
    if (sequence.stimulus_set_version !== stimulusSetVersion) {
      throw new Error(`${sequence.sequence_uid} has a mismatched stimulus set version.`);
    }
    if (sequenceUids.has(sequence.sequence_uid)) {
      throw new Error(`Duplicate sequence_uid '${sequence.sequence_uid}'.`);
    }
    if (canonicalKeys.has(sequence.canonical_key)) {
      throw new Error(`Duplicate canonical_key '${sequence.canonical_key}'.`);
    }
    sequenceUids.add(sequence.sequence_uid);
    canonicalKeys.add(sequence.canonical_key);

    if (
      !Number.isInteger(sequence.source_id) ||
      !Number.isInteger(sequence.display_index) ||
      !Number.isInteger(sequence.legacy_asset_no)
    ) {
      throw new Error(`${sequence.sequence_uid} has a non-integer catalog identifier.`);
    }
    assertVariantAndAssetNumberRule(sequence);
    const scope = `${sequence.pool}:${sequence.variant}`;
    addUniqueScopedValue(
      sourceIdsByScope,
      scope,
      sequence.source_id,
      "source_id"
    );
    addUniqueScopedValue(
      displayIndexesByScope,
      scope,
      sequence.display_index,
      "display_index"
    );
    addUniqueScopedValue(
      legacyAssetNumbersByScope,
      scope,
      sequence.legacy_asset_no,
      "legacy_asset_no"
    );

    if (sequence.values.length !== 20 || sequence.values.some((value) => !Number.isFinite(value))) {
      throw new Error(`${sequence.sequence_uid} must contain exactly 20 finite values.`);
    }
    if (!/^[a-f0-9]{64}$/i.test(sequence.values_sha256)) {
      throw new Error(`${sequence.sequence_uid} has an invalid values_sha256.`);
    }
    assertResponseEligibility(sequence);

    for (const format of ["table", "graph", "video"] as const) {
      const presentation = sequence.presentations[format];
      assertPresentation(sequence, presentation, format, presentationUids);
    }
  }

  for (const [pool, expectedCount] of Object.entries(EXPECTED_SEQUENCE_COUNTS) as [
    PoolName,
    number
  ][]) {
    const actualCount = catalog.filter((sequence) => sequence.pool === pool).length;
    if (actualCount !== expectedCount) {
      throw new Error(
        `Catalog release gate failed for ${pool}: expected ${expectedCount}, found ${actualCount}.`
      );
    }
  }
}

function assertVariantAndAssetNumberRule(sequence: StimulusSequence): void {
  const isPool2 = sequence.pool === "Pool_2";
  if (isPool2 && sequence.variant !== "fast" && sequence.variant !== "slow") {
    throw new Error(`${sequence.sequence_uid} has an invalid Pool 2 variant.`);
  }
  if (!isPool2 && sequence.variant !== "base") {
    throw new Error(`${sequence.sequence_uid} must use the base variant.`);
  }

  const expectedAssetNumber =
    isPool2 && sequence.variant === "fast"
      ? sequence.source_id
      : sequence.display_index;
  if (sequence.legacy_asset_no !== expectedAssetNumber) {
    throw new Error(
      `${sequence.sequence_uid} violates the frozen legacy asset-number rule.`
    );
  }
}

function addUniqueScopedValue(
  valuesByScope: Map<string, Set<number>>,
  scope: string,
  value: number,
  field: string
): void {
  const values = valuesByScope.get(scope) ?? new Set<number>();
  if (values.has(value)) {
    throw new Error(`Duplicate ${field} '${value}' in catalog scope '${scope}'.`);
  }
  values.add(value);
  valuesByScope.set(scope, values);
}

export function selectExperimentTrials(
  catalog: readonly StimulusSequence[],
  formatAssignment: StimulusFormat,
  stimulusSetVersion: string,
  catalogHash: string
): AssembledTrial[] {
  assertCatalogReady(catalog, stimulusSetVersion, catalogHash);

  const trial1Sequence = pickRandomSequence(
    eligibleSequences(catalog, "Pool_1", "point_only")
  );
  const trial2Sequence = pickRandomSequence(
    eligibleSequences(catalog, "Pool_2", "point_only")
  );
  const trial3Sequence = pickRandomSequence(
    eligibleSequences(catalog, "Pool_3", "point_only")
  );
  const trial4Sequence = pickRandomSequence(
    eligibleSequences(catalog, "Pool_4", "point_only")
  );
  const trial5Sequence = pickRandomSequence(
    eligibleSequences(catalog, "Pool_1", "point_spd").filter(
      (sequence) => sequence.sequence_uid !== trial1Sequence.sequence_uid
    )
  );

  return [
    assembleTrial(trial1Sequence, formatAssignment, "point_only", 1, catalogHash),
    assembleTrial(trial2Sequence, formatAssignment, "point_only", 2, catalogHash),
    assembleTrial(trial3Sequence, formatAssignment, "point_only", 3, catalogHash),
    assembleTrial(trial4Sequence, formatAssignment, "point_only", 4, catalogHash),
    assembleTrial(trial5Sequence, formatAssignment, "point_spd", 5, catalogHash)
  ];
}

function eligibleSequences(
  catalog: readonly StimulusSequence[],
  pool: PoolName,
  responseType: ResponseType
): StimulusSequence[] {
  const sequences = catalog.filter(
    (sequence) =>
      sequence.pool === pool &&
      sequence.response_eligibility.includes(responseType)
  );
  if (sequences.length === 0) {
    throw new Error(`No ${pool} sequence is eligible for '${responseType}'.`);
  }
  return sequences;
}

function assembleTrial(
  sequence: StimulusSequence,
  format: StimulusFormat,
  responseType: ResponseType,
  trialNo: number,
  catalogHash: string
): AssembledTrial {
  const presentation = sequence.presentations[format];
  const usesLegacyAsset = format !== "table";
  const videoPlayback =
    format === "video"
      ? getVideoPlaybackMetadata(presentation.presentation_uid)
      : null;

  return {
    trial_no: trialNo,
    stimulus_set_version: sequence.stimulus_set_version,
    catalog_hash: catalogHash,
    sequence_uid: sequence.sequence_uid,
    canonical_key: sequence.canonical_key,
    presentation_uid: presentation.presentation_uid,
    pool: sequence.pool,
    variant: sequence.variant,
    source_id: sequence.source_id,
    display_index: sequence.display_index,
    legacy_asset_no: sequence.legacy_asset_no,
    pair_uid: sequence.pair_uid,
    response_type: responseType,
    format,
    values: sequence.values,
    values_sha256: sequence.values_sha256,
    legacy_path: presentation.legacy_path,
    legacy_asset_sha256: presentation.asset_sha256,
    asset_sha256:
      format === "video"
        ? videoPlayback?.playback_asset_sha256 ?? null
        : usesLegacyAsset
          ? presentation.asset_sha256
          : null,
    renderer_version: usesLegacyAsset
      ? null
      : TABLE_RENDERER_VERSION,
    terminal_frame_path: presentation.terminal_frame_path ?? null,
    terminal_frame_sha256: presentation.terminal_frame_sha256 ?? null,
    reveal_duration_ms:
      videoPlayback?.reveal_duration_ms ??
      presentation.reveal_duration_ms ??
      null,
    video_playback_version: videoPlayback?.playback_version ?? null,
    playback_asset_path: videoPlayback?.playback_asset_path ?? null,
    playback_asset_sha256:
      videoPlayback?.playback_asset_sha256 ?? null,
    pool2_speed:
      sequence.pool === "Pool_2" && sequence.variant !== "base"
        ? sequence.variant
        : null,
    source_data_file: sequence.source_data_file,
    metadata: sequence.metadata ?? {}
  };
}

function assertResponseEligibility(sequence: StimulusSequence): void {
  const expected: readonly ResponseType[] =
    sequence.pool === "Pool_1"
      ? ["point_only", "point_spd"]
      : ["point_only"];
  const actual = [...sequence.response_eligibility].sort();

  if (
    actual.length !== expected.length ||
    expected.some((responseType) => !actual.includes(responseType))
  ) {
    throw new Error(
      `${sequence.sequence_uid} has invalid response eligibility: ${actual.join(", ")}.`
    );
  }
}

function assertPresentation(
  sequence: StimulusSequence,
  presentation: StimulusPresentation | undefined,
  expectedFormat: StimulusFormat,
  presentationUids: Set<string>
): void {
  if (!presentation || presentation.format !== expectedFormat) {
    throw new Error(`${sequence.sequence_uid} is missing its ${expectedFormat} presentation.`);
  }
  if (presentationUids.has(presentation.presentation_uid)) {
    throw new Error(`Duplicate presentation_uid '${presentation.presentation_uid}'.`);
  }
  presentationUids.add(presentation.presentation_uid);

  if (!presentation.legacy_path || !/^[a-f0-9]{64}$/i.test(presentation.asset_sha256)) {
    throw new Error(`${presentation.presentation_uid} has incomplete legacy asset provenance.`);
  }
  if (expectedFormat === "table" && !presentation.renderer_version) {
    throw new Error(`${presentation.presentation_uid} has no HTML renderer version.`);
  }
}

function pickRandomSequence<T>(sequences: readonly T[]): T {
  if (sequences.length === 0) {
    throw new Error("Cannot sample from an empty sequence set.");
  }
  return sequences[Math.floor(Math.random() * sequences.length)];
}
