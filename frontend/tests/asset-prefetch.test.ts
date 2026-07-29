import assert from "node:assert/strict";
import test from "node:test";

import { buildExperimentTrials } from "../src/data/officialManifest";
import {
  createStimulusPrefetchManager,
  getStimulusPrefetchUrl,
  prefetchNextStimulus
} from "../src/experiment/assetPrefetch";

async function flushPrefetch(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

test("prefetch selection uses only the next Graph PNG or approved Video GIF", () => {
  const table = buildExperimentTrials("table")[0];
  const graph = buildExperimentTrials("graph")[0];
  const video = buildExperimentTrials("video")[0];

  assert.equal(getStimulusPrefetchUrl(table), null);
  assert.equal(getStimulusPrefetchUrl(undefined), null);
  assert.equal(
    getStimulusPrefetchUrl(graph),
    `/${graph.legacy_path}`
  );
  assert.equal(
    getStimulusPrefetchUrl(video),
    `/${video.playback_asset_path}`
  );
  assert.notEqual(
    getStimulusPrefetchUrl(video),
    `/${video.legacy_path}`
  );
  assert.doesNotMatch(
    getStimulusPrefetchUrl(video) ?? "",
    /video-final-frames/
  );
  assert.equal(
    getStimulusPrefetchUrl({
      ...video,
      video_playback_version: null
    }),
    null
  );
});

test("prefetch downloads an asset once with force-cache and consumes its body", async () => {
  const graph = buildExperimentTrials("graph")[1];
  const requests: Array<{
    input: RequestInfo | URL;
    init: RequestInit | undefined;
  }> = [];
  let bodyConsumed = false;
  const manager = createStimulusPrefetchManager({
    fetchImpl: async (input, init) => {
      requests.push({ input, init });
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => {
          bodyConsumed = true;
          return new ArrayBuffer(8);
        }
      } as Response;
    }
  });

  manager.prefetch(graph);
  manager.prefetch(graph);
  await flushPrefetch();

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.input, `/${graph.legacy_path}`);
  assert.equal(requests[0]?.init?.method, "GET");
  assert.equal(requests[0]?.init?.cache, "force-cache");
  assert.equal(requests[0]?.init?.credentials, "same-origin");
  assert.equal(bodyConsumed, true);
  manager.dispose();
});

test("only the immediate next trial is prefetched and the final trial is a no-op", async () => {
  const stimuli = buildExperimentTrials("graph");
  const requestedUrls: string[] = [];
  const manager = createStimulusPrefetchManager({
    fetchImpl: async (input) => {
      requestedUrls.push(String(input));
      return new Response(new Uint8Array([1]), { status: 200 });
    }
  });

  prefetchNextStimulus(manager, stimuli, 0);
  await flushPrefetch();
  assert.deepEqual(requestedUrls, [`/${stimuli[1]?.legacy_path}`]);

  prefetchNextStimulus(manager, stimuli, stimuli.length - 1);
  await flushPrefetch();
  assert.equal(requestedUrls.length, 1);
  manager.dispose();
});

test("Table trials never issue asset prefetch requests", async () => {
  const stimuli = buildExperimentTrials("table");
  let requestCount = 0;
  const manager = createStimulusPrefetchManager({
    fetchImpl: async () => {
      requestCount += 1;
      return new Response(new Uint8Array([1]), { status: 200 });
    }
  });

  prefetchNextStimulus(manager, stimuli, 0);
  await flushPrefetch();

  assert.equal(requestCount, 0);
  manager.dispose();
});

test("prefetch failures stay silent and are not retried during back navigation", async () => {
  const video = buildExperimentTrials("video")[2];
  let requestCount = 0;
  const manager = createStimulusPrefetchManager({
    fetchImpl: async () => {
      requestCount += 1;
      throw new Error("simulated network failure");
    }
  });

  manager.prefetch(video);
  await flushPrefetch();
  manager.prefetch(video);
  await flushPrefetch();

  assert.equal(requestCount, 1);
  manager.dispose();
});

test("synchronous prefetch setup failures stay silent", () => {
  const graph = buildExperimentTrials("graph")[4];
  const manager = createStimulusPrefetchManager({
    fetchImpl: () => {
      throw new Error("simulated synchronous failure");
    }
  });

  assert.doesNotThrow(() => manager.prefetch(graph));
  manager.dispose();
});

test("disposing the questionnaire aborts an unfinished prefetch", async () => {
  const graph = buildExperimentTrials("graph")[3];
  let aborted = false;
  const manager = createStimulusPrefetchManager({
    fetchImpl: async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            aborted = true;
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          },
          { once: true }
        );
      })
  });

  manager.prefetch(graph);
  manager.dispose();
  await flushPrefetch();

  assert.equal(aborted, true);
  manager.prefetch(buildExperimentTrials("video")[0]);
  await flushPrefetch();
  assert.equal(aborted, true);
});

test("starting a new target aborts the previous unfinished prefetch", async () => {
  const stimuli = buildExperimentTrials("graph");
  const requestedUrls: string[] = [];
  const signals: AbortSignal[] = [];
  let activeCount = 0;
  let maximumActiveCount = 0;
  const manager = createStimulusPrefetchManager({
    fetchImpl: async (input, init) =>
      new Promise<Response>((_resolve, reject) => {
        requestedUrls.push(String(input));
        const signal = init?.signal;
        assert.ok(signal);
        signals.push(signal);
        activeCount += 1;
        maximumActiveCount = Math.max(maximumActiveCount, activeCount);
        signal.addEventListener(
          "abort",
          () => {
            activeCount -= 1;
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          },
          { once: true }
        );
      })
  });

  manager.prefetch(stimuli[1]);
  manager.prefetch(stimuli[2]);
  await flushPrefetch();

  assert.deepEqual(requestedUrls, [
    `/${stimuli[1]?.legacy_path}`,
    `/${stimuli[2]?.legacy_path}`
  ]);
  assert.equal(signals[0]?.aborted, true);
  assert.equal(signals[1]?.aborted, false);
  assert.equal(maximumActiveCount, 1);
  manager.dispose();
  await flushPrefetch();
  assert.equal(signals[1]?.aborted, true);
});

test("prefetch timeout aborts silently", async () => {
  const graph = buildExperimentTrials("graph")[0];
  let aborted = false;
  const manager = createStimulusPrefetchManager({
    timeoutMs: 5,
    fetchImpl: async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            aborted = true;
            const error = new Error("timed out");
            error.name = "AbortError";
            reject(error);
          },
          { once: true }
        );
      })
  });

  assert.doesNotThrow(() => manager.prefetch(graph));
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 20);
  });
  assert.equal(aborted, true);
  manager.dispose();
});
