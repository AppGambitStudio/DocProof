import { Resource } from "sst";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const eventBridge = new EventBridgeClient({});

/**
 * POST /admin/jobs/{id}/review — Approve or reject a job in review_required state.
 *
 * Body: { action: "approve" | "reject", notes?: string }
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const jobId = event.pathParameters?.id;
  if (!jobId) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Job ID required" }),
    };
  }

  let body: { action?: string; notes?: string };
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Invalid JSON body" }),
    };
  }

  const { action, notes } = body;

  if (action !== "approve" && action !== "reject") {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: 'action must be "approve" or "reject"' }),
    };
  }

  try {
    // Load job
    const { Item: job } = await ddb.send(
      new GetCommand({
        TableName: Resource.DocProofTable.name,
        Key: { pk: `JOB#${jobId}`, sk: "META" },
      })
    );

    if (!job) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Job not found" }),
      };
    }

    if (job.status !== "review_required") {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: `Cannot review job in "${job.status}" state. Job must be in "review_required" state.`,
        }),
      };
    }

    // Extract reviewer email from Cognito JWT claims
    const claims = (event.requestContext as any)?.authorizer?.jwt?.claims;
    const reviewerEmail = claims?.email ?? claims?.sub ?? "unknown";

    const now = new Date().toISOString();
    const newStatus = action === "approve" ? "approved" : "rejected";

    // Update job status and add review metadata
    await ddb.send(
      new UpdateCommand({
        TableName: Resource.DocProofTable.name,
        Key: { pk: `JOB#${jobId}`, sk: "META" },
        UpdateExpression:
          "SET #status = :status, updatedAt = :now, gsi1pk = :gsi1pk, gsi1sk = :now, " +
          "reviewedAt = :now, reviewedBy = :reviewer, reviewAction = :action, reviewNotes = :notes",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":status": newStatus,
          ":now": now,
          ":gsi1pk": `STATUS#${newStatus}`,
          ":reviewer": reviewerEmail,
          ":action": action,
          ":notes": notes || null,
        },
      })
    );

    // Publish EventBridge event
    await eventBridge.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: Resource.DocProofBus.name,
            Source: "docproof.jobs",
            DetailType: `job.${newStatus}`,
            Detail: JSON.stringify({
              jobId,
              status: newStatus,
              reviewedBy: reviewerEmail,
              reviewAction: action,
              reviewNotes: notes || null,
            }),
          },
        ],
      }),
    );

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId,
        status: newStatus,
        reviewedBy: reviewerEmail,
        reviewedAt: now,
      }),
    };
  } catch (err) {
    console.error("Review error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};
