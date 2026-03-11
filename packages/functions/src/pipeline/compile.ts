import { Resource } from "sst";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { calculateCostUsd } from "@docproof/core";
import type { JobResult, TokenUsage, ExtractionResult } from "@docproof/core";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const s3 = new S3Client({});

interface CompileInput {
  /** Partial result from validate step (without token/cost aggregation) */
  jobId: string;
  overallStatus: "pass" | "fail" | "review_required";
  summary: JobResult["summary"];
  documents: JobResult["documents"];
  crossDocResults: JobResult["crossDocResults"];
  anomalies: JobResult["anomalies"];
  /** Token usage from validation step (semantic matches) */
  validationTokenUsage?: TokenUsage[];
}

/**
 * Step 4: Aggregate token usage, calculate cost, store final results.
 */
export const handler = async (event: CompileInput) => {
  const { jobId, overallStatus } = event;
  const now = new Date().toISOString();

  const finalStatus =
    overallStatus === "review_required" ? "review_required" : "completed";

  // Aggregate extraction token usage from all documents
  const extractionTokens: TokenUsage[] = event.documents.flatMap(
    (doc) => doc.tokenUsage ?? []
  );

  // Validation token usage (from semantic cross-doc matches)
  const validationTokens: TokenUsage[] = event.validationTokenUsage ?? [];

  const allTokens = [...extractionTokens, ...validationTokens];
  const totalInput = allTokens.reduce((s, t) => s + t.inputTokens, 0);
  const totalOutput = allTokens.reduce((s, t) => s + t.outputTokens, 0);
  const costUsd = calculateCostUsd(allTokens);

  const result: JobResult = {
    jobId: event.jobId,
    overallStatus: event.overallStatus,
    summary: event.summary,
    documents: event.documents,
    crossDocResults: event.crossDocResults,
    anomalies: event.anomalies,
    tokenUsage: {
      extraction: extractionTokens,
      validation: validationTokens,
      total: { inputTokens: totalInput, outputTokens: totalOutput },
    },
    costUsd,
    processedAt: now,
  };

  console.log(
    `Job ${jobId}: ${totalInput} input tokens, ${totalOutput} output tokens, $${costUsd.toFixed(6)} cost`
  );

  // Store result in DynamoDB
  await ddb.send(
    new PutCommand({
      TableName: Resource.DocProofTable.name,
      Item: {
        pk: `JOB#${jobId}`,
        sk: "RESULT",
        result,
        createdAt: now,
      },
    })
  );

  // Also store full result JSON in S3 for archival
  await s3.send(
    new PutObjectCommand({
      Bucket: Resource.DocProofBucket.name,
      Key: `results/${jobId}/result.json`,
      Body: JSON.stringify(result, null, 2),
      ContentType: "application/json",
    })
  );

  // Update job status
  await ddb.send(
    new UpdateCommand({
      TableName: Resource.DocProofTable.name,
      Key: { pk: `JOB#${jobId}`, sk: "META" },
      UpdateExpression:
        "SET #status = :s, updatedAt = :now, completedAt = :now, gsi1pk = :gsi1pk, gsi1sk = :now, costUsd = :cost",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":s": finalStatus,
        ":gsi1pk": `STATUS#${finalStatus}`,
        ":now": now,
        ":cost": costUsd,
      },
    })
  );

  return { jobId, status: finalStatus, costUsd, resultKey: `results/${jobId}/result.json` };
};
