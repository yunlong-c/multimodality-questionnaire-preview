import assert from "node:assert/strict";
import test from "node:test";

import type { AssembledTrial } from "../src/data/manifestTypes";
import { buildExperimentTrials } from "../src/data/officialManifest";
import {
  attachStimulusInteractions,
  buildTrialHtml
} from "../src/experiment/trialRendering";
import { createQuestionnaireTrialState } from "../src/experiment/questionnaireState";
import {
  VIDEO_ASSET_LOAD_TIMEOUT_MS,
  VIDEO_COMPLETE_REVEAL_DURATION_MS,
  appendPlaybackFragment,
  beginPlaybackAfterLoad,
  getVideoHiddenAction,
  shouldShowVideoTerminalFrame,
  waitForImageLoad
} from "../src/experiment/videoAssetLoader";

class FakeImage extends EventTarget {
  complete = false;
  naturalWidth = 0;
  cleared = false;
  hidden = false;
  isConnected = true;
  dataset: Record<string, string> = {};
  classList = {
    add: (): void => undefined,
    remove: (): void => undefined
  };
  private source = "";
  private attributes = new Map<string, string>();

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
    this.attributes.delete(name);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
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

class AutoLoadingImage extends FakeImage {
  constructor() {
    super();
    this.complete = true;
    this.naturalWidth = 100;
  }
}

class FakeControl extends EventTarget {
  hidden = false;
  disabled = false;
  textContent: string | null = "";
}

class FakeVideoContainer {
  constructor(
    private readonly elements: Map<string, unknown>
  ) {}

  querySelector<T>(selector: string): T | null {
    return (this.elements.get(selector) ?? null) as T | null;
  }
}

class FakePlaybackDocument extends EventTarget {
  hidden = false;
  title = "video test";

  constructor(
    private readonly image: FakeImage,
    private readonly container: FakeVideoContainer
  ) {
    super();
  }

  querySelector<T>(selector: string): T | null {
    if (selector === "[data-fullscreen-media]") {
      return this.image as T;
    }
    if (selector === "[data-video-stimulus]") {
      return this.container as T;
    }
    return null;
  }
}

interface PlaybackHarness {
  document: FakePlaybackDocument;
  image: AutoLoadingImage;
  replayButton: FakeControl;
  retryButton: FakeControl;
  timers: Map<number, () => void>;
  restore: () => void;
}

function installPlaybackHarness(): PlaybackHarness {
  const image = new AutoLoadingImage();
  image.hidden = true;
  image.dataset.gifSrc = "/assets/video-single-play-v1/test.gif";
  image.dataset.terminalFrameSrc = "/assets/video-final-frames/test.png";
  const replayButton = new FakeControl();
  const retryButton = new FakeControl();
  const loadingPanel = new FakeControl();
  const loadingText = new FakeControl();
  const status = new FakeControl();
  const container = new FakeVideoContainer(
    new Map<string, unknown>([
      ["[data-video-image]", image],
      ["[data-video-replay]", replayButton],
      ["[data-video-retry]", retryButton],
      ["[data-video-loading]", loadingPanel],
      ["[data-video-loading-text]", loadingText],
      ["[data-video-status]", status]
    ])
  );
  const document = new FakePlaybackDocument(image, container);
  const timers = new Map<number, () => void>();
  let nextTimerId = 1;
  const fakeWindow = {
    setTimeout(callback: () => void, delayMs: number): number {
      assert.equal(delayMs, VIDEO_COMPLETE_REVEAL_DURATION_MS);
      const timerId = nextTimerId;
      nextTimerId += 1;
      timers.set(timerId, callback);
      return timerId;
    },
    clearTimeout(timerId: number): void {
      timers.delete(timerId);
    }
  };

  const documentDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "document"
  );
  const windowDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "window"
  );
  const imageDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "Image"
  );
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: document
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: fakeWindow
  });
  Object.defineProperty(globalThis, "Image", {
    configurable: true,
    value: AutoLoadingImage
  });

  const restoreProperty = (
    name: "document" | "window" | "Image",
    descriptor: PropertyDescriptor | undefined
  ): void => {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, name);
    }
  };

  return {
    document,
    image,
    replayButton,
    retryButton,
    timers,
    restore: () => {
      restoreProperty("document", documentDescriptor);
      restoreProperty("window", windowDescriptor);
      restoreProperty("Image", imageDescriptor);
    }
  };
}

