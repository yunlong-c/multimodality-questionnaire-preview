import { createHash } from "node:crypto";

const GIF_TRAILER = 0x3b;
const EXTENSION_INTRODUCER = 0x21;
const IMAGE_SEPARATOR = 0x2c;
const GRAPHIC_CONTROL_LABEL = 0xf9;
const APPLICATION_EXTENSION_LABEL = 0xff;
const PLAIN_TEXT_EXTENSION_LABEL = 0x01;
const LOOP_APPLICATION_IDENTIFIERS = new Set([
  "NETSCAPE2.0",
  "ANIMEXTS1.0",
]);

export interface GifLoopApplicationExtension {
  applicationIdentifier: string;
  loopCount: number | null;
  startOffset: number;
  endOffset: number;
}

export interface GifInspection {
  signature: "GIF87a" | "GIF89a";
  width: number;
  height: number;
  frameCount: number;
  frameDelaysCentiseconds: readonly number[];
  totalDurationMs: number;
  finalFrameOnsetMs: number;
  loopApplicationExtensions: readonly GifLoopApplicationExtension[];
}

export interface SinglePlayGifResult {
  bytes: Buffer;
  sourceInspection: GifInspection;
  derivedInspection: GifInspection;
  removedLoopExtensions: readonly GifLoopApplicationExtension[];
}

function fail(message: string): never {
  throw new Error(`Invalid GIF: ${message}`);
}

function requireBytes(
  bytes: Buffer,
  offset: number,
  length: number,
  label: string,
): void {
  if (
    !Number.isInteger(offset) ||
    !Number.isInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > bytes.length
  ) {
    fail(
      `${label} exceeds the file at byte ${offset} ` +
        `(need ${length}, size ${bytes.length})`,
    );
  }
}

function readUnsignedShort(bytes: Buffer, offset: number): number {
  requireBytes(bytes, offset, 2, "unsigned short");
  return bytes[offset] | (bytes[offset + 1] << 8);
}

interface SubBlockResult {
  endOffset: number;
  blocks: readonly Buffer[];
}

function readSubBlocks(bytes: Buffer, startOffset: number): SubBlockResult {
  const blocks: Buffer[] = [];
  let offset = startOffset;

  while (true) {
    requireBytes(bytes, offset, 1, "sub-block length");
    const length = bytes[offset];
    offset += 1;
    if (length === 0) {
      return { endOffset: offset, blocks };
    }
    requireBytes(bytes, offset, length, "sub-block payload");
    blocks.push(bytes.subarray(offset, offset + length));
    offset += length;
  }
}

function colorTableByteLength(packedField: number): number {
  if ((packedField & 0x80) === 0) {
    return 0;
  }
  return 3 * 2 ** ((packedField & 0x07) + 1);
}

function loopCountFromSubBlocks(
  blocks: readonly Buffer[],
): number | null {
  const firstBlock = blocks[0];
  if (
    !firstBlock ||
    firstBlock.length < 3 ||
    firstBlock[0] !== 0x01
  ) {
    return null;
  }
  return firstBlock[1] | (firstBlock[2] << 8);
}

