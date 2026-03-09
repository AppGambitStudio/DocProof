// Types
export type {
  Validation,
  FieldDefinition,
  ExtractionFieldRule,
  DocumentTypeConfig,
  FieldRule,
  CrossDocRule,
  MetadataRule,
  NameMatchConfig,
  PromptConfig,
  RuleSet,
  JobStatus,
  JobFile,
  Job,
  TokenUsage,
  TokenUsageSummary,
  DocumentAnalysis,
  ExtractedField,
  ExtractionResult,
  ValidationStatus,
  FieldValidationResult,
  CrossDocValidationResult,
  Anomaly,
  DocumentResult,
  JobResult,
} from "./rules/types";

export {
  MODEL_PRICING,
  calculateCostUsd,
  buildTokenUsageEntry,
  buildTokenUsageSummary,
} from "./rules/types";

// Rule Engine
export { evaluate } from "./rules/engine";
export { runValidation, runAllValidations } from "./rules/validators";

// Extraction
export { extractDocument, semanticMatch } from "./extraction/extractor";
export { buildSystemPrompt, buildAnalysisPrompt } from "./extraction/prompts";

// Retry utilities
export { withRetry, isRetryableBedrockError } from "./extraction/retry";

// Jobs
export { canTransition, assertTransition, isTerminal } from "./jobs/status";
