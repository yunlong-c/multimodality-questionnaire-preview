import type { ExperimentPayload } from "../experiment/experimentTypes";
import type { BootstrapResponse } from "./types";

const API_BASE = "/api";

export async function bootstrapFromServer(
  datasetClassification: "test" | undefined,
  clientToken: string | null,
): Promise<BootstrapResponse> {
  const response = await fetch(`${API_BASE}/bootstrap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_token: clientToken,
      dataset_classification: datasetClassification,
    }),
  });

  if (!response.ok) {
    throw new Error(`Bootstrap failed: ${response.status}`);
  }

  return response.json() as Promise<BootstrapResponse>;
}

export async function submitToServer(
  sessionId: string,
  participantId: string,
  payload: ExperimentPayload,
): Promise<void> {
  const response = await fetch(`${API_BASE}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      participant_id: participantId,
      payload,
    }),
  });

  if (!response.ok) {
    throw new Error(`Submit failed: ${response.status}`);
  }
}
