import { Resource } from "sst";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const lambda = new LambdaClient({});

/**
 * POST /jobs/:id/process — Trigger the processing pipeline for a job.
 *
 * Validates the job is in a processable state (uploading), then invokes
 * the orchestrator Lambda asynchronously. Returns immediately.
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const jobId = event.pathParameters?.id;
  if (!jobId) {
    return { statusCode: 400, body: JSON.stringify({ error: "Job ID required" }) };
  }

  try {
    // Load job and verify it's in a processable state
    const { Item: job } = await ddb.send(
      new GetCommand({
        TableName: Resource.DocProofTable.name,
        Key: { pk: `JOB#${jobId}`, sk: "META" },
      })
    );

    if (!job) {
      return { statusCode: 404, body: JSON.stringify({ error: "Job not found" }) };
    }

    if (!["created", "uploading"].includes(job.status)) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: `Cannot process job in "${job.status}" state. Job must be in "created" or "uploading" state.`,
        }),
      };
    }

    const files = job.files ?? [];
    if (files.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "No files uploaded. Upload at least one document before processing." }),
      };
    }

    // Invoke orchestrator asynchronously (fire-and-forget)
    await lambda.send(
      new InvokeCommand({
        FunctionName: Resource.PipelineOrchestrator.name,
        InvocationType: "Event",
        Payload: JSON.stringify({ jobId }),
      })
    );

    return {
      statusCode: 202,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, status: "processing", message: "Pipeline started" }),
    };
  } catch (err) {
    console.error("Error starting pipeline:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Internal server error" }) };
  }
};
