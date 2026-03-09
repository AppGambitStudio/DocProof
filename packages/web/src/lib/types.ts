export interface FieldDefinition {
  name: string;
  label: string;
  type: "string" | "number" | "date" | "boolean" | "enum";
  description?: string;
}

export interface ExtractionFieldRule {
  aliases?: string[];
  format?: string;
  required?: boolean;
}

export interface DocumentTypeConfig {
  typeId: string;
  label: string;
  required: boolean;
  maxCount: number;
  acceptedFormats: string[];
  extractionPrompt: string;
  expectedFields: FieldDefinition[];
  fieldExtractionRules?: Record<string, ExtractionFieldRule>;
  flagConditions?: string[];
  applicableTo?: string[];
  category?: string;
}

export interface FieldRule {
  documentType: string;
  field: string;
  validations: FieldValidation[];
}

export interface FieldValidation {
  type: string;
  value?: string | number | boolean;
  message?: string;
}

export interface CrossDocRule {
  id: string;
  description: string;
  sourceDocType: string;
  sourceField: string;
  targetDocType: string;
  targetField: string;
  matchType: "exact" | "fuzzy" | "contains" | "date_range";
  threshold?: number;
}

export interface MetadataRule {
  field: string;
  validations: FieldValidation[];
}

export interface PromptConfig {
  role?: string;
  orgContext?: string;
  nameMatchingConfig?: Record<string, unknown>;
  contextFields?: string[];
}

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
  promptConfig?: PromptConfig;
  createdAt: string;
  updatedAt: string;
}

export interface Job {
  id: string;
  ruleSetId: string;
  status: "created" | "uploading" | "processing" | "extracting" | "validating" | "completed" | "failed" | "review_required";
  createdAt: string;
  updatedAt: string;
  result?: JobResult;
}

export interface JobResult {
  id: string;
  jobId: string;
  overallStatus: "pass" | "fail" | "review";
  documentResults: DocumentResult[];
  crossDocResults: CrossDocCheckResult[];
  completedAt: string;
}

export interface DocumentResult {
  documentType: string;
  fileName: string;
  status: "pass" | "fail" | "review";
  extractedFields: Record<string, unknown>;
  fieldChecks: FieldCheck[];
  flags: string[];
}

export interface FieldCheck {
  field: string;
  status: "pass" | "fail";
  expected?: string;
  actual?: string;
  message?: string;
}

export interface CrossDocCheckResult {
  ruleId: string;
  description: string;
  status: "pass" | "fail";
  details?: string;
}
