import type {
  RuleSet,
  DocumentTypeConfig,
  PromptConfig,
  NameMatchConfig,
} from "../rules/types";

/**
 * Build the complete system prompt for document extraction.
 *
 * If `promptConfig.customSystemPrompt` is set, it's used as-is with variable substitution.
 * Otherwise, the prompt is auto-generated from the RuleSet configuration.
 */
export function buildSystemPrompt(
  ruleSet: RuleSet,
  metadata: Record<string, unknown>
): string {
  const config = ruleSet.promptConfig;

  // If admin provided a full custom prompt, do variable substitution and return
  if (config?.customSystemPrompt) {
    return substituteVariables(config.customSystemPrompt, metadata);
  }

  // Auto-generate from RuleSet config
  const sections: string[] = [];

  sections.push(buildRoleSection(config));
  sections.push(buildClientContextSection(config, metadata));
  sections.push(buildDocumentTypesSection(ruleSet.documentTypes));
  sections.push(buildExtractionRulesSection(ruleSet.documentTypes));

  if (config?.nameMatching?.enabled) {
    sections.push(buildNameMatchingSection(config.nameMatching, metadata));
  }

  if (config?.imageQualityAssessment !== false) {
    sections.push(buildImageQualitySection());
  }

  sections.push(buildOutputFormatSection(config));

  if (config?.customInstructions) {
    sections.push(`## Additional Instructions\n\n${config.customInstructions}`);
  }

  return sections.filter(Boolean).join("\n\n---\n\n");
}

/**
 * Build the analysis prompt for final cross-document validation.
 *
 * If `promptConfig.customAnalysisPrompt` is set, it's used as-is with variable substitution.
 */
export function buildAnalysisPrompt(
  ruleSet: RuleSet,
  metadata: Record<string, unknown>,
  extractions: Record<string, unknown>[]
): string {
  const config = ruleSet.promptConfig;

  if (config?.customAnalysisPrompt) {
    return substituteVariables(config.customAnalysisPrompt, {
      ...metadata,
      extractions: JSON.stringify(extractions, null, 2),
    });
  }

  const entityName = metadata[config?.nameMatching?.metadataField ?? "entityName"] ?? "Unknown";

  return `You are a document validation analyst. Review the extracted data from all documents submitted for this job and perform a comprehensive cross-document analysis.

## Client Context
- Entity Name: ${entityName}
${buildContextFieldsString(config, metadata)}

## Extracted Documents
${JSON.stringify(extractions, null, 2)}

## Cross-Document Checks
${ruleSet.crossDocRules.map((r) => `- ${r.description} (${r.sourceDoc}.${r.sourceField} vs ${r.targetDoc}.${r.targetField}, match: ${r.matchType})`).join("\n")}

## Instructions
1. Verify consistency across all documents (names, dates, addresses)
2. Flag any discrepancies between documents
3. Check that all required documents are present
4. Assess overall completeness and readiness

Return ONLY valid JSON:
{
  "overallAssessment": "PASS" | "FAIL" | "REVIEW_REQUIRED",
  "crossDocumentFindings": [
    {
      "check": "description of what was checked",
      "status": "PASS" | "FAIL" | "WARN",
      "confidence": 0.0-1.0,
      "reasoning": "explanation"
    }
  ],
  "anomalies": ["list of issues found"],
  "recommendations": ["list of actions needed"]
}`;
}

// ─── Section Builders ───

function buildRoleSection(config?: PromptConfig): string {
  const role = config?.role ?? "a document extraction specialist";
  const orgContext = config?.organizationContext
    ? `\n\n${config.organizationContext}`
    : "";

  const multiDoc = config?.multiDocPerFile
    ? "\n\nIMPORTANT: A single file may contain MULTIPLE distinct documents (e.g., a photo showing both a PAN Card and an Aadhaar Card side by side, or a PDF with different documents scanned across its pages). You must identify and extract data for EACH distinct document found in the file."
    : "";

  return `You are ${role}.

Your task is to analyze an uploaded document image or PDF and extract structured information. This extracted data will subsequently be used in a separate validation step.${orgContext}${multiDoc}`;
}

