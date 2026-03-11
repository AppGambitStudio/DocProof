import type {
  RuleSet,
  ExtractionResult,
  DocumentAnalysis,
  FieldValidationResult,
  Anomaly,
  DocumentResult,
  JobResult,
  CrossDocValidationResult,
} from "./types";
import { runAllValidations } from "./validators";

/**
 * Build a reverse map: for each typeId, which other typeIds can satisfy it
 * via the `satisfiesTypes` declaration on DocumentTypeConfig.
 */
export function buildSatisfiedByMap(ruleSet: RuleSet): Map<string, string[]> {
  const satisfiedBy = new Map<string, string[]>();
  for (const dt of ruleSet.documentTypes) {
    for (const satisfiedType of dt.satisfiesTypes ?? []) {
      const list = satisfiedBy.get(satisfiedType) ?? [];
      list.push(dt.typeId);
      satisfiedBy.set(satisfiedType, list);
    }
  }
  return satisfiedBy;
}

/**
 * Find an analysis matching a document type, falling back to types that
 * satisfy it (e.g., aadhaar_card satisfies address_proof).
 */
export function findAnalysisByType(
  allAnalyses: { fileId: string; analysis: DocumentAnalysis }[],
  targetType: string,
  satisfiedBy: Map<string, string[]>
): DocumentAnalysis | undefined {
  // Direct match first
  const direct = allAnalyses.find(
    (a) => a.analysis.documentType === targetType
  )?.analysis;
  if (direct) return direct;

  // Fall back to satisfying types
  const satisfiers = satisfiedBy.get(targetType) ?? [];
  for (const satisfierType of satisfiers) {
    const fallback = allAnalyses.find(
      (a) => a.analysis.documentType === satisfierType
    )?.analysis;
    if (fallback) return fallback;
  }
  return undefined;
}

interface EngineInput {
  jobId: string;
  ruleSet: RuleSet;
  extractions: ExtractionResult[];
  metadata: Record<string, unknown>;
}

/**
 * Unwrap a field value that may have been returned as an object by the LLM.
 * Handles cases like: { "value": "John Doe", "confidence": 0.9 }
 * Returns the flat value (string, number, boolean, or null).
 */
function unwrapFieldValue(raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return raw;
  // If it's an object with a "value" key, extract it
  const obj = raw as Record<string, unknown>;
  if ("value" in obj) return obj.value ?? null;
  // Otherwise return as-is (could be a legitimate nested object)
  return raw;
}

/**
 * Evaluate field rules against a single document analysis.
 */
function evaluateFieldRules(
  ruleSet: RuleSet,
  analysis: DocumentAnalysis
): FieldValidationResult[] {
  const results: FieldValidationResult[] = [];
  const docRules = ruleSet.fieldRules.filter(
    (r) => r.documentType === analysis.documentType
  );

  for (const rule of docRules) {
    const value = unwrapFieldValue(analysis.extractedFields[rule.field]) ?? null;

    const { results: validationResults } = runAllValidations(
      value,
      rule.validations
    );

    for (const vr of validationResults) {
      results.push({
        field: rule.field,
        ruleId: rule.id,
        status: vr.status,
        expected: vr.expected,
        actual: vr.actual,
        message: vr.message,
      });
    }
  }

  return results;
}

/**
 * Flatten all analyses from all files into a single list with fileId attached.
 */
function flattenAnalyses(
  extractions: ExtractionResult[]
): { fileId: string; analysis: DocumentAnalysis }[] {
  const flat: { fileId: string; analysis: DocumentAnalysis }[] = [];
  for (const ext of extractions) {
    for (const analysis of ext.analyses) {
      flat.push({ fileId: ext.fileId, analysis });
    }
  }
  return flat;
}

/**
 * Detect anomalies: missing required docs, duplicates, quality issues.
 */
function detectAnomalies(
  ruleSet: RuleSet,
  allAnalyses: { fileId: string; analysis: DocumentAnalysis }[]
): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const docTypeCounts = new Map<string, string[]>();

  for (const { fileId, analysis } of allAnalyses) {
    const list = docTypeCounts.get(analysis.documentType) ?? [];
    list.push(fileId);
    docTypeCounts.set(analysis.documentType, list);
  }

  const satisfiedBy = buildSatisfiedByMap(ruleSet);

  // Check for missing required documents
  for (const dt of ruleSet.documentTypes) {
    const directCount = docTypeCounts.get(dt.typeId)?.length ?? 0;
    if (dt.required && directCount === 0) {
      // Check if another document type satisfies this requirement
      const satisfiers = satisfiedBy.get(dt.typeId) ?? [];
      const satisfiedCount = satisfiers.reduce(
        (sum, tid) => sum + (docTypeCounts.get(tid)?.length ?? 0),
        0
      );
      if (satisfiedCount === 0) {
        anomalies.push({
          type: "missing_doc",
          severity: "high",
          message: `Required document "${dt.label}" is missing`,
          relatedDocuments: [],
        });
      }
    }
    if (directCount > dt.maxCount) {
      anomalies.push({
        type: "duplicate_doc",
        severity: "medium",
        message: `Too many "${dt.label}" documents: ${directCount} found, max ${dt.maxCount}`,
        relatedDocuments: docTypeCounts.get(dt.typeId) ?? [],
      });
    }
  }

  // Check for LOW confidence documents
  for (const { fileId, analysis } of allAnalyses) {
    if (analysis.confidence === "LOW") {
      anomalies.push({
        type: "quality_issue",
        severity: "medium",
        message: `Document "${fileId}" (${analysis.documentType}) has LOW confidence — extraction may be unreliable`,
        relatedDocuments: [fileId],
      });
    }
  }

  return anomalies;
}