export function inspectGif(bytes: Buffer): GifInspection {
  requireBytes(bytes, 0, 13, "GIF header and logical screen descriptor");
  const signature = bytes.subarray(0, 6).toString("ascii");
  if (signature !== "GIF87a" && signature !== "GIF89a") {
    fail(`unsupported signature ${JSON.stringify(signature)}`);
  }

  const width = readUnsignedShort(bytes, 6);
  const height = readUnsignedShort(bytes, 8);
  const globalColorTableLength = colorTableByteLength(bytes[10]);
  requireBytes(
    bytes,
    13,
    globalColorTableLength,
    "global color table",
  );

  let offset = 13 + globalColorTableLength;
  let pendingFrameDelayCentiseconds = 0;
  let foundTrailer = false;
  const frameDelaysCentiseconds: number[] = [];
  const loopApplicationExtensions: GifLoopApplicationExtension[] = [];

  while (offset < bytes.length) {
    const blockStart = offset;
    const blockType = bytes[offset];

    if (blockType === GIF_TRAILER) {
      offset += 1;
      foundTrailer = true;
      break;
    }

    if (blockType === IMAGE_SEPARATOR) {
      requireBytes(bytes, offset, 10, "image descriptor");
      const localColorTableLength = colorTableByteLength(bytes[offset + 9]);
      offset += 10;
      requireBytes(
        bytes,
        offset,
        localColorTableLength,
        "local color table",
      );
      offset += localColorTableLength;
      requireBytes(bytes, offset, 1, "LZW minimum code size");
      offset += 1;
      offset = readSubBlocks(bytes, offset).endOffset;
      frameDelaysCentiseconds.push(pendingFrameDelayCentiseconds);
      pendingFrameDelayCentiseconds = 0;
      continue;
    }

    if (blockType !== EXTENSION_INTRODUCER) {
      fail(
        `unexpected block marker 0x${blockType.toString(16)} ` +
          `at byte ${offset}`,
      );
    }

    requireBytes(bytes, offset, 2, "extension introducer");
    const extensionLabel = bytes[offset + 1];

    if (extensionLabel === GRAPHIC_CONTROL_LABEL) {
      requireBytes(bytes, offset, 3, "graphic control extension");
      const blockLength = bytes[offset + 2];
      if (blockLength !== 4) {
        fail(
          `graphic control extension at byte ${offset} has ` +
            `block size ${blockLength}, expected 4`,
        );
      }
      requireBytes(bytes, offset + 3, blockLength + 1, "graphic control data");
      pendingFrameDelayCentiseconds = readUnsignedShort(bytes, offset + 4);
      const terminatorOffset = offset + 3 + blockLength;
      if (bytes[terminatorOffset] !== 0x00) {
        fail(
          `graphic control extension at byte ${offset} has no terminator`,
        );
      }
      offset = terminatorOffset + 1;
      continue;
    }

    if (extensionLabel === APPLICATION_EXTENSION_LABEL) {
      requireBytes(bytes, offset, 3, "application extension");
      const identifierLength = bytes[offset + 2];
      requireBytes(
        bytes,
        offset + 3,
        identifierLength,
        "application identifier",
      );
      const applicationIdentifier = bytes
        .subarray(offset + 3, offset + 3 + identifierLength)
        .toString("ascii");
      const subBlocks = readSubBlocks(
        bytes,
        offset + 3 + identifierLength,
      );
      offset = subBlocks.endOffset;

      if (LOOP_APPLICATION_IDENTIFIERS.has(applicationIdentifier)) {
        loopApplicationExtensions.push({
          applicationIdentifier,
          loopCount: loopCountFromSubBlocks(subBlocks.blocks),
          startOffset: blockStart,
          endOffset: offset,
        });
      }
      continue;
    }

    if (extensionLabel === PLAIN_TEXT_EXTENSION_LABEL) {
      requireBytes(bytes, offset, 3, "plain-text extension");
      const headerLength = bytes[offset + 2];
      requireBytes(
        bytes,
        offset + 3,
        headerLength,
        "plain-text extension header",
      );
      offset = readSubBlocks(bytes, offset + 3 + headerLength).endOffset;
      continue;
    }

    offset = readSubBlocks(bytes, offset + 2).endOffset;
  }

  if (!foundTrailer) {
    fail("missing GIF trailer");
  }
  if (offset !== bytes.length) {
    fail(`${bytes.length - offset} trailing byte(s) after the GIF trailer`);
  }
  if (frameDelaysCentiseconds.length === 0) {
    fail("contains no image frames");
  }

  const totalDurationMs =
    frameDelaysCentiseconds.reduce((sum, delay) => sum + delay, 0) * 10;
  const lastFrameDurationMs =
    frameDelaysCentiseconds[frameDelaysCentiseconds.length - 1] * 10;

  return {
    signature,
    width,
    height,
    frameCount: frameDelaysCentiseconds.length,
    frameDelaysCentiseconds,
    totalDurationMs,
    finalFrameOnsetMs: totalDurationMs - lastFrameDurationMs,
    loopApplicationExtensions,
  };
}

function inspectionsHaveIdenticalPlayback(
  source: GifInspection,
  derived: GifInspection,
): boolean {
  return (
    source.signature === derived.signature &&
    source.width === derived.width &&
    source.height === derived.height &&
    source.frameCount === derived.frameCount &&
    source.totalDurationMs === derived.totalDurationMs &&
    source.finalFrameOnsetMs === derived.finalFrameOnsetMs &&
    source.frameDelaysCentiseconds.length ===
      derived.frameDelaysCentiseconds.length &&
    source.frameDelaysCentiseconds.every(
      (delay, index) => delay === derived.frameDelaysCentiseconds[index],
    )
  );
}

export function makeSinglePlayGif(sourceBytes: Buffer): SinglePlayGifResult {
  const sourceInspection = inspectGif(sourceBytes);
  const removedLoopExtensions =
    sourceInspection.loopApplicationExtensions;

  if (removedLoopExtensions.length !== 1) {
    throw new Error(
      `Expected exactly one GIF loop application extension, found ` +
        `${removedLoopExtensions.length}`,
    );
  }
  if (removedLoopExtensions[0].loopCount !== 0) {
    throw new Error(
      `Expected the source GIF to loop infinitely (loop count 0), found ` +
        `${String(removedLoopExtensions[0].loopCount)}`,
    );
  }

  const segments: Buffer[] = [];
  let sourceOffset = 0;
  for (const extension of removedLoopExtensions) {
    segments.push(sourceBytes.subarray(sourceOffset, extension.startOffset));
    sourceOffset = extension.endOffset;
  }
  segments.push(sourceBytes.subarray(sourceOffset));
  const bytes = Buffer.concat(segments);
  const derivedInspection = inspectGif(bytes);

  if (derivedInspection.loopApplicationExtensions.length !== 0) {
    throw new Error("Derived GIF still contains a loop application extension");
  }
  if (
    !inspectionsHaveIdenticalPlayback(
      sourceInspection,
      derivedInspection,
    )
  ) {
    throw new Error(
      "Removing the loop extension changed GIF frames, dimensions, or timing",
    );
  }

  const removedByteCount = removedLoopExtensions.reduce(
    (sum, extension) =>
      sum + extension.endOffset - extension.startOffset,
    0,
  );
  if (sourceBytes.length - bytes.length !== removedByteCount) {
    throw new Error(
      "Derived GIF differs by more than the approved loop extension bytes",
    );
  }

  return {
    bytes,
    sourceInspection,
    derivedInspection,
    removedLoopExtensions,
  };
}

export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
