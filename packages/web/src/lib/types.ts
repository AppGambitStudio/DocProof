// ─── Web types — aligned with @docproof/core/rules/types ───

export interface FieldDefinition {
  name: string;
  label: string;
  type: "string" | "number" | "date" | "boolean" | "enum";
  description?: string;
}

export interface ExtractionFieldRule {
  instructions?: string;
  format?: string;
  maskExtraction?: boolean;
  maskInstructions?: string;
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

// Validation type — flat representation of the core discriminated union.
// Each validation has a `type` plus type-specific fields.
export interface Validation {
  type: string;
  // regex
  pattern?: string;
  message?: string;
  // length / numeric_range / date_range
  min?: number | string;
  max?: number | string;
  // enum
  values?: string[];
  // date_format / date_range
  format?: string;
  relative?: string;
  // checksum
  algorithm?: string;
  // custom_llm
  prompt?: string;
}

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

export interface NameMatchConfig {
  enabled: boolean;
  metadataField?: string;
  allowAbbreviations?: boolean;
  allowReordering?: boolean;
  customGuidance?: string;
}

export interface PromptConfig {
  role?: string;
  organizationContext?: string;
  multiDocPerFile?: boolean;
  imageQualityAssessment?: boolean;
  nameMatching?: NameMatchConfig;
  customInstructions?: string;
  contextFields?: string[];
  customSystemPrompt?: string;
  customAnalysisPrompt?: string;
  temperature?: number;
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
