import assert from "node:assert/strict";
import test from "node:test";

import { buildExperimentTrials } from "../src/data/officialManifest";
import { buildTrialHtml } from "../src/experiment/trialRendering";
import {
  appendPlaybackFragment,
  beginPlaybackAfterLoad,
  waitForImageLoad
} from "../src/experiment/videoAssetLoader";

class FakeImage extends EventTarget {
  complete = false;
  naturalWidth = 0;
  cleared = false;
  private source = "";

  get src(): string {
    return this.source;
  }

  set src(value: string) {
    this.source = value;
  }

  removeAttribute(name: string): void {
    if (name === "src") {
      this.source = "";
      this.cleared = true;
    }
  }
}

function asHtmlImage(image: FakeImage): HTMLImageElement {
  return image as unknown as HTMLImageElement;
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

test("playback timing starts only after preload and visible image readiness", async () => {
  const preload = deferred();
  const present = deferred();
  let presentStarted = false;
  let timingStarted = false;

  const playback = beginPlaybackAfterLoad({
    preload: () => preload.promise,
    present: () => {
      presentStarted = true;
      return present.promise;
    },
    onReady: () => {
      timingStarted = true;
    }
  });

  await Promise.resolve();
  assert.equal(presentStarted, false);
  assert.equal(timingStarted, false);

  preload.resolve();
  await Promise.resolve();
  assert.equal(presentStarted, true);
  assert.equal(timingStarted, false);

  present.resolve();
  await playback;
  assert.equal(timingStarted, true);
});

test("video image loading does not resolve before the load event", async () => {
  const image = new FakeImage();
  let resolved = false;
  const loading = waitForImageLoad(
    asHtmlImage(image),
    "https://assets.example/video.gif"
  ).then(() => {
    resolved = true;
  });

  await Promise.resolve();
  assert.equal(resolved, false);
  assert.equal(image.src, "https://assets.example/video.gif");

  image.naturalWidth = 100;
  image.dispatchEvent(new Event("load"));
  await loading;
  assert.equal(resolved, true);
});

test("video image loading rejects on network failure", async () => {
  const image = new FakeImage();
  const loading = waitForImageLoad(
    asHtmlImage(image),
    "https://assets.example/video.gif"
  );

  image.dispatchEvent(new Event("error"));
  await assert.rejects(loading, /Unable to load video asset/);
});

test("aborting video loading removes the pending image source", async () => {
  const image = new FakeImage();
  const controller = new AbortController();
  const loading = waitForImageLoad(
    asHtmlImage(image),
    "https://assets.example/video.gif",
    {
      signal: controller.signal,
      clearOnAbort: true
    }
  );

  controller.abort();
  await assert.rejects(
    loading,
    (error: unknown) =>
      error instanceof Error && error.name === "AbortError"
  );
  assert.equal(image.cleared, true);
  assert.equal(image.src, "");
});

test("playback restarts with a fragment without changing the network URL", () => {
  const source = "https://assets.example/video.gif?version=1";
  const playback = appendPlaybackFragment(source, "attempt-2");

  assert.equal(
    playback,
    "https://assets.example/video.gif?version=1#playback=attempt-2"
  );
  assert.equal(playback.split("#")[0], source);
});

test("video markup waits to assign the GIF source and exposes retry UI", () => {
  const stimulus = buildExperimentTrials("video")[0];
  assert.ok(stimulus);

  const html = buildTrialHtml(stimulus);
  const imageTag = html.match(/<img[\s\S]*?data-video-image[\s\S]*?>/)?.[0];

  assert.ok(imageTag);
  assert.doesNotMatch(imageTag, /\ssrc=/);
  assert.match(imageTag, /\shidden/);
  assert.match(html, /data-video-loading/);
  assert.match(html, /data-video-retry/);
  assert.match(html, /加载完成后将自动开始/);
});