function buildClientContextSection(
  config: PromptConfig | undefined,
  metadata: Record<string, unknown>
): string {
  const fields = config?.contextFields ?? [];
  if (fields.length === 0) return "";

  const lines = fields
    .map((field) => {
      const value = metadata[field];
      if (value === undefined || value === null) return null;
      const label = field.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
      return `- ${label}: ${value}`;
    })
    .filter(Boolean);

  if (lines.length === 0) return "";

  return `## Client Context\n${lines.join("\n")}`;
}

function buildDocumentTypesSection(docTypes: DocumentTypeConfig[]): string {
  // Group by category if available
  const categorized = new Map<string, DocumentTypeConfig[]>();
  for (const dt of docTypes) {
    const cat = dt.category ?? "General";
    if (!categorized.has(cat)) categorized.set(cat, []);
    categorized.get(cat)!.push(dt);
  }

  const sections: string[] = ["## Supported Document Types"];
  sections.push(
    "IMPORTANT: You MUST use the exact `typeId` value (shown in parentheses) as the `documentType` in your response. Do NOT use the label or any other variation.\n"
  );

  for (const [category, types] of categorized) {
    if (categorized.size > 1) {
      sections.push(`### ${category}`);
    }
    for (const dt of types) {
      const applicability = dt.applicableTo?.length
        ? ` (${dt.applicableTo.join(", ")})`
        : "";
      sections.push(`- **${dt.label}** (typeId: \`${dt.typeId}\`)${applicability} — ${dt.extractionPrompt}`);
    }
  }

  sections.push(
    `- **Unknown Document** (typeId: \`UNKNOWN\`) — Use if the document does not match any type above`
  );

  // Summary of valid typeIds for clarity
  const validIds = docTypes.map((dt) => `"${dt.typeId}"`).join(", ");
  sections.push(
    `\nValid documentType values: ${validIds}, "UNKNOWN"`
  );

  return sections.join("\n");
}

function buildExtractionRulesSection(docTypes: DocumentTypeConfig[]): string {
  const sections: string[] = ["## Extraction Rules Per Document Type"];

  for (const dt of docTypes) {
    sections.push(`### ${dt.label}`);

    // Build field extraction instructions
    const fieldLines: string[] = [];
    for (const field of dt.expectedFields) {
      const rule = dt.fieldExtractionRules?.[field.name];
      let line = `- ${field.name}: ${field.type}`;
      if (field.description) line += ` — ${field.description}`;
      if (rule?.format) line += ` (format: ${rule.format})`;
      if (rule?.maskExtraction) line += ` [PRIVACY: ${rule.maskInstructions ?? "extract partial only"}]`;
      if (rule?.instructions) line += `\n  ${rule.instructions}`;
      fieldLines.push(line);
    }

    sections.push(`Extract:\n${fieldLines.join("\n")}`);

    // Flagging conditions
    if (dt.flagConditions?.length) {
      sections.push(
        `Flag if:\n${dt.flagConditions.map((c) => `- ${c}`).join("\n")}`
      );
    }

    sections.push(""); // blank line between types
  }

  return sections.join("\n");
}

function buildNameMatchingSection(
  config: NameMatchConfig,
  metadata: Record<string, unknown>
): string {
  const nameField = config.metadataField ?? "entityName";
  const entityName = metadata[nameField] ?? "<entity name>";

  const rules: string[] = [];

  if (config.allowAbbreviations !== false) {
    rules.push(
      `- Minor spelling variations (e.g., "Pvt" vs "Private", "Ltd" vs "Limited") are acceptable — note them but do not flag as a hard mismatch.`
    );
  }

  if (config.allowReordering !== false) {
    rules.push(
      `- Slight variations in name ordering (e.g., "Ramesh Kumar" vs "Kumar Ramesh") are acceptable — note them.`
    );
  }

  rules.push(
    `- Check for full name vs short/initials (e.g., "Ramesh Kumar" vs "R. Kumar"). Flag this as a partial match.`,
    `- Completely different names should be flagged as a mismatch anomaly.`,
    `- Missing middle names or initials are acceptable — note them.`,
    `- If the name on the document is entirely illegible, flag it as such.`
  );

  if (config.customGuidance) {
    rules.push(config.customGuidance);
  }

  return `## Name Matching Guidance

When comparing names on the document against the provided entity name (${entityName}):
${rules.join("\n")}`;
}

