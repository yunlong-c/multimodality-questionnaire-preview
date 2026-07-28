import {
  access,
  copyFile,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sequenceCatalog } from "../src/data/sequenceCatalog.generated";
import {
  videoPlaybackManifestByPresentationUid,
  type VideoPlaybackMetadata,
} from "../src/data/videoPlaybackManifest.generated";
import { makeSinglePlayGif, sha256 } from "./singlePlayGif";

const EXPECTED_VIDEO_COUNT = 272;
const MIN_EXPECTED_DIST_BYTES = 880 * 1024 * 1024;
const MAX_EXPECTED_DIST_BYTES = 970 * 1024 * 1024;
const frontendRoot = fileURLToPath(new URL("../", import.meta.url));
const publicRoot = path.join(frontendRoot, "public");
const distRoot = path.join(frontendRoot, "dist");

const sourceVideoPaths = new Set(
  sequenceCatalog.map(
    (sequence) => sequence.presentations.video.legacy_path,
  ),
);

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

async function destinationExists(filename: string): Promise<boolean> {
  try {
    await access(filename, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function copyPublicTree(
  sourceDirectory: string,
  relativeDirectory = "",
): Promise<number> {
  let copiedCount = 0;
  const entries = await readdir(sourceDirectory, { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = relativeDirectory
      ? path.join(relativeDirectory, entry.name)
      : entry.name;
    const normalizedPath = normalizeRelativePath(relativePath);
    const sourcePath = path.join(sourceDirectory, entry.name);

    if (entry.isDirectory()) {
      if (normalizedPath === "assets/video-single-play-v1") {
        continue;
      }
      copiedCount += await copyPublicTree(sourcePath, relativePath);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(
        `Unsupported public asset entry (not a regular file): ` +
          `${sourcePath}`,
      );
    }
    if (sourceVideoPaths.has(normalizedPath)) {
      continue;
    }

    const destinationPath = path.join(distRoot, relativePath);
    if (await destinationExists(destinationPath)) {
      throw new Error(
        `Public asset would overwrite a Vite build output: ${normalizedPath}`,
      );
    }
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await copyFile(sourcePath, destinationPath);
    copiedCount += 1;
  }
  return copiedCount;
}

async function copyDerivedVideos(): Promise<number> {
  const manifestEntries = Object.values(
    videoPlaybackManifestByPresentationUid,
  ) as readonly VideoPlaybackMetadata[];
  if (manifestEntries.length !== EXPECTED_VIDEO_COUNT) {
    throw new Error(
      `Expected ${EXPECTED_VIDEO_COUNT} playback entries, found ` +
        `${manifestEntries.length}`,
    );
  }

  let copiedCount = 0;
  for (const metadata of manifestEntries) {
    const sourcePath = path.join(
      publicRoot,
      ...metadata.source_asset_path.split("/"),
    );
    const sourceBytes = await readFile(sourcePath);
    const sourceHash = sha256(sourceBytes);
    if (sourceHash !== metadata.source_asset_sha256) {
      throw new Error(
        `${metadata.sequence_uid}: source GIF hash mismatch; manifest has ` +
          `${metadata.source_asset_sha256}, file has ${sourceHash}`,
      );
    }
    const transformed = makeSinglePlayGif(sourceBytes);
    const playbackHash = sha256(transformed.bytes);
    if (playbackHash !== metadata.playback_asset_sha256) {
      throw new Error(
        `${metadata.sequence_uid}: single-play GIF hash mismatch; manifest ` +
          `has ${metadata.playback_asset_sha256}, build produced ` +
          `${playbackHash}`,
      );
    }

    const destinationPath = path.join(
      distRoot,
      ...metadata.playback_asset_path.split("/"),
    );
    if (await destinationExists(destinationPath)) {
      throw new Error(
        `Derived playback asset already exists in dist: ` +
          `${metadata.playback_asset_path}`,
      );
    }
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await writeFile(destinationPath, transformed.bytes, { flag: "wx" });
    copiedCount += 1;
  }
  return copiedCount;
}

interface DistInspection {
  bytes: number;
  gifPaths: string[];
}

async function inspectDistTree(
  directory: string,
  relativeDirectory = "",
): Promise<DistInspection> {
  let bytes = 0;
  const gifPaths: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = relativeDirectory
      ? path.join(relativeDirectory, entry.name)
      : entry.name;
    if (entry.isDirectory()) {
      const nested = await inspectDistTree(absolutePath, relativePath);
      bytes += nested.bytes;
      gifPaths.push(...nested.gifPaths);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(
        `Unsupported dist entry (not a regular file): ${absolutePath}`,
      );
    }
    bytes += (await stat(absolutePath)).size;
    if (path.extname(entry.name).toLowerCase() === ".gif") {
      gifPaths.push(normalizeRelativePath(relativePath));
    }
  }
  return { bytes, gifPaths };
}

async function main(): Promise<void> {
  if (process.env.MMQ_EXTERNAL_ASSETS === "true") {
    console.log(
      "Static asset assembly skipped because MMQ_EXTERNAL_ASSETS=true.",
    );
    return;
  }

  if (sourceVideoPaths.size !== EXPECTED_VIDEO_COUNT) {
    throw new Error(
      `Expected ${EXPECTED_VIDEO_COUNT} source Video paths, found ` +
        `${sourceVideoPaths.size}`,
    );
  }

  const publicFileCount = await copyPublicTree(publicRoot);
  const playbackFileCount = await copyDerivedVideos();

  for (const sourceVideoPath of sourceVideoPaths) {
    const forbiddenDistPath = path.join(
      distRoot,
      ...sourceVideoPath.split("/"),
    );
    if (await destinationExists(forbiddenDistPath)) {
      throw new Error(
        `Original looping GIF was published: ${sourceVideoPath}`,
      );
    }
  }

  const expectedPlaybackPaths = new Set(
    Object.values(videoPlaybackManifestByPresentationUid).map(
      (metadata) => metadata.playback_asset_path,
    ),
  );
  const distInspection = await inspectDistTree(distRoot);
  const actualGifPaths = new Set(distInspection.gifPaths);
  if (
    actualGifPaths.size !== EXPECTED_VIDEO_COUNT ||
    [...expectedPlaybackPaths].some(
      (playbackPath) => !actualGifPaths.has(playbackPath),
    ) ||
    [...actualGifPaths].some(
      (gifPath) => !expectedPlaybackPaths.has(gifPath),
    )
  ) {
    throw new Error(
      `Published GIF set is not exactly the ${EXPECTED_VIDEO_COUNT} ` +
        `single-play assets (found ${actualGifPaths.size})`,
    );
  }
  if (
    distInspection.bytes < MIN_EXPECTED_DIST_BYTES ||
    distInspection.bytes > MAX_EXPECTED_DIST_BYTES
  ) {
    throw new Error(
      `Unexpected dist size ${(distInspection.bytes / 1024 / 1024).toFixed(2)}` +
        `MiB; expected 880–970MiB without duplicate looping GIFs`,
    );
  }

  console.log(
    `Static asset assembly passed: copied ${publicFileCount} non-Video ` +
      `public files and ${playbackFileCount} single-play GIFs; ` +
      `no original looping GIFs were published; dist is ` +
      `${(distInspection.bytes / 1024 / 1024).toFixed(2)}MiB.`,
  );
}

await main();
