import { Resource } from "sst";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

/**
 * Admin-facing job endpoints (Cognito JWT auth).
 * GET /admin/jobs         — list jobs with optional filters
 * GET /admin/jobs/{id}    — get job detail with result
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const jobId = event.pathParameters?.id;

  try {
    if (jobId) {
      return await getJobDetail(jobId);
    }
    return await listJobs(event.queryStringParameters ?? {});
  } catch (err) {
    console.error("Admin jobs error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};

async function getJobDetail(jobId: string) {
  const { Item: job } = await ddb.send(
    new GetCommand({
      TableName: Resource.DocProofTable.name,
      Key: { pk: `JOB#${jobId}`, sk: "META" },
    })
  );

  if (!job) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: "Job not found" }),
    };
  }

  // Get result if completed
  let result = null;
  if (
    ["completed", "review_required", "failed", "approved", "rejected"].includes(job.status as string)
  ) {
    const { Item: resultItem } = await ddb.send(
      new GetCommand({
        TableName: Resource.DocProofTable.name,
        Key: { pk: `JOB#${jobId}`, sk: "RESULT" },
      })
    );
    result = resultItem?.result ?? null;
  }

  // Generate presigned read URLs for uploaded files
  const files = (job.files ?? []) as { fileId: string; s3Key: string; [k: string]: unknown }[];
  const fileUrls: Record<string, string> = {};
  await Promise.all(
    files.map(async (f) => {
      if (f.s3Key) {
        try {
          fileUrls[f.fileId] = await getSignedUrl(
            s3,
            new GetObjectCommand({
              Bucket: Resource.DocProofBucket.name,
              Key: f.s3Key,
            }),
            { expiresIn: 3600 }
          );
        } catch {
          // skip files that can't be signed
        }
      }
    })
  );

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
      fileUrls,
      costUsd: job.costUsd,
      result,
      reviewedBy: job.reviewedBy,
      reviewedAt: job.reviewedAt,
      reviewAction: job.reviewAction,
      reviewNotes: job.reviewNotes,
      timestamps: {
        created: job.createdAt,
        updated: job.updatedAt,
        completed: job.completedAt,
      },
    }),
  };
}

async function listJobs(params: Record<string, string | undefined>) {
  const status = params.status;
  const limit = Math.min(parseInt(params.limit ?? "50"), 100);
  const cursor = params.cursor; // lastEvaluatedKey for pagination

  if (status) {
    const queryParams: Record<string, unknown> = {
      TableName: Resource.DocProofTable.name,
      IndexName: "gsi1",
      KeyConditionExpression: "gsi1pk = :pk",
      ExpressionAttributeValues: { ":pk": `STATUS#${status}` },
      ScanIndexForward: false,
      Limit: limit,
    };

    if (cursor) {
      try {
        queryParams.ExclusiveStartKey = JSON.parse(
          Buffer.from(cursor, "base64url").toString()
        );
      } catch {
        // ignore invalid cursor
      }
    }

    const { Items = [], LastEvaluatedKey } = await ddb.send(
      new QueryCommand(queryParams as any)
    );

    const jobs = Items.map(formatJobSummary);
    const nextCursor = LastEvaluatedKey
      ? Buffer.from(JSON.stringify(LastEvaluatedKey)).toString("base64url")
      : undefined;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobs, count: jobs.length, nextCursor }),
    };
  }

  // No status filter — query all statuses via GSI (more efficient than scan)
  const ALL_STATUSES = [
    "created", "uploading", "processing", "extracting",
    "validating", "completed", "failed", "review_required",
    "approved", "rejected",
  ];

  const allResults = await Promise.all(
    ALL_STATUSES.map(async (s) => {
      const { Items = [] } = await ddb.send(
        new QueryCommand({
          TableName: Resource.DocProofTable.name,
          IndexName: "gsi1",
          KeyConditionExpression: "gsi1pk = :pk",
          ExpressionAttributeValues: { ":pk": `STATUS#${s}` },
          ScanIndexForward: false,
          Limit: limit,
        })
      );
      return Items;
    })
  );

  // Merge, sort by updatedAt descending, and take limit
  const merged = allResults
    .flat()
    .sort((a, b) => {
      const aTime = (a.updatedAt as string) ?? "";
      const bTime = (b.updatedAt as string) ?? "";
      return bTime.localeCompare(aTime);
    })
    .slice(0, limit);

  const jobs = merged.map(formatJobSummary);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobs, count: jobs.length }),
  };
}

function formatJobSummary(item: Record<string, unknown>) {
  return {
    jobId: item.jobId,
    status: item.status,
    ruleSetId: item.ruleSetId,
    externalRef: item.externalRef,
    fileCount: (item.files as unknown[])?.length ?? 0,
    costUsd: item.costUsd,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    completedAt: item.completedAt,
  };
}
