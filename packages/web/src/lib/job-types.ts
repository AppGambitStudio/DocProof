// Job-specific types for the admin console (Phase 2)
// These extend the base types from types.ts with the full API shapes.

export type JobStatus =
  | "created"
  | "uploading"
  | "processing"
  | "extracting"
  | "validating"
  | "completed"
  | "failed"
  | "review_required"
  | "approved"
  | "rejected";

export interface JobSummary {
  jobId: string;
  status: JobStatus;
  ruleSetId: string;
  externalRef?: string;
  fileCount: number;
  costUsd?: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface JobListResponse {
  jobs: JobSummary[];
  count: number;
  nextCursor?: string;
}

export interface JobFile {
  fileId: string;
  fileName: string;
  documentType?: string;
  s3Key: string;
  mimeType: string;
  uploadedAt: string;
}

export interface DocumentAnalysis {
  documentType: string;
  extractedFields: Record<string, unknown>;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  confidenceReason?: string;
  observations: string;
  anomalies: string[];
  nameOnDocument?: string;
  nameMatchStatus?: "MATCH" | "PARTIAL_MATCH" | "MISMATCH" | "ILLEGIBLE";
  imageQuality?: { legibility: string; completeness: string };
  fileName?: string;
}

export interface TokenUsage {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  fileName?: string;
}

export interface FieldValidationResult {
  field: string;
  ruleId: string;
  status: "pass" | "fail" | "warn";
  expected?: string;
  actual?: string;
  message?: string;
}

export interface DocumentResultDetail {
  fileId: string;
  fileName: string;
  documentType: string;
  status: "valid" | "invalid" | "anomaly";
  analyses: DocumentAnalysis[];
  tokenUsage: TokenUsage[];
  fieldResults: FieldValidationResult[];
}

export interface CrossDocValidationResult {
  ruleId: string;
  description: string;
  sourceValue?: string;
  targetValue?: string;
  status: "pass" | "fail" | "warn";
  confidence?: number;
  reasoning?: string;
}

export interface Anomaly {
  type: string;
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  relatedDocuments?: string[];
}

export interface JobResultDetail {
  jobId: string;
  overallStatus: "pass" | "fail" | "review_required";
  summary: {
    totalDocuments: number;
    valid: number;
    invalid: number;
    anomalies: number;
  };
  documents: DocumentResultDetail[];
  crossDocResults: CrossDocValidationResult[];
  anomalies: Anomaly[];
  tokenUsage?: {
    extraction: TokenUsage[];
    validation: TokenUsage[];
    total: { inputTokens: number; outputTokens: number };
  };
  costUsd?: number;
  processedAt: string;
}

export interface JobDetail {
  jobId: string;
  status: JobStatus;
  ruleSetId: string;
  ruleSetVersion: number;
  externalRef?: string;
  metadata: Record<string, unknown>;
  files: JobFile[];
  fileUrls?: Record<string, string>;
  costUsd?: number;
  result?: JobResultDetail;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewAction?: "approve" | "reject";
  reviewNotes?: string;
  timestamps: {
    created: string;
    updated: string;
    completed?: string;
  };
}
