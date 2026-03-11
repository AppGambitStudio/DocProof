// ─── Validation Types ───

export type Validation =
  | { type: "required" }
  | { type: "regex"; pattern: string; message?: string }
  | { type: "length"; min?: number; max?: number }
  | { type: "enum"; values: string[] }
  | { type: "date_format"; format: string }
  | { type: "date_range"; min?: string; max?: string; relative?: string }
  | { type: "numeric_range"; min?: number; max?: number }
  | { type: "checksum"; algorithm: "pan" | "gstin" | "aadhaar" | "luhn" }
  | { type: "custom_llm"; prompt: string };

// ─── Document Types ───

export interface FieldDefinition {
  name: string;
  label: string;
  type: "string" | "number" | "date" | "boolean" | "enum";
  description?: string;
}

export interface ExtractionFieldRule {
  /** Instructions for extracting this specific field */
  instructions?: string;
  /** Format hint (e.g., "dd-mm-yyyy", "5 letters + 4 digits + 1 letter") */
  format?: string;
  /** Privacy: if true, extract only partial value (e.g., last 4 digits of Aadhaar) */
  maskExtraction?: boolean;
  /** Mask hint (e.g., "Extract only last 4 digits") */
  maskInstructions?: string;
}

export interface DocumentTypeConfig {
  typeId: string;
  label: string;
  required: boolean;
  maxCount: number;
  acceptedFormats: string[];
  /** Short description of what this document is (used in prompt generation) */
  extractionPrompt: string;
  expectedFields: FieldDefinition[];
  /** Per-field extraction rules for prompt generation */
  fieldExtractionRules?: Record<string, ExtractionFieldRule>;
  /** Conditions that should be flagged as anomalies during extraction */
  flagConditions?: string[];
  /** Entity types this document applies to (e.g., ["COMPANY", "PROPRIETORSHIP"]) */
  applicableTo?: string[];
  /** Category grouping for prompt organization */
  category?: string;
}

// ─── Prompt Configuration ───

export interface NameMatchConfig {
  /** Enable name matching against job metadata */
  enabled: boolean;
  /** Metadata field containing the name to match against (default: "entityName") */
  metadataField?: string;
  /** Allow minor variations (e.g., "Pvt" vs "Private") */
  allowAbbreviations?: boolean;
  /** Allow name reordering (e.g., "Ramesh Kumar" vs "Kumar Ramesh") */
  allowReordering?: boolean;
  /** Custom matching instructions appended to the prompt */
  customGuidance?: string;
}

export interface PromptConfig {
  /** Role description for the AI (e.g., "document extraction specialist for Metropolis Healthcare") */
  role: string;
  /** Additional context about the organization or use case */
  organizationContext?: string;
  /** Whether a single file may contain multiple distinct documents */
  multiDocPerFile?: boolean;
  /** Enable image/document quality assessment in output */
  imageQualityAssessment?: boolean;
  /** Name matching configuration */
  nameMatching?: NameMatchConfig;
  /** Custom instructions appended to the system prompt */
  customInstructions?: string;
  /** Which job metadata fields to inject into the prompt as client context */
  contextFields?: string[];
  /** Override: full custom system prompt template (bypasses auto-generation) */
  customSystemPrompt?: string;
  /** Override: full custom analysis prompt for final validation */
  customAnalysisPrompt?: string;
  /** Model temperature (0 = deterministic, 1 = creative). Defaults to 0. */
  temperature?: number;
}

// ─── Rules ───

export interface FieldRule {
  id: string;
  documentType: string;
  field: string;
  validations: Validation[];
}

export interface CrossDocRule {
  id: string;
  description: string;
  sourceDoc: string;
  sourceField: string;
  targetDoc: string;
  targetField: string;
  matchType: "exact" | "fuzzy" | "contains" | "semantic";
  threshold?: number;
}

export interface MetadataRule {
  id: string;
  field: string;
  validations: Validation[];
}

// ─── RuleSet ───

export interface RuleSet {
  id: string;
  name: string;
  description?: string;
  version: number;
  status: "draft" | "active" | "archived";
  documentTypes: DocumentTypeConfig[];
  fieldRules: FieldRule[];
  crossDocRules: CrossDocRule[];
  metadataRules: MetadataRule[];
  /** Prompt generation configuration */
  promptConfig?: PromptConfig;
  createdAt: string;
  updatedAt: string;
}

// ─── Jobs ───

export type JobStatus =
  | "created"
  | "uploading"
  | "processing"
  | "extracting"
  | "validating"
  | "completed"
  | "failed"
  | "review_required";

export interface JobFile {
  fileId: string;
  fileName: string;
  documentType?: string;
  s3Key: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
}

