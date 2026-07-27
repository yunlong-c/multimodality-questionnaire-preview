export type StimulusFormat = "table" | "graph" | "video";
export type AllocationMethod = "variable_block" | "client_fallback";
export type FallbackReasonCode =
  | "allocation_timeout"
  | "allocation_network_error"
  | "allocation_server_error";

export interface AllocationRecord {
  allocationId: string;
  participantId: string;
  sessionId: string;
  formatAssignment: StimulusFormat;
  allocationMethod: AllocationMethod;
  allocationStatus: "confirmed";
  assignedAt: string;
  fallbackReasonCode: FallbackReasonCode | null;
  fallbackReconciledAt: string | null;
}

export interface AllocationResult {
  record: AllocationRecord;
  isReturning: boolean;
}

export interface AllocateRepositoryInput {
  randomizationVersion: string;
  scheduleSha256: string;
  tokenHmac: string;
  allocationId: string;
  participantId: string;
  sessionId: string;
  now: string;
}

export interface ReconcileRepositoryInput {
  randomizationVersion: string;
  scheduleSha256: string;
  tokenHmac: string;
  allocationId: string;
  participantId: string;
  sessionId: string;
  formatAssignment: StimulusFormat;
  assignedAt: string;
  fallbackReasonCode: FallbackReasonCode;
  reconciledAt: string;
}

export interface RandomizationRepository {
  allocate(input: AllocateRepositoryInput): Promise<AllocationResult>;
  reconcile(input: ReconcileRepositoryInput): Promise<AllocationResult>;
}
