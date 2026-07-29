import { resolveAssetUrl } from "../config/assets";
import type { AssembledTrial } from "../data/manifestTypes";

export const STIMULUS_PREFETCH_TIMEOUT_MS = 90_000;

export type StimulusPrefetchFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export interface StimulusPrefetchManager {
  prefetch: (stimulus: AssembledTrial | undefined) => void;
  dispose: () => void;
}

export interface StimulusPrefetchManagerOptions {
  fetchImpl?: StimulusPrefetchFetch;
  timeoutMs?: number;
}

export function prefetchNextStimulus(
  manager: StimulusPrefetchManager,
  stimuli: readonly AssembledTrial[],
  currentTrialIndex: number
): void {
  manager.prefetch(stimuli[currentTrialIndex + 1]);
}

export function getStimulusPrefetchUrl(
  stimulus: AssembledTrial | undefined
): string | null {
  if (!stimulus) {
    return null;
  }

  if (stimulus.format === "graph") {
    return resolveAssetUrl(stimulus.legacy_path);
  }

  if (
    stimulus.format === "video" &&
    stimulus.video_playback_version === "single-play-gif-v1" &&
    stimulus.playback_asset_path
  ) {
    return resolveAssetUrl(stimulus.playback_asset_path);
  }

  return null;
}

export function createStimulusPrefetchManager(
  options: StimulusPrefetchManagerOptions = {}
): StimulusPrefetchManager {
  const fetchImpl =
    options.fetchImpl ??
    ((input: RequestInfo | URL, init?: RequestInit) =>
      globalThis.fetch(input, init));
  const timeoutMs =
    options.timeoutMs ?? STIMULUS_PREFETCH_TIMEOUT_MS;
  const requestedUrls = new Set<string>();
  const activeRequests = new Map<
    string,
    { controller: AbortController; timeoutId: ReturnType<typeof setTimeout> }
  >();
  let disposed = false;

  const prefetch = (stimulus: AssembledTrial | undefined): void => {
    const url = getStimulusPrefetchUrl(stimulus);
    if (!url || disposed || requestedUrls.has(url)) {
      return;
    }

    for (const [
      activeUrl,
      { controller, timeoutId }
    ] of activeRequests) {
      clearTimeout(timeoutId);
      controller.abort();
      activeRequests.delete(activeUrl);
    }

    requestedUrls.add(url);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    activeRequests.set(url, { controller, timeoutId });

    let request: Promise<Response>;
    try {
      request = fetchImpl(url, {
        method: "GET",
        cache: "force-cache",
        credentials: "same-origin",
        signal: controller.signal
      });
    } catch {
      clearTimeout(timeoutId);
      activeRequests.delete(url);
      return;
    }

    void request
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            `Unable to prefetch stimulus asset: ${response.status}`
          );
        }
        await response.arrayBuffer();
      })
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timeoutId);
        activeRequests.delete(url);
      });
  };

  return {
    prefetch,
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const { controller, timeoutId } of activeRequests.values()) {
        clearTimeout(timeoutId);
        controller.abort();
      }
      activeRequests.clear();
    }
  };
}