export interface Job {
  jobId: string;
  ruleSetId: string;
  ruleSetVersion: number;
  status: JobStatus;
  externalRef?: string;
  metadata: Record<string, unknown>;
  callbackUrl?: string;
  files: JobFile[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

// ─── Token Tracking ───

/** Per-call token usage entry (matches production TokenUsageEntry) */
export interface TokenUsage {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  /** File name for tracking which document this usage is for */
  fileName?: string;
}

/** Aggregated token usage summary for a job */
export interface TokenUsageSummary {
  entries: TokenUsage[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCost: number;
  timestamp: string;
}

// Bedrock pricing per 1K tokens (USD) — matches production format
export const MODEL_PRICING: Record<string, { inputPer1K: number; outputPer1K: number }> = {
  "global.anthropic.claude-haiku-4-5-20251001-v1:0": { inputPer1K: 0.0008, outputPer1K: 0.004 },
  "global.anthropic.claude-sonnet-4-5-20250929-v1:0": { inputPer1K: 0.003, outputPer1K: 0.015 },
};

/** Build a per-call TokenUsage entry from Bedrock response usage */
export function buildTokenUsageEntry(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  fileName?: string
): TokenUsage {
  const pricing = MODEL_PRICING[modelId] ?? { inputPer1K: 0, outputPer1K: 0 };
  const cost =
    (inputTokens / 1000) * pricing.inputPer1K +
    (outputTokens / 1000) * pricing.outputPer1K;

  return {
    modelId,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cost: parseFloat(cost.toFixed(6)),
    fileName,
  };
}

/** Aggregate an array of TokenUsage entries into a summary */
export function buildTokenUsageSummary(entries: TokenUsage[]): TokenUsageSummary {
  const totalInputTokens = entries.reduce((sum, e) => sum + e.inputTokens, 0);
  const totalOutputTokens = entries.reduce((sum, e) => sum + e.outputTokens, 0);
  const totalCost = entries.reduce((sum, e) => sum + e.cost, 0);

  return {
    entries,
    totalInputTokens,
    totalOutputTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
    totalCost: parseFloat(totalCost.toFixed(6)),
    timestamp: new Date().toISOString(),
  };
}

export function calculateCostUsd(tokenUsages: TokenUsage[]): number {
  return parseFloat(
    tokenUsages.reduce((sum, e) => sum + e.cost, 0).toFixed(6)
  );
}

// ─── Extraction ───

/** Single document analysis extracted from a file (a file may contain multiple docs) */
export interface DocumentAnalysis {
  documentType: string;
  extractedFields: Record<string, unknown>;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  confidenceReason?: string;
  observations: string;
  anomalies: string[];
  nameOnDocument?: string;
  nameMatchStatus?: "MATCH" | "PARTIAL_MATCH" | "MISMATCH" | "ILLEGIBLE";
  nameMatchNotes?: string;
  dateFields?: {
    dateOfIssue?: string | null;
    dateOfExpiry?: string | null;
    isExpired?: boolean | null;
  };
  imageQuality?: {
    legibility: "CLEAR" | "PARTIALLY_LEGIBLE" | "ILLEGIBLE";
    completeness: "COMPLETE" | "PARTIAL" | "CROPPED";
    documentCondition?: string;
    tamperingIndicators?: string;
  };
  /** Original file name — attached after extraction for reference in validation */
  fileName?: string;
}

export interface ExtractedField {
  value: unknown;
  confidence: number;
  source?: string;
}

export interface ExtractionResult {
  fileId: string;
  /** All document analyses found in this file (supports multi-doc-per-file) */
  analyses: DocumentAnalysis[];
  tokenUsage: TokenUsage[];
  escalated: boolean;
}

// ─── Validation Results ───

export type ValidationStatus = "pass" | "fail" | "warn";

export interface FieldValidationResult {
  field: string;
  ruleId: string;
  status: ValidationStatus;
  expected?: string;
  actual?: string;
  message: string;
}

export interface CrossDocValidationResult {
  ruleId: string;
  description: string;
  status: ValidationStatus;
  confidence: number;
  sourceValue: string;
  targetValue: string;
  reasoning?: string;
}

export interface Anomaly {
  type:
    | "missing_doc"
    | "duplicate_doc"
    | "quality_issue"
    | "data_inconsistency"
    | "suspicious_pattern";
  severity: "low" | "medium" | "high";
  message: string;
  relatedDocuments: string[];
}

export interface DocumentResult {
  fileId: string;
  fileName: string;
  documentType: string;
  status: "valid" | "invalid" | "anomaly";
  analyses: DocumentAnalysis[];
  tokenUsage: TokenUsage[];
  fieldResults: FieldValidationResult[];
}

export interface JobResult {
  jobId: string;
  overallStatus: "pass" | "fail" | "review_required";
  summary: {
    totalDocuments: number;
    valid: number;
    invalid: number;
    anomalies: number;
  };
  documents: DocumentResult[];
  crossDocResults: CrossDocValidationResult[];
  anomalies: Anomaly[];
  /** Token usage breakdown — populated by compile step */
  tokenUsage?: {
    extraction: TokenUsage[];
    validation: TokenUsage[];
    total: { inputTokens: number; outputTokens: number };
  };
  /** Total cost in USD — populated by compile step */
  costUsd?: number;
  processedAt: string;
}
