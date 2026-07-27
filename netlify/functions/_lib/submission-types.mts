import type {
  AllocationMethod,
  FallbackReasonCode,
  StimulusFormat,
} from "./randomization-types.mts";

export type DatasetClassification = "formal" | "test";
export type SubmissionMirrorStatus =
  | "pending"
  | "processing"
  | "accepted"
  | "failed";

export interface SubmissionDeployMetadata {
  trustedClientIp: string | null;
  deployContext: string;
  deployId: string | null;
  deployUrl: string | null;
  deployBranch: string | null;
  deployCommitRef: string | null;
}

export interface ValidatedSubmission {
  clientToken: string;
  clientTokenHmac: string;
  payloadJson: string;
  payloadSha256: string;
  sessionId: string;
  participantId: string;
  datasetClassification: DatasetClassification;
  formatAssignment: StimulusFormat;
  stimulusSetVersion: string;
  catalogHash: string;
  submittedAt: string;
  allocationId: string | null;
  randomizationVersion: string | null;
  allocationMethod: AllocationMethod | null;
  allocationStatus: "confirmed" | null;
  assignedAt: string | null;
  fallbackReasonCode: FallbackReasonCode | null;
  fallbackReconciledAt: string | null;
  clientAttemptCount: number;
  previousAttemptLatencyMs: number | null;
}

export interface StoreSubmissionInput extends ValidatedSubmission {
  receiptId: string;
  conflictId: string;
  mirrorId: string;
  submissionsOpen: boolean;
  deploy: SubmissionDeployMetadata;
}

export interface SubmissionReceipt {
  receiptId: string;
  sessionId: string;
  participantId: string;
  datasetClassification: DatasetClassification;
  payloadSha256: string;
  storedAt: string;
  isReplay: boolean;
  mirrorStatus: SubmissionMirrorStatus;
}

export interface SubmissionRepository {
  store(input: StoreSubmissionInput): Promise<SubmissionReceipt>;
}

export interface SubmissionMirrorRow {
  mirrorId: string;
  receiptId: string;
  formName: string;
  attemptCount: number;
  payloadJson: string;
  payloadSha256: string;
  sessionId: string;
  participantId: string;
  datasetClassification: DatasetClassification;
  formatAssignment: StimulusFormat;
  stimulusSetVersion: string;
  catalogHash: string;
  submittedAt: string;
  allocationId: string | null;
  randomizationVersion: string | null;
  allocationMethod: AllocationMethod | null;
  allocationStatus: "confirmed" | null;
  assignedAt: string | null;
  fallbackReasonCode: FallbackReasonCode | null;
  fallbackReconciledAt: string | null;
  clientAttemptCount: number;
  previousAttemptLatencyMs: number | null;
}
