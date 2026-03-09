import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type DocumentFormat,
  type ImageFormat,
} from "@aws-sdk/client-bedrock-runtime";
import type {
  DocumentTypeConfig,
  DocumentAnalysis,
  ExtractionResult,
  RuleSet,
  TokenUsage,
} from "../rules/types";
import { buildTokenUsageEntry } from "../rules/types";
import { buildSystemPrompt } from "./prompts";
import { withRetry, isRetryableBedrockError } from "./retry";

export class BedrockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BedrockError";
  }
}

export interface ExtractorConfig {
  region?: string;
  maxRetries?: number;
  /** Full RuleSet — when provided, uses the prompt builder for system prompt generation */
  ruleSet?: RuleSet;
  /** Job metadata — injected into prompt template for client context */
  metadata?: Record<string, unknown>;
}

export interface FileInput {
  fileId: string;
  /** Raw document bytes — passed directly to Converse API (NOT base64) */
  data: Buffer;
  mimeType: string;
  fileName?: string;
}

const HAIKU_MODEL_ID = "global.anthropic.claude-haiku-4-5-20251001-v1:0";
const SONNET_MODEL_ID = "global.anthropic.claude-sonnet-4-5-20250929-v1:0";

function getClient(region?: string): BedrockRuntimeClient {
  return new BedrockRuntimeClient({ region: region ?? process.env.AWS_REGION });
}

/** Map media type to the Converse API image format enum */
function toImageFormat(mediaType: string): ImageFormat {
  const map: Record<string, ImageFormat> = {
    "image/jpeg": "jpeg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
  };
  return map[mediaType] ?? "jpeg";
}

/** Build content blocks for the Converse API — raw bytes, not base64 */
function buildContentBlocks(
  docBytes: Buffer,
  mediaType: string
): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  if (mediaType === "application/pdf") {
    blocks.push({
      document: {
        name: "uploaded_document",
        format: "pdf" as DocumentFormat,
        source: {
          bytes: new Uint8Array(docBytes),
        },
      },
    });
  } else {
    blocks.push({
      image: {
        format: toImageFormat(mediaType),
        source: {
          bytes: new Uint8Array(docBytes),
        },
      },
    });
  }

  blocks.push({
    text: "Analyze this file and extract all relevant information. If this file contains multiple distinct documents (e.g., two ID cards in one photo, or different documents across PDF pages), return a separate entry for each. Return the result as a JSON array.",
  });

  return blocks;
}

/** Simple fallback prompt when no RuleSet is provided */
function buildSimpleExtractionPrompt(docType: DocumentTypeConfig): string {
  const fieldList = docType.expectedFields
    .map((f) => `- "${f.name}" (${f.type}): ${f.description ?? f.label}`)
    .join("\n");

  return `You are a document extraction specialist.
You are processing a: ${docType.label}

${docType.extractionPrompt}

Extract the following fields:
${fieldList}

RULES:
- Return ONLY valid JSON array, no markdown fences, no preamble
- Each element represents a distinct document found in the file
- Use the exact field names listed above in "extractedFields"
- Include confidence as "HIGH", "MEDIUM", or "LOW"
- Include anomalies as an array of strings (empty if none)

Return a JSON array:
[
  {
    "documentType": "${docType.typeId}",
    "extractedFields": { ... },
    "confidence": "HIGH" | "MEDIUM" | "LOW",
    "anomalies": [],
    "observations": "summary"
  }
]

Return ONLY valid JSON. No markdown, no commentary outside the JSON.`;
}

/**
 * Invoke a Bedrock model via the Converse API.
 * Returns parsed document analyses and token usage.
 */