/**
 * Main engine: evaluate all rules and produce a JobResult.
 *
 * Each ExtractionResult may contain multiple DocumentAnalysis entries
 * (multi-doc-per-file support). The engine flattens all analyses and
 * evaluates field rules, cross-doc rules, and anomalies.
 *
 * Note: Cross-doc semantic rules and custom_llm rules are NOT evaluated here.
 * Those require a separate LLM call and are handled in the pipeline step.
 */
export function evaluate(input: EngineInput): JobResult {
  const { jobId, ruleSet, extractions } = input;
  const allAnalyses = flattenAnalyses(extractions);

  // Build per-file document results
  const documents: DocumentResult[] = extractions.map((extraction) => {
    // Evaluate field rules for each analysis in this file
    const allFieldResults: FieldValidationResult[] = [];
    for (const analysis of extraction.analyses) {
      allFieldResults.push(...evaluateFieldRules(ruleSet, analysis));
    }

    const hasFailure = allFieldResults.some((r) => r.status === "fail");
    const hasWarning = allFieldResults.some((r) => r.status === "warn");

    // Primary document type from first analysis
    const primaryType =
      extraction.analyses[0]?.documentType ?? "UNKNOWN";

    return {
      fileId: extraction.fileId,
      fileName: extraction.analyses[0]?.fileName ?? extraction.fileId,
      documentType: primaryType,
      status: hasFailure
        ? ("invalid" as const)
        : hasWarning
          ? ("anomaly" as const)
          : ("valid" as const),
      analyses: extraction.analyses,
      tokenUsage: extraction.tokenUsage,
      fieldResults: allFieldResults,
    };
  });

  // Detect anomalies
  const anomalies = detectAnomalies(ruleSet, allAnalyses);

  // Cross-doc rules — deterministic only (exact, contains, fuzzy)
  const satisfiedByMap = buildSatisfiedByMap(ruleSet);
  const crossDocResults: CrossDocValidationResult[] = [];
  for (const rule of ruleSet.crossDocRules) {
    if (rule.matchType === "semantic") continue; // handled by LLM step

    const sourceAnalysis = findAnalysisByType(allAnalyses, rule.sourceDoc, satisfiedByMap);
    const targetAnalysis = findAnalysisByType(allAnalyses, rule.targetDoc, satisfiedByMap);

    if (!sourceAnalysis || !targetAnalysis) continue;

    const sourceVal = String(
      unwrapFieldValue(sourceAnalysis.extractedFields[rule.sourceField]) ?? ""
    );
    const targetVal = String(
      unwrapFieldValue(targetAnalysis.extractedFields[rule.targetField]) ?? ""
    );

    let match = false;
    if (rule.matchType === "exact") {
      const s = normalizeForComparison(sourceVal);
      const t = normalizeForComparison(targetVal);
      match = s === t;
    } else if (rule.matchType === "contains") {
      match = targetVal.toLowerCase().includes(sourceVal.toLowerCase());
    } else if (rule.matchType === "fuzzy") {
      match = fuzzyMatch(sourceVal, targetVal, rule.threshold ?? 0.8);
    }

    crossDocResults.push({
      ruleId: rule.id,
      description: rule.description,
      status: match ? "pass" : "fail",
      confidence: match ? 1.0 : 0.0,
      sourceValue: sourceVal,
      targetValue: targetVal,
    });
  }

  // Compute overall status
  const validCount = documents.filter((d) => d.status === "valid").length;
  const invalidCount = documents.filter((d) => d.status === "invalid").length;
  const anomalyCount = anomalies.filter((a) => a.severity === "high").length;
  const crossDocFails = crossDocResults.filter(
    (r) => r.status === "fail"
  ).length;

  let overallStatus: "pass" | "fail" | "review_required" = "pass";
  if (invalidCount > 0 || crossDocFails > 0) {
    overallStatus = "fail";
  } else if (
    anomalyCount > 0 ||
    documents.some((d) => d.status === "anomaly")
  ) {
    overallStatus = "review_required";
  }

  return {
    jobId,
    overallStatus,
    summary: {
      totalDocuments: documents.length,
      valid: validCount,
      invalid: invalidCount,
      anomalies: anomalies.length,
    },
    documents,
    crossDocResults,
    anomalies,
    processedAt: new Date().toISOString(),
  };
}

// ─── Helpers ───

/** Date-like pattern: dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd, etc. */
const DATE_PATTERN = /^\d{1,4}[\\/\-\.]\d{1,2}[\\/\-\.]\d{1,4}$/;

/**
 * Normalize a value for exact comparison.
 * - Lowercases
 * - Trims whitespace
 * - For date-like strings, normalizes separators (/, -, .) to a single format
 */
function normalizeForComparison(val: string): string {
  const trimmed = val.trim().toLowerCase();
  if (DATE_PATTERN.test(trimmed)) {
    return trimmed.replace(/[\\/\-\.]/g, "/");
  }
  return trimmed;
}

function fuzzyMatch(a: string, b: string, threshold: number): boolean {
  const s1 = a.toLowerCase();
  const s2 = b.toLowerCase();
  if (s1 === s2) return true;

  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return true;

  const distance = levenshtein(s1, s2);
  const similarity = 1 - distance / maxLen;
  return similarity >= threshold;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0)
  );

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}
