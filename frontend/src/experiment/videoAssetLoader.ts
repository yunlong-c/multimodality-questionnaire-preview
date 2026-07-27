export interface ImageLoadOptions {
  signal?: AbortSignal;
  clearOnAbort?: boolean;
  timeoutMs?: number;
}

export interface LoadedPlaybackOptions {
  preload: () => Promise<void>;
  present: () => Promise<void>;
  onReady: () => void;
}

export const VIDEO_ASSET_LOAD_TIMEOUT_MS = 90_000;

export async function beginPlaybackAfterLoad({
  preload,
  present,
  onReady
}: LoadedPlaybackOptions): Promise<void> {
  await preload();
  await present();
  onReady();
}

export function waitForImageLoad(
  image: HTMLImageElement,
  url: string,
  options: ImageLoadOptions = {}
): Promise<void> {
  if (!url.trim()) {
    return Promise.reject(new Error("Video asset URL is empty."));
  }

  const { signal, clearOnAbort = false, timeoutMs } = options;

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = (): void => {
      image.removeEventListener("load", handleLoad);
      image.removeEventListener("error", handleError);
      signal?.removeEventListener("abort", handleAbort);
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const finish = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback();
    };

    const handleLoad = (): void => {
      finish(resolve);
    };

    const handleError = (): void => {
      finish(() => reject(new Error(`Unable to load video asset: ${url}`)));
    };

    const handleAbort = (): void => {
      if (clearOnAbort) {
        image.removeAttribute("src");
      }
      const error = new Error("Video asset loading was cancelled.");
      error.name = "AbortError";
      finish(() => reject(error));
    };

    const handleTimeout = (): void => {
      image.removeAttribute("src");
      const error = new Error(
        `Video asset loading timed out after ${timeoutMs} ms.`
      );
      error.name = "TimeoutError";
      finish(() => reject(error));
    };

    if (signal?.aborted) {
      handleAbort();
      return;
    }

    image.addEventListener("load", handleLoad, { once: true });
    image.addEventListener("error", handleError, { once: true });
    signal?.addEventListener("abort", handleAbort, { once: true });
    if (
      timeoutMs !== undefined &&
      Number.isFinite(timeoutMs) &&
      timeoutMs > 0
    ) {
      timeoutId = setTimeout(handleTimeout, timeoutMs);
    }
    image.src = url;

    if (image.complete) {
      queueMicrotask(() => {
        if (image.naturalWidth > 0) {
          handleLoad();
        } else {
          handleError();
        }
      });
    }
  });
}

export function preloadImageAsset(
  url: string,
  signal?: AbortSignal,
  timeoutMs = VIDEO_ASSET_LOAD_TIMEOUT_MS
): Promise<void> {
  const preloader = new Image();
  return waitForImageLoad(preloader, url, {
    signal,
    clearOnAbort: true,
    timeoutMs
  });
}

export function appendPlaybackFragment(
  url: string,
  playbackToken = `${Date.now()}`
): string {
  const separator = url.includes("#") ? "&" : "#";
  return `${url}${separator}playback=${encodeURIComponent(playbackToken)}`;
}