async function invokeModel(
  client: BedrockRuntimeClient,
  modelId: string,
  systemPrompt: string,
  docBytes: Buffer,
  mediaType: string,
  maxRetries: number
): Promise<{ analyses: DocumentAnalysis[]; tokenUsageEntry: TokenUsage }> {
  console.log("Invoking Bedrock model via Converse API:", { modelId, mediaType });

  const command = new ConverseCommand({
    modelId,
    system: [
      { text: systemPrompt },
      { cachePoint: { type: "default" } },
    ],
    messages: [
      {
        role: "user",
        content: buildContentBlocks(docBytes, mediaType),
      },
    ],
    inferenceConfig: {
      maxTokens: 4000,
    },
  });

  let response;
  try {
    response = await withRetry(() => client.send(command), {
      maxRetries,
      baseDelayMs: 1000,
      isRetryable: isRetryableBedrockError,
    });
    console.log("Invoke model response", {
      modelId,
      stopReason: response.stopReason,
      usage: response.usage,
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown Bedrock error";
    throw new BedrockError(`Bedrock invocation failed: ${errMsg}`);
  }

  // Build token usage entry
  const inputTokens = response.usage?.inputTokens ?? 0;
  const outputTokens = response.usage?.outputTokens ?? 0;
  const tokenUsageEntry = buildTokenUsageEntry(modelId, inputTokens, outputTokens);

  // Extract text from response
  const text: string = response.output?.message?.content?.[0]?.text ?? "{}";

  // Robust JSON parsing: try array first, then single object, then fallback
  const fallbackAnalysis: DocumentAnalysis = {
    documentType: "UNKNOWN",
    extractedFields: {},
    confidence: "LOW",
    observations: "Failed to parse AI response",
    anomalies: [],
  };

  const arrayMatch = text.match(/\[[\s\S]*\]/);
  const objectMatch = text.match(/\{[\s\S]*\}/);

  if (!arrayMatch && !objectMatch) {
    return { analyses: [fallbackAnalysis], tokenUsageEntry };
  }

  try {
    if (arrayMatch) {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return { analyses: parsed as DocumentAnalysis[], tokenUsageEntry };
      }
    }
    if (objectMatch) {
      return {
        analyses: [JSON.parse(objectMatch[0]) as DocumentAnalysis],
        tokenUsageEntry,
      };
    }
    return { analyses: [fallbackAnalysis], tokenUsageEntry };
  } catch {
    return {
      analyses: [
        { ...fallbackAnalysis, observations: "Failed to parse AI response JSON" },
      ],
      tokenUsageEntry,
    };
  }
}

/**
 * Extract structured data from a document using Claude via Bedrock.
 *
 * Uses Haiku 4.5 first; escalates to Sonnet 4.5 if any document
 * in the response has LOW confidence (string-based check).
 *
 * Accepts raw Buffer bytes — passed directly to Converse API (no base64 encoding).
 */
export async function extractDocument(
  config: ExtractorConfig,
  docType: DocumentTypeConfig,
  file: FileInput
): Promise<ExtractionResult> {
  const client = getClient(config.region);
  const maxRetries = config.maxRetries ?? 3;

  // Use full prompt builder when RuleSet is available, otherwise fallback
  const systemPrompt = config.ruleSet
    ? buildSystemPrompt(config.ruleSet, config.metadata ?? {})
    : buildSimpleExtractionPrompt(docType);

  const tokenUsageEntries: TokenUsage[] = [];

  // Phase 1: Try with Haiku
  let { analyses, tokenUsageEntry } = await invokeModel(
    client,
    HAIKU_MODEL_ID,
    systemPrompt,
    file.data,
    file.mimeType,
    maxRetries
  );
  tokenUsageEntries.push(tokenUsageEntry);

  // If any document has LOW confidence, retry the whole file with Sonnet
  const hasLowConfidence = analyses.some(
    (r) => r?.confidence?.toUpperCase() === "LOW"
  );
  if (hasLowConfidence) {
    console.log(
      `Low confidence detected for ${file.fileId}, escalating to Sonnet`
    );
    const sonnetResult = await invokeModel(
      client,
      SONNET_MODEL_ID,
      systemPrompt,
      file.data,
      file.mimeType,
      maxRetries
    );
    analyses = sonnetResult.analyses;
    tokenUsageEntries.push(sonnetResult.tokenUsageEntry);
  }

  // Tag each token entry with the file name
  if (file.fileName) {
    for (const entry of tokenUsageEntries) {
      entry.fileName = file.fileName;
    }
  }

  return {
    fileId: file.fileId,
    analyses,
    tokenUsage: tokenUsageEntries,
    escalated: hasLowConfidence,
  };
}

/**
 * Cross-document semantic validation using Claude via Bedrock.
 * Uses Sonnet for semantic matching (higher accuracy needed).
 */
export async function semanticMatch(
  config: ExtractorConfig,
  description: string,
  sourceDoc: { type: string; fields: Record<string, unknown> },
  targetDoc: { type: string; fields: Record<string, unknown> }
): Promise<{
  match: boolean;
  confidence: number;
  reasoning: string;
  tokenUsage: TokenUsage;
}> {
  const client = getClient(config.region);
  const maxRetries = config.maxRetries ?? 3;
  const safeDefault = {
    match: false,
    confidence: 0,
    reasoning: "Semantic match failed",
    tokenUsage: buildTokenUsageEntry(SONNET_MODEL_ID, 0, 0),
  };

  const prompt = `Given extracted data from two documents:

Document A (${sourceDoc.type}): ${JSON.stringify(sourceDoc.fields)}
Document B (${targetDoc.type}): ${JSON.stringify(targetDoc.fields)}

Validation check: "${description}"

Respond with ONLY valid JSON:
{
  "match": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}`;

  const command = new ConverseCommand({
    modelId: SONNET_MODEL_ID,
    system: [{ text: "You are a document validation specialist." }],
    messages: [{ role: "user", content: [{ text: prompt }] }],
    inferenceConfig: { maxTokens: 1024 },
  });

  try {
    const response = await withRetry(() => client.send(command), {
      maxRetries,
      baseDelayMs: 1000,
      isRetryable: isRetryableBedrockError,
    });

    const inputTokens = response.usage?.inputTokens ?? 0;
    const outputTokens = response.usage?.outputTokens ?? 0;
    const tokenUsage = buildTokenUsageEntry(SONNET_MODEL_ID, inputTokens, outputTokens);

    const text = response.output?.message?.content?.[0]?.text ?? "{}";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("semanticMatch: no JSON found in response");
      return safeDefault;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      match: parsed.match ?? false,
      confidence: parsed.confidence ?? 0,
      reasoning: parsed.reasoning ?? "",
      tokenUsage,
    };
  } catch (err) {
    console.error(
      "semanticMatch failed:",
      err instanceof Error ? err.message : "Unknown error"
    );
    return safeDefault;
  }
}