async function flushPlaybackLoading(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function runOnlyPlaybackTimer(timers: Map<number, () => void>): void {
  assert.equal(timers.size, 1);
  const entry = timers.entries().next().value as
    | [number, () => void]
    | undefined;
  assert.ok(entry);
  timers.delete(entry[0]);
  entry[1]();
}

function videoStimulusStub(): AssembledTrial {
  return {
    format: "video",
    reveal_duration_ms: VIDEO_COMPLETE_REVEAL_DURATION_MS
  } as AssembledTrial;
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

test("stalled video loading times out and exposes a retryable failure", async () => {
  const image = new FakeImage();
  const loading = waitForImageLoad(
    asHtmlImage(image),
    "https://assets.example/video.gif",
    {
      clearOnAbort: true,
      timeoutMs: 5
    }
  );

  await assert.rejects(
    loading,
    (error: unknown) =>
      error instanceof Error &&
      error.name === "TimeoutError" &&
      /timed out after 5 ms/.test(error.message)
  );
  assert.equal(image.cleared, true);
  assert.equal(image.src, "");
  assert.equal(VIDEO_ASSET_LOAD_TIMEOUT_MS, 90_000);
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

test("video playback uses the audited complete reveal duration", () => {
  assert.equal(VIDEO_COMPLETE_REVEAL_DURATION_MS, 31_450);
});

test("visibility interruptions restart only the initial reveal", () => {
  assert.equal(
    getVideoHiddenAction("initial"),
    "restart_initial_when_visible"
  );
  assert.equal(
    getVideoHiddenAction("replay"),
    "finish_replay_on_terminal"
  );
  assert.equal(getVideoHiddenAction(null), "none");
});

test("natural completion keeps the single-play GIF node on its final frame", () => {
  assert.equal(
    shouldShowVideoTerminalFrame("natural_completion"),
    false
  );
  assert.equal(
    shouldShowVideoTerminalFrame("completed_revisit"),
    true
  );
  assert.equal(
    shouldShowVideoTerminalFrame("interrupted_replay"),
    true
  );
});

test("initial completion unlocks navigation without replacing the GIF source", async () => {
  const harness = installPlaybackHarness();
  const state = createQuestionnaireTrialState();
  const navigationLocks: boolean[] = [];
  let controller:
    | ReturnType<typeof attachStimulusInteractions>
    | undefined;

  try {
    controller = attachStimulusInteractions(
      videoStimulusStub(),
      state,
      (locked) => navigationLocks.push(locked)
    );
    await flushPlaybackLoading();

    assert.match(
      harness.image.src,
      /^\/assets\/video-single-play-v1\/test\.gif#playback=/
    );
    const playingSource = harness.image.src;
    runOnlyPlaybackTimer(harness.timers);

    assert.equal(state.videoRevealCompleted, true);
    assert.equal(harness.image.src, playingSource);
    assert.equal(navigationLocks.at(-1), false);

    controller.cleanup();
    controller = attachStimulusInteractions(
      videoStimulusStub(),
      state,
      (locked) => navigationLocks.push(locked)
    );
    assert.equal(
      harness.image.src,
      "/assets/video-final-frames/test.png"
    );
  } finally {
    controller?.cleanup();
    harness.restore();
  }
});

test("hidden initial playback restarts from the beginning without using replay", async () => {
  const harness = installPlaybackHarness();
  const state = createQuestionnaireTrialState();
  const controller = attachStimulusInteractions(
    videoStimulusStub(),
    state,
    () => undefined
  );

  try {
    await flushPlaybackLoading();
    assert.equal(harness.timers.size, 1);

    harness.document.hidden = true;
    harness.document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(harness.timers.size, 0);
    assert.equal(harness.image.src, "");
    assert.equal(state.videoRevealCompleted, false);
    assert.equal(state.videoInitialRestartCount, 0);

    harness.document.hidden = false;
    harness.document.dispatchEvent(new Event("visibilitychange"));
    await flushPlaybackLoading();

    assert.equal(state.videoInitialRestartCount, 1);
    assert.equal(state.videoReplayUsed, false);
    assert.match(
      harness.image.src,
      /^\/assets\/video-single-play-v1\/test\.gif#playback=/
    );
    runOnlyPlaybackTimer(harness.timers);
    assert.equal(state.videoRevealCompleted, true);
  } finally {
    controller.cleanup();
    harness.restore();
  }
});

test("hidden replay is not refunded and returns to the terminal frame", async () => {
  const harness = installPlaybackHarness();
  const state = createQuestionnaireTrialState();
  const controller = attachStimulusInteractions(
    videoStimulusStub(),
    state,
    () => undefined
  );

  try {
    await flushPlaybackLoading();
    runOnlyPlaybackTimer(harness.timers);
    harness.replayButton.dispatchEvent(new Event("click"));
    await flushPlaybackLoading();

    assert.equal(state.videoReplayUsed, true);
    assert.equal(state.videoReplayCompleted, false);
    assert.equal(harness.timers.size, 1);

    harness.document.hidden = true;
    harness.document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(harness.timers.size, 0);
    assert.equal(
      harness.image.src,
      "/assets/video-final-frames/test.png"
    );
    assert.equal(state.videoReplayUsed, true);
    assert.equal(state.videoReplayCompleted, false);

    harness.document.hidden = false;
    harness.document.dispatchEvent(new Event("visibilitychange"));
    await flushPlaybackLoading();
    assert.equal(harness.timers.size, 0);
    assert.equal(
      harness.image.src,
      "/assets/video-final-frames/test.png"
    );
  } finally {
    controller.cleanup();
    harness.restore();
  }
});

test("the single allowed replay completes in place without replacing the image", async () => {
  const harness = installPlaybackHarness();
  const state = createQuestionnaireTrialState();
  const controller = attachStimulusInteractions(
    videoStimulusStub(),
    state,
    () => undefined
  );

  try {
    await flushPlaybackLoading();
    runOnlyPlaybackTimer(harness.timers);
    harness.replayButton.dispatchEvent(new Event("click"));
    await flushPlaybackLoading();

    const replaySource = harness.image.src;
    runOnlyPlaybackTimer(harness.timers);
    assert.equal(state.videoReplayUsed, true);
    assert.equal(state.videoReplayCompleted, true);
    assert.equal(harness.image.src, replaySource);

    harness.replayButton.dispatchEvent(new Event("click"));
    await flushPlaybackLoading();
    assert.equal(harness.timers.size, 0);
    assert.equal(harness.image.src, replaySource);
  } finally {
    controller.cleanup();
    harness.restore();
  }
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
  assert.match(html, /data-video-playback-version="single-play-gif-v1"/);
  assert.match(html, /data-reveal-duration-ms="31450"/);
  assert.ok(stimulus.playback_asset_path);
  assert.match(
    imageTag,
    new RegExp(
      `data-gif-src="[^"]*${escapeRegExp(stimulus.playback_asset_path)}"`
    )
  );
  assert.doesNotMatch(
    imageTag,
    new RegExp(`data-gif-src="[^"]*${escapeRegExp(stimulus.legacy_path)}`)
  );
  assert.match(html, /加载完成后将自动开始/);
});
