import type { StimulusFormat } from "../data/manifestTypes";

export type RequestedDatasetClassification = "test" | undefined;

export function getRequestedDatasetClassification(
  search: string
): RequestedDatasetClassification {
  const params = new URLSearchParams(search);
  const requestedFormat = params.get("format");
  const hasFixedFormat =
    requestedFormat === "table" ||
    requestedFormat === "graph" ||
    requestedFormat === "video";
  return params.get("preview") === "1" ||
    params.get("debug") === "1" ||
    hasFixedFormat
      ? "test"
      : undefined;
}

export function getRequestedPreviewFormatOverride(
  search: string
): StimulusFormat | undefined {
  const params = new URLSearchParams(search);
  const requestedFormat = params.get("format");
  return requestedFormat === "table" ||
    requestedFormat === "graph" ||
    requestedFormat === "video"
    ? requestedFormat
    : undefined;
}

export function resolveExperimentFormat(
  search: string,
  assignedFormat: StimulusFormat
): StimulusFormat {
  return getRequestedPreviewFormatOverride(search) ?? assignedFormat;
}
