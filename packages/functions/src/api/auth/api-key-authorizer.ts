import { Resource } from "sst";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  APIGatewayRequestAuthorizerEventV2,
  APIGatewaySimpleAuthorizerWithContextResult,
} from "aws-lambda";
import { timingSafeEqual, createHash } from "crypto";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export const handler = async (
  event: APIGatewayRequestAuthorizerEventV2
): Promise<APIGatewaySimpleAuthorizerWithContextResult> => {
  const apiKey =
    event.headers?.["x-api-key"] ?? event.headers?.["X-Api-Key"] ?? "";

  if (!apiKey) {
    return {
      isAuthorized: false,
      context: { error: "Missing X-Api-Key header" },
    };
  }

  try {
    // 1. Try DynamoDB-managed keys first
    const keyHash = hashKey(apiKey);
    const { Item } = await ddb.send(
      new GetCommand({
        TableName: Resource.DocProofTable.name,
        Key: { pk: `APIKEY#${keyHash}`, sk: "META" },
      })
    );

    if (Item) {
      // Check if key is active
      if (Item.status !== "active") {
        return {
          isAuthorized: false,
          context: { error: "API key has been revoked" },
        };
      }

      // Check expiry
      if (
        Item.expiresAt &&
        new Date(Item.expiresAt as string) < new Date()
      ) {
        return {
          isAuthorized: false,
          context: { error: "API key has expired" },
        };
      }

      // Update lastUsedAt (fire-and-forget, don't block auth)
      ddb
        .send(
          new UpdateCommand({
            TableName: Resource.DocProofTable.name,
            Key: { pk: `APIKEY#${keyHash}`, sk: "META" },
            UpdateExpression: "SET lastUsedAt = :now",
            ExpressionAttributeValues: {
              ":now": new Date().toISOString(),
            },
          })
        )
        .catch(() => {}); // Swallow errors — non-critical

      return {
        isAuthorized: true,
        context: {
          apiKeyValid: "true",
          keyId: Item.keyId as string,
          keyName: Item.name as string,
        },
      };
    }

    // 2. Fall back to legacy SST Secret key
    const expectedKey = Resource.DocProofApiKey.value;
    if (safeCompare(apiKey, expectedKey)) {
      return {
        isAuthorized: true,
        context: {
          apiKeyValid: "true",
          keyId: "legacy",
          keyName: "SST Secret",
        },
      };
    }

    return {
      isAuthorized: false,
      context: { error: "Invalid API key" },
    };
  } catch (err) {
    console.error("API key authorization error:", err);
    return {
      isAuthorized: false,
      context: { error: "Authorization error" },
    };
  }
};
