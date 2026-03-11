import { Resource } from "sst";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const JOB_STATUSES = [
  "created",
  "uploading",
  "processing",
  "extracting",
  "validating",
  "completed",
  "failed",
  "review_required",
  "approved",
  "rejected",
] as const;

/**
 * GET /admin/stats — Dashboard statistics.
 * Returns job counts by status, recent completions, and cost summary.
 */
export const handler: APIGatewayProxyHandlerV2 = async () => {
  try {
    const statusCounts: Record<string, number> = {};
    const recentCompleted: Record<string, unknown>[] = [];
    let totalCost = 0;

    // Query job counts by status using GSI (parallel)
    const results = await Promise.all(
      JOB_STATUSES.map(async (status) => {
        const fetchItems = ["completed", "failed", "review_required", "approved", "rejected"].includes(status);
        const { Count = 0, Items = [] } = await ddb.send(
          new QueryCommand({
            TableName: Resource.DocProofTable.name,
            IndexName: "gsi1",
            KeyConditionExpression: "gsi1pk = :pk",
            ExpressionAttributeValues: { ":pk": `STATUS#${status}` },
            ScanIndexForward: false,
            ...(fetchItems ? { Limit: 10 } : { Select: "COUNT" }),
          })
        );
        return { status, count: fetchItems ? (Items.length || Count) : Count, items: Items };
      })
    );

    for (const { status, count, items } of results) {
      statusCounts[status] = count;

      // Accumulate cost from terminal states (all incur Bedrock costs)
      if (["completed", "failed", "review_required", "approved", "rejected"].includes(status)) {
        for (const item of items) {
          totalCost += (item.costUsd as number) ?? 0;
        }
      }

      if (status === "completed") {
        for (const item of items) {
          recentCompleted.push({
            jobId: item.jobId,
            ruleSetId: item.ruleSetId,
            externalRef: item.externalRef,
            costUsd: item.costUsd ?? 0,
            fileCount: (item.files as unknown[])?.length ?? 0,
            completedAt: item.completedAt,
          });
        }
      }
    }

    // Count active rulesets
    const { Count: ruleSetCount = 0 } = await ddb.send(
      new QueryCommand({
        TableName: Resource.DocProofTable.name,
        IndexName: "gsi1",
        KeyConditionExpression: "gsi1pk = :pk",
        ExpressionAttributeValues: { ":pk": "RULESET#active" },
        Select: "COUNT",
      })
    );

    const total = Object.values(statusCounts).reduce((s, c) => s + c, 0);
    const processing =
      (statusCounts.extracting ?? 0) + (statusCounts.validating ?? 0);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobs: {
          total,
          processing,
          completed: statusCounts.completed ?? 0,
          failed: statusCounts.failed ?? 0,
          reviewRequired: statusCounts.review_required ?? 0,
          byStatus: statusCounts,
        },
        ruleSets: {
          active: ruleSetCount,
        },
        cost: {
          totalUsd: parseFloat(totalCost.toFixed(6)),
        },
        recentCompleted,
      }),
    };
  } catch (err) {
    console.error("Stats error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};
