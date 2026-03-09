import { Resource } from "sst";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface ReceiveInput {
  jobId: string;
}

/**
 * Step 1: Receive job, validate input, load ruleset, prepare extraction tasks.
 */
export const handler = async (event: ReceiveInput) => {
  const { jobId } = event;

  // Load job
  const { Item: job } = await ddb.send(
    new GetCommand({
      TableName: Resource.DocProofTable.name,
      Key: { pk: `JOB#${jobId}`, sk: "META" },
    })
  );

  if (!job) throw new Error(`Job ${jobId} not found`);

  // Load ruleset
  const { Item: ruleSet } = await ddb.send(
    new GetCommand({
      TableName: Resource.DocProofTable.name,
      Key: { pk: `RULESET#${job.ruleSetId}`, sk: "META" },
    })
  );

  if (!ruleSet) throw new Error(`RuleSet ${job.ruleSetId} not found`);

  // Update status to processing (pipeline: uploading → processing → extracting)
  const now = new Date().toISOString();
  await ddb.send(
    new UpdateCommand({
      TableName: Resource.DocProofTable.name,
      Key: { pk: `JOB#${jobId}`, sk: "META" },
      UpdateExpression: "SET #status = :s, updatedAt = :now, gsi1pk = :gsi1pk, gsi1sk = :now",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":s": "processing",
        ":gsi1pk": "STATUS#processing",
        ":now": now,
      },
    })
  );

  // Return extraction tasks (one per file), passing job metadata for prompt context
  const jobMetadata = job.metadata ?? {};

  return {
    jobId,
    ruleSetId: job.ruleSetId,
    ruleSetVersion: ruleSet.version,
    metadata: jobMetadata,
    extractionTasks: (job.files ?? []).map((f: any) => ({
      jobId,
      fileId: f.fileId,
      s3Key: f.s3Key,
      mimeType: f.mimeType,
      documentType: f.documentType,
      fileName: f.fileName,
      ruleSetId: job.ruleSetId,
      ruleSetVersion: ruleSet.version,
      metadata: jobMetadata,
    })),
  };
};
