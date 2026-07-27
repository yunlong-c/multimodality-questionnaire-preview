import type { ExperimentPayload } from "../experiment/experimentTypes";
import type { BootstrapResponse } from "./types";

function unavailable(): never {
  throw new Error("Server transport is unavailable in this static build.");
}

export async function bootstrapFromServer(
  _datasetClassification: "test" | undefined,
  _clientToken: string | null,
): Promise<BootstrapResponse> {
  return unavailable();
}

export async function submitToServer(
  _sessionId: string,
  _participantId: string,
  _payload: ExperimentPayload,
): Promise<void> {
  return unavailable();
}
