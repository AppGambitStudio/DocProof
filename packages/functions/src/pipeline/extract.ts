import { Resource } from "sst";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { extractDocument } from "@docproof/core";
import type { ExtractionResult, DocumentTypeConfig, RuleSet } from "@docproof/core";

const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });

interface ExtractStepInput {
  jobId: string;
  fileId: string;
  s3Key: string;
  mimeType: string;
  documentType: string;
  ruleSetId: string;
  ruleSetVersion: number;
  fileName?: string;
  /** Job metadata passed through from receive step for prompt context injection */
  metadata?: Record<string, unknown>;
}

/**
 * Extract structured data from a single document.
 * Called by the orchestrator for each file in the job.
 * Uses Haiku 4.5 via Bedrock Converse API; escalates to Sonnet 4.5 if
 * any extracted document has LOW confidence.
 * Passes raw bytes to the Converse API (not base64).
 */
export const handler = async (
  event: ExtractStepInput
): Promise<ExtractionResult> => {
  const {
    jobId,
    fileId,
    s3Key,
    mimeType,
    documentType,
    ruleSetId,
    fileName,
    metadata,
  } = event;

  console.log(`Extracting document: ${fileId} (${documentType}) for job ${jobId}`);

  // Get the file from S3 as raw bytes
  const obj = await s3.send(
    new GetObjectCommand({
      Bucket: Resource.DocProofBucket.name,
      Key: s3Key,
    })
  );

  if (!obj.Body) {
    throw new Error(`S3 object body is empty for key: ${s3Key}`);
  }
  const bodyBytes = await obj.Body.transformToByteArray();
  const docBuffer = Buffer.from(bodyBytes);

  // Load the full RuleSet META (needed for promptConfig)
  const { Item: ruleSetMeta } = await ddb.send(
    new GetCommand({
      TableName: Resource.DocProofTable.name,
      Key: { pk: `RULESET#${ruleSetId}`, sk: "META" },
    })
  );

  // Load all document type configs for the ruleset (needed for multi-doc context)
  const { Items: allDocTypeItems = [] } = await ddb.send(
    new QueryCommand({
      TableName: Resource.DocProofTable.name,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: {
        ":pk": `RULESET#${ruleSetId}`,
        ":prefix": "DOCTYPE#",
      },
    })
  );

  // Build all document type configs (needed for auto-classification and multi-doc context)
  const allDocTypes: DocumentTypeConfig[] = allDocTypeItems.map((item) => ({
    typeId: item.typeId,
    label: item.label,
    required: item.required,
    maxCount: item.maxCount,
    acceptedFormats: item.acceptedFormats,
    extractionPrompt: item.extractionPrompt,
    expectedFields: item.expectedFields,
    fieldExtractionRules: item.fieldExtractionRules,
    flagConditions: item.flagConditions,
    applicableTo: item.applicableTo,
    category: item.category,
  }));

  // Resolve the document type config for extraction.
  // When documentType is "auto", the AI classifies the document — we pass a
  // synthetic config with all expected fields so the prompt covers everything.
  let docTypeConfig: DocumentTypeConfig;

  if (documentType === "auto") {
    // Auto-classification: merge all expected fields and prompts so the AI
    // can identify the document type and extract relevant fields.
    const allFields = allDocTypes.flatMap((dt) => dt.expectedFields);
    // Deduplicate fields by name
    const seen = new Set<string>();
    const uniqueFields = allFields.filter((f) => {
      if (seen.has(f.name)) return false;
      seen.add(f.name);
      return true;
    });

    const validTypeIds = allDocTypes.map((dt) => `"${dt.typeId}"`).join(", ");

    docTypeConfig = {
      typeId: "auto",
      label: "Auto-detect",
      required: false,
      maxCount: 99,
      acceptedFormats: ["pdf", "jpg", "png", "tiff"],
      extractionPrompt:
        "Identify the document type and extract all relevant fields. " +
        "The document could be any of the types listed in the supported document types section. " +
        `You MUST use one of these exact typeId values as the "documentType" in your response: ${validTypeIds}, or "UNKNOWN" if no match.`,
      expectedFields: uniqueFields,
    };
  } else {
    const ruleSetItem = allDocTypeItems.find(
      (item) => item.typeId === documentType
    );

    if (!ruleSetItem) {
      throw new Error(
        `Document type "${documentType}" not found in ruleset "${ruleSetId}"`
      );
    }

    docTypeConfig = {
      typeId: ruleSetItem.typeId,
      label: ruleSetItem.label,
      required: ruleSetItem.required,
      maxCount: ruleSetItem.maxCount,
      acceptedFormats: ruleSetItem.acceptedFormats,
      extractionPrompt: ruleSetItem.extractionPrompt,
      expectedFields: ruleSetItem.expectedFields,
      fieldExtractionRules: ruleSetItem.fieldExtractionRules,
      flagConditions: ruleSetItem.flagConditions,
      applicableTo: ruleSetItem.applicableTo,
      category: ruleSetItem.category,
    };
  }

  // Build RuleSet object for prompt generation (if promptConfig exists)
  const ruleSet: RuleSet | undefined = ruleSetMeta?.promptConfig
    ? {
        ...(ruleSetMeta as unknown as RuleSet),
        documentTypes: allDocTypes,
      }
    : undefined;

  // Extract using Claude via Bedrock Converse API
  // Haiku first, escalates to Sonnet on LOW confidence
  const result = await extractDocument(
    {
      ruleSet,
      metadata: metadata ?? {},
    },
    docTypeConfig,
    { fileId, data: docBuffer, mimeType, fileName }
  );

  const totalInput = result.tokenUsage.reduce((s, t) => s + t.inputTokens, 0);
  const totalOutput = result.tokenUsage.reduce((s, t) => s + t.outputTokens, 0);

  console.log(
    `Extraction complete for ${fileId}: ` +
      `analyses=${result.analyses.length}, ` +
      `escalated=${result.escalated}, ` +
      `tokens=${totalInput}in/${totalOutput}out`
  );

  return result;
};
