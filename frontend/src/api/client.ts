import type { StimulusFormat } from "../data/manifestTypes";
import {
  catalogHash,
  stimulusSetVersion,
} from "../data/releaseInfo";

const API_BASE = "/api";
const CLIENT_TOKEN_KEY = "multimodality_client_token";
const STATIC_PARTICIPANT_ID_KEY =
  "multimodality_github_preview_participant_id";
const STATIC_FORMAT_KEY =
  "multimodality_github_preview_format_assignment";
const STATIC_SUBMISSION_PREFIX =
  "multimodality_github_preview_submission_";

export interface BootstrapResponse {
  participant_id: string;
  client_token: string;
  format_assignment: StimulusFormat;
  session_id: string;
  is_returning: boolean;
  dataset_classification?: "formal" | "test";
  formal_collection_allowed?: boolean;
  stimulus_set_version?: string;
  catalog_hash?: string;
}

export function getSavedClientToken(): string | null {
  try {
    return localStorage.getItem(CLIENT_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function saveClientToken(token: string): void {
  try {
    localStorage.setItem(CLIENT_TOKEN_KEY, token);
  } catch {
    // localStorage unavailable — continue without persistence
  }
}

function isStaticPreview(): boolean {
  return import.meta.env.VITE_STATIC_PREVIEW === "true";
}

function randomIdentifier(prefix: string): string {
  const value =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${value}`;
}

function getOrCreateLocalValue(
  key: string,
  createValue: () => string,
): string {
  try {
    const current = localStorage.getItem(key);
    if (current) {
      return current;
    }
    const created = createValue();
    localStorage.setItem(key, created);
    return created;
  } catch {
    return createValue();
  }
}

function getOrCreateStaticFormat(): StimulusFormat {
  const formats: readonly StimulusFormat[] = [
    "table",
    "graph",
    "video",
  ];
  const stored = getOrCreateLocalValue(STATIC_FORMAT_KEY, () => {
    const index = Math.floor(Math.random() * formats.length);
    return formats[index];
  });
  return stored === "table" || stored === "graph" || stored === "video"
    ? stored
    : "table";
}

export async function apiBootstrap(
  datasetClassification?: "test"
): Promise<BootstrapResponse> {
  if (isStaticPreview()) {
    const clientToken = getOrCreateLocalValue(
      CLIENT_TOKEN_KEY,
      () => randomIdentifier("preview-client"),
    );
    const participantId = getOrCreateLocalValue(
      STATIC_PARTICIPANT_ID_KEY,
      () => randomIdentifier("preview-participant"),
    );
    saveClientToken(clientToken);
    return {
      participant_id: participantId,
      client_token: clientToken,
      format_assignment: getOrCreateStaticFormat(),
      session_id: randomIdentifier("preview-session"),
      is_returning: true,
      dataset_classification: datasetClassification ?? "test",
      formal_collection_allowed: false,
      stimulus_set_version: stimulusSetVersion,
      catalog_hash: catalogHash,
    };
  }

  const clientToken = getSavedClientToken();
  const res = await fetch(`${API_BASE}/bootstrap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_token: clientToken,
      dataset_classification: datasetClassification,
    }),
  });

  if (!res.ok) {
    throw new Error(`Bootstrap failed: ${res.status}`);
  }

  const data: BootstrapResponse = await res.json();
  saveClientToken(data.client_token);
  return data;
}

export async function apiSubmit(
  sessionId: string,
  participantId: string,
  payload: unknown
): Promise<void> {
  if (isStaticPreview()) {
    try {
      localStorage.setItem(
        `${STATIC_SUBMISSION_PREFIX}${sessionId}`,
        JSON.stringify({
          session_id: sessionId,
          participant_id: participantId,
          payload,
          saved_at: new Date().toISOString(),
        }),
      );
    } catch {
      // Local persistence is best-effort; the completion page still exposes
      // participant JSON/CSV downloads for manual review.
    }
    return;
  }

  const res = await fetch(`${API_BASE}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      participant_id: participantId,
      payload,
    }),
  });

  if (!res.ok) {
    throw new Error(`Submit failed: ${res.status}`);
  }
}