function buildImageQualitySection(): string {
  return `## Image Quality Assessment

Evaluate the document image and note:
- Is the document legible and complete?
- Are critical fields (name, number, dates) clearly readable?
- Does the image appear to be a photocopy, scan, or original?
- Is any part of the document cropped or cut off?
- Are there signs of tampering or alteration?`;
}

function buildOutputFormatSection(config?: PromptConfig): string {
  const multiDocNote = config?.multiDocPerFile
    ? `IMPORTANT: A single file may contain multiple distinct documents. You MUST always return a JSON **array** of document objects — one object per distinct document found in the file. If the file contains only one document, return an array with a single element.

Return a JSON array with the following structure:

`
    : `Return a JSON object with the following structure:

`;

  const nameMatchFields = config?.nameMatching?.enabled
    ? `    "nameOnDocument": "The primary name as it appears on the document, verbatim",
    "nameMatchStatus": "MATCH" | "PARTIAL_MATCH" | "MISMATCH" | "ILLEGIBLE",
    "nameMatchNotes": "Explanation of any name variation or mismatch. Null if exact match.",
`
    : "";

  const qualityFields = config?.imageQualityAssessment !== false
    ? `    "imageQuality": {
      "legibility": "CLEAR" | "PARTIALLY_LEGIBLE" | "ILLEGIBLE",
      "completeness": "COMPLETE" | "PARTIAL" | "CROPPED",
      "documentCondition": "ORIGINAL" | "SCAN" | "PHOTOCOPY" | "UNCLEAR",
      "tamperingIndicators": "Description of any signs of tampering, or 'None detected'"
    },
`
    : "";

  const dateFields = `    "dateFields": {
      "dateOfIssue": "dd-mm-yyyy or null",
      "dateOfExpiry": "dd-mm-yyyy or null",
      "isExpired": true | false | null
    },
`;

  const wrapper = config?.multiDocPerFile ? ["[", "]"] : ["", ""];

  return `## Output Format

${multiDocNote}${wrapper[0]}
  {
    "documentType": "<exact typeId from supported document types section, or UNKNOWN>",
    "extractedFields": {
      // Fields vary by document type — include only what is present and readable.
      // Use null for fields that should exist but are illegible or missing.
      // IMPORTANT: Use FLAT values directly (string, number, boolean, or null).
      // Do NOT nest values in objects. Correct: "full_name": "John Doe"
      // Wrong: "full_name": {"value": "John Doe", "confidence": 0.9}
    },
${nameMatchFields}${dateFields}${qualityFields}    "confidence": "HIGH" | "MEDIUM" | "LOW",
    "confidenceReason": "Brief explanation of confidence level",
    "anomalies": ["List of specific issues found — empty array if none"],
    "observations": "Free-text summary of anything noteworthy about this document"
  }
${wrapper[1]}

### Confidence Definitions
- **HIGH**: Document is clearly legible, all expected fields are extracted, no anomalies.
- **MEDIUM**: Document is mostly legible but some fields are unclear or minor anomalies exist.
- **LOW**: Document is poorly legible, critical fields are missing, or significant anomalies (e.g., name mismatch, possible tampering).

Return ONLY valid JSON. No markdown formatting, no preamble, no commentary outside the JSON.`;
}

// ─── Helpers ───

function substituteVariables(
  template: string,
  metadata: Record<string, unknown>
): string {
  return template.replace(/\$\{(\w+)\}/g, (_, key) => {
    const value = metadata[key];
    return value !== undefined && value !== null ? String(value) : `\${${key}}`;
  });
}

function buildContextFieldsString(
  config: PromptConfig | undefined,
  metadata: Record<string, unknown>
): string {
  const fields = config?.contextFields ?? [];
  return fields
    .map((field) => {
      const value = metadata[field];
      if (value === undefined || value === null) return "";
      const label = field.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
      return `- ${label}: ${value}`;
    })
    .filter(Boolean)
    .join("\n");
}
