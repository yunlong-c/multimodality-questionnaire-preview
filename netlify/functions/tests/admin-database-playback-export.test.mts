import assert from "node:assert/strict";
import test from "node:test";

import {
  PostgresAdminRepository,
} from "../_lib/admin-database.mts";

const PLAYBACK_FIELDS = {
  video_playback_version: "single-play-gif-v1",
  playback_asset_path: "assets/video-single-play-v1/example.gif",
  playback_asset_sha256: "a".repeat(64),
  video_replay_used: false,
  video_replay_completed: false,
  video_initial_restart_count: 0,
};

function storedRow(
  receiptId: string,
  includePlaybackFields: boolean,
) {
  const trial = includePlaybackFields
    ? { trial_no: 1, ...PLAYBACK_FIELDS }
    : { trial_no: 1 };
  return {
    receipt_id: receiptId,
    session_id: `session-${receiptId}`,
    participant_id: `participant-${receiptId}`,
    dataset_classification: "formal",
    format_assignment: "video",
    payload_sha256: "b".repeat(64),
    payload_json: {
      session: {
        session_id: `session-${receiptId}`,
        participant_id: `participant-${receiptId}`,
      },
      demographics: {},
      trials: Array.from({ length: 5 }, (_, index) => ({
        ...trial,
        trial_no: index + 1,
      })),
    },
  };
}

class ExportPool {
  private call = 0;

  async query(): Promise<{
    rows: Record<string, unknown>[];
    rowCount: number;
  }> {
    this.call += 1;
    if (this.call % 2 === 1) {
      return { rows: [{ row_count: 2 }], rowCount: 1 };
    }
    return {
      rows: [
        storedRow("legacy", false),
        storedRow("current", true),
      ],
      rowCount: 2,
    };
  }
}

test("researcher CSV exports classify old playback records and leave new columns blank", async () => {
  const repository = new PostgresAdminRepository(
    new ExportPool(),
  );
  const common = {
    scope: "formal" as const,
    snapshotAt: "2026-07-28T00:00:00.000Z",
    offset: 0,
    limit: 100,
  };

  const participants = await repository.exportPage({
    ...common,
    format: "participants.csv",
  });
  assert.equal(
    participants.rows[0].video_playback_classification,
    "pre-single-play",
  );
  assert.equal(
    participants.rows[1].video_playback_classification,
    "single-play-gif-v1",
  );

  const trials = await repository.exportPage({
    ...common,
    format: "trials.csv",
  });
  assert.equal(trials.rows.length, 10);
  assert.ok(
    trials.rows.slice(0, 5).every(
      (row) =>
        row.video_playback_classification === "pre-single-play"
        && row.video_playback_version === ""
        && row.playback_asset_path === ""
        && row.playback_asset_sha256 === ""
        && row.video_replay_used === ""
        && row.video_replay_completed === ""
        && row.video_initial_restart_count === "",
    ),
  );
  assert.ok(
    trials.rows.slice(5).every(
      (row) =>
        row.video_playback_classification === "single-play-gif-v1"
        && row.video_playback_version === "single-play-gif-v1",
    ),
  );
});
