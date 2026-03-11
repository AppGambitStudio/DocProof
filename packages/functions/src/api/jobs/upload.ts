import { Resource } from "sst";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const s3 = new S3Client({});

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const jobId = event.pathParameters?.id;
  if (!jobId) {
    return { statusCode: 400, body: JSON.stringify({ error: "Job ID required" }) };
  }

  try {
    // Verify job exists and is in uploadable state
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
        body: JSON.stringify({ error: `Cannot upload files to job in ${job.status} state` }),
      };
    }

    // Parse request for file metadata
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(event.body ?? "{}");
    } catch {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Invalid JSON in request body" }),
      };
    }
    const { fileName, documentType, mimeType, size } = body;

    if (!fileName || !mimeType) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "fileName and mimeType are required" }),
      };
    }

    // documentType is optional — "auto" means the engine will classify the document
    const resolvedDocType = (documentType as string) || "auto";

    const fileId = `file_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    const s3Key = `jobs/${jobId}/${resolvedDocType}/${fileId}`;

    // Generate presigned upload URL
    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: Resource.DocProofBucket.name,
        Key: s3Key,
        ContentType: mimeType,
      }),
      { expiresIn: 3600 }
    );

    // Add file record to job
    const now = new Date().toISOString();
    await ddb.send(
      new UpdateCommand({
        TableName: Resource.DocProofTable.name,
        Key: { pk: `JOB#${jobId}`, sk: "META" },
        UpdateExpression:
          "SET #files = list_append(if_not_exists(#files, :empty), :newFile), #status = :status, updatedAt = :now, gsi1pk = :gsi1pk, gsi1sk = :now",
        ExpressionAttributeNames: { "#files": "files", "#status": "status" },
        ExpressionAttributeValues: {
          ":empty": [],
          ":newFile": [{ fileId, fileName, documentType: resolvedDocType, s3Key, mimeType, ...(typeof size === "number" ? { size } : {}), uploadedAt: now }],
          ":status": "uploading",
          ":gsi1pk": "STATUS#uploading",
          ":now": now,
        },
      })
    );

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId, uploadUrl }),
    };
  } catch (err) {
    console.error("Error handling upload:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Internal server error" }) };
  }
};
