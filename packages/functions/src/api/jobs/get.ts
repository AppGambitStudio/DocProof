import { Resource } from "sst";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    const jobId = event.pathParameters?.id;
    if (!jobId) {
      return { statusCode: 400, body: JSON.stringify({ error: "Job ID required" }) };
    }

    // Get job metadata
    const { Item: job } = await ddb.send(
      new GetCommand({
        TableName: Resource.DocProofTable.name,
        Key: { pk: `JOB#${jobId}`, sk: "META" },
      })
    );

    if (!job) {
      return { statusCode: 404, body: JSON.stringify({ error: "Job not found" }) };
    }

    // Get result if job is completed
    let result = null;
    if (job.status === "completed" || job.status === "review_required") {
      const { Item: resultItem } = await ddb.send(
        new GetCommand({
          TableName: Resource.DocProofTable.name,
          Key: { pk: `JOB#${jobId}`, sk: "RESULT" },
        })
      );
      result = resultItem?.result ?? null;
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId: job.jobId,
        status: job.status,
        ruleSetId: job.ruleSetId,
        ruleSetVersion: job.ruleSetVersion,
        externalRef: job.externalRef,
        metadata: job.metadata,
        files: job.files,
        result,
        timestamps: {
          created: job.createdAt,
          updated: job.updatedAt,
          completed: job.completedAt,
        },
      }),
    };
  } catch (err) {
    console.error("Error getting job:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Internal server error" }) };
  }
};
