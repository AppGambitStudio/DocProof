import { Resource } from "sst";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const s3 = new S3Client({});

interface CreateJobRequest {
  ruleSetId: string;
  ruleSetVersion?: number;
  externalRef?: string;
  metadata?: Record<string, unknown>;
  callbackUrl?: string;
  documentTypes?: string[]; // list of expected doc type IDs for presigned URLs
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  let body: CreateJobRequest;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Invalid JSON in request body" }),
    };
  }

  try {
    if (!body.ruleSetId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "ruleSetId is required" }),
      };
    }

    const jobId = `job_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const now = new Date().toISOString();

    // Create job record
    await ddb.send(
      new PutCommand({
        TableName: Resource.DocProofTable.name,
        Item: {
          pk: `JOB#${jobId}`,
          sk: "META",
          jobId,
          ruleSetId: body.ruleSetId,
          ruleSetVersion: body.ruleSetVersion ?? 0, // 0 = latest active
          status: "created",
          externalRef: body.externalRef,
          metadata: body.metadata ?? {},
          callbackUrl: body.callbackUrl,
          files: [],
          createdAt: now,
          updatedAt: now,
          // GSI for status queries
          gsi1pk: "STATUS#created",
          gsi1sk: now,
        },
      })
    );

    // If external ref provided, create lookup record
    if (body.externalRef) {
      await ddb.send(
        new PutCommand({
          TableName: Resource.DocProofTable.name,
          Item: {
            pk: `EXTERNAL#${body.externalRef}`,
            sk: `JOB#${jobId}`,
            jobId,
          },
        })
      );
    }

    // Generate presigned upload URLs if document types specified
    const uploadUrls: Record<string, string> = {};
    if (body.documentTypes?.length) {
      for (const docType of body.documentTypes) {
        const s3Key = `jobs/${jobId}/${docType}/${randomUUID()}`;
        const url = await getSignedUrl(
          s3,
          new PutObjectCommand({
            Bucket: Resource.DocProofBucket.name,
            Key: s3Key,
          }),
          { expiresIn: 3600 }
        );
        uploadUrls[docType] = url;
      }
    }

    return {
      statusCode: 201,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId,
        status: "created",
        ...(Object.keys(uploadUrls).length > 0 && { uploadUrls }),
      }),
    };
  } catch (err) {
    console.error("Error creating job:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};
