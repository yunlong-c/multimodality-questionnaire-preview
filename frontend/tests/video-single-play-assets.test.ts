import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { makeSinglePlayGif, sha256 } from "../scripts/singlePlayGif";
import { sequenceCatalog } from "../src/data/sequenceCatalog.generated";
import {
  VIDEO_PLAYBACK_VERSION,
  VIDEO_REVEAL_DURATION_MS,
  videoPlaybackManifestByPresentationUid,
} from "../src/data/videoPlaybackManifest.generated";

const frontendRoot = fileURLToPath(new URL("../", import.meta.url));
const manifest = videoPlaybackManifestByPresentationUid as Readonly<
  Record<
    string,
    {
      presentation_uid: string;
      sequence_uid: string;
      playback_version: string;
      source_asset_path: string;
      source_asset_sha256: string;
      playback_asset_path: string;
      playback_asset_sha256: string;
      reveal_duration_ms: number;
      frame_count: number;
      total_duration_ms: number;
      source_loop_count: number;
      loop_removed: boolean;
    }
  >
>;

test(
  "all 272 derived GIF definitions remove only the loop extension",
  { timeout: 120_000 },
  () => {
    assert.equal(VIDEO_PLAYBACK_VERSION, "single-play-gif-v1");
    assert.equal(VIDEO_REVEAL_DURATION_MS, 31_450);
    assert.equal(sequenceCatalog.length, 272);
    assert.equal(Object.keys(manifest).length, 272);

    const playbackPaths = new Set<string>();
    const playbackHashes = new Set<string>();
    const sourceHashes = new Set<string>();

    for (const sequence of sequenceCatalog) {
      const video = sequence.presentations.video;
      const metadata = manifest[video.presentation_uid];
      assert.ok(metadata, video.presentation_uid);
      assert.equal(metadata.presentation_uid, video.presentation_uid);
      assert.equal(metadata.sequence_uid, sequence.sequence_uid);
      assert.equal(metadata.playback_version, VIDEO_PLAYBACK_VERSION);
      assert.equal(metadata.source_asset_path, video.legacy_path);
      assert.equal(metadata.source_asset_sha256, video.asset_sha256);
      assert.equal(
        metadata.playback_asset_path,
        `assets/video-single-play-v1/${sequence.sequence_uid}.gif`,
      );
      assert.equal(metadata.reveal_duration_ms, VIDEO_REVEAL_DURATION_MS);
      assert.equal(metadata.frame_count, video.gif_frame_count);
      assert.equal(metadata.total_duration_ms, video.gif_total_duration_ms);
      assert.equal(metadata.source_loop_count, 0);
      assert.equal(metadata.loop_removed, true);

      const sourcePath = path.join(
        frontendRoot,
        "public",
        ...video.legacy_path.split("/"),
      );
      const before = statSync(sourcePath);
      const sourceBytes = readFileSync(sourcePath);
      assert.equal(sha256(sourceBytes), video.asset_sha256);
      const transformed = makeSinglePlayGif(sourceBytes);
      const after = statSync(sourcePath);

      assert.equal(after.size, before.size, sequence.sequence_uid);
      assert.equal(after.mtimeMs, before.mtimeMs, sequence.sequence_uid);
      assert.equal(
        transformed.removedLoopExtensions.length,
        1,
        sequence.sequence_uid,
      );
      assert.equal(
        transformed.removedLoopExtensions[0].applicationIdentifier,
        "NETSCAPE2.0",
        sequence.sequence_uid,
      );
      assert.equal(
        transformed.removedLoopExtensions[0].loopCount,
        0,
        sequence.sequence_uid,
      );
      assert.equal(
        transformed.derivedInspection.loopApplicationExtensions.length,
        0,
        sequence.sequence_uid,
      );
      assert.equal(
        transformed.sourceInspection.finalFrameOnsetMs,
        VIDEO_REVEAL_DURATION_MS,
        sequence.sequence_uid,
      );
      assert.equal(
        sha256(transformed.bytes),
        metadata.playback_asset_sha256,
        sequence.sequence_uid,
      );
      assert.notEqual(
        metadata.playback_asset_sha256,
        metadata.source_asset_sha256,
        sequence.sequence_uid,
      );

      playbackPaths.add(metadata.playback_asset_path);
      playbackHashes.add(metadata.playback_asset_sha256);
      sourceHashes.add(metadata.source_asset_sha256);
    }

    assert.equal(playbackPaths.size, 272);
    assert.equal(playbackHashes.size, 272);
    assert.equal(sourceHashes.size, 272);
    assert.equal(
      [...playbackHashes].some((hash) => sourceHashes.has(hash)),
      false,
    );
  },
);

test("ANIMEXTS1.0 loop extensions are removed without re-encoding", () => {
  const sample = sequenceCatalog[0].presentations.video;
  const sourcePath = path.join(
    frontendRoot,
    "public",
    ...sample.legacy_path.split("/"),
  );
  const sourceBytes = Buffer.from(readFileSync(sourcePath));
  const identifierOffset = sourceBytes.indexOf(
    Buffer.from("NETSCAPE2.0", "ascii"),
  );
  assert.notEqual(identifierOffset, -1);
  Buffer.from("ANIMEXTS1.0", "ascii").copy(
    sourceBytes,
    identifierOffset,
  );

  const transformed = makeSinglePlayGif(sourceBytes);
  assert.equal(
    transformed.removedLoopExtensions[0].applicationIdentifier,
    "ANIMEXTS1.0",
  );
  assert.equal(
    transformed.sourceInspection.frameCount,
    transformed.derivedInspection.frameCount,
  );
  assert.deepEqual(
    transformed.sourceInspection.frameDelaysCentiseconds,
    transformed.derivedInspection.frameDelaysCentiseconds,
  );
});
