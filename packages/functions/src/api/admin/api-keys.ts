import { Resource } from "sst";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { createHash, randomBytes } from "crypto";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function generateApiKey(): string {
  return `dp_sk_${randomBytes(32).toString("hex")}`;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const method = event.requestContext.http.method;
  const path = event.rawPath;
  const keyId = event.pathParameters?.id;

  // Extract creator email from JWT claims
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const userEmail = (claims.email as string) ?? "unknown";

  try {
    // GET /admin/api-keys — list all keys
    if (method === "GET" && !keyId) {
      return handleList();
    }
    // GET /admin/api-keys/{id} — get key details
    if (method === "GET" && keyId) {
      return handleGetOne(keyId);
    }
    // POST /admin/api-keys — create new key
    if (method === "POST") {
      return handleCreate(event.body, userEmail);
    }
    // PUT /admin/api-keys/{id} — update key
    if (method === "PUT" && keyId) {
      return handleUpdate(keyId, event.body);
    }
    // DELETE /admin/api-keys/{id} — revoke key
    if (method === "DELETE" && keyId) {
      return handleRevoke(keyId, userEmail);
    }

    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  } catch (err) {
    console.error("API Keys error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};

async function handleList() {
  const { Items = [] } = await ddb.send(
    new QueryCommand({
      TableName: Resource.DocProofTable.name,
      IndexName: "gsi1",
      KeyConditionExpression: "gsi1pk = :pk",
      ExpressionAttributeValues: { ":pk": "APIKEYS" },
      ScanIndexForward: false,
    })
  );

  const keys = Items.map((item) => ({
    keyId: item.keyId,
    name: item.name,
    keyPrefix: item.keyPrefix,
    status: item.status,
    createdBy: item.createdBy,
    createdAt: item.createdAt,
    lastUsedAt: item.lastUsedAt,
    expiresAt: item.expiresAt,
    scopes: item.scopes,
  }));

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keys }),
  };
}

async function handleGetOne(keyId: string) {
  // Query GSI to find the key by keyId
  const { Items = [] } = await ddb.send(
    new QueryCommand({
      TableName: Resource.DocProofTable.name,
      IndexName: "gsi1",
      KeyConditionExpression: "gsi1pk = :pk AND gsi1sk = :sk",
      ExpressionAttributeValues: { ":pk": "APIKEYS", ":sk": keyId },
    })
  );

  if (Items.length === 0) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: "API key not found" }),
    };
  }

  const item = Items[0];
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      keyId: item.keyId,
      name: item.name,
      keyPrefix: item.keyPrefix,
      status: item.status,
      createdBy: item.createdBy,
      createdAt: item.createdAt,
      lastUsedAt: item.lastUsedAt,
      expiresAt: item.expiresAt,
      scopes: item.scopes,
    }),
  };
}

async function handleCreate(
  rawBody: string | undefined,
  createdBy: string
) {
  if (!rawBody) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Request body required" }),
    };
  }

  const { name, expiresAt, scopes } = JSON.parse(rawBody);

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Name is required" }),
    };
  }

  const rawKey = generateApiKey();
  const keyHash = hashKey(rawKey);
  const keyId = `key_${randomBytes(6).toString("hex")}`;
  const keyPrefix = rawKey.substring(0, 10) + "...";
  const now = new Date().toISOString();

  await ddb.send(
    new PutCommand({
      TableName: Resource.DocProofTable.name,
      Item: {
        pk: `APIKEY#${keyHash}`,
        sk: "META",
        keyId,
        keyHash,
        keyPrefix,
        name: name.trim(),
        status: "active",
        createdBy,
        createdAt: now,
        lastUsedAt: null,
        expiresAt: expiresAt || null,
        scopes: scopes || [],
        gsi1pk: "APIKEYS",
        gsi1sk: keyId,
      },
    })
  );

  // Return the full key ONCE — never stored or retrievable again
  return {
    statusCode: 201,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      keyId,
      key: rawKey,
      keyPrefix,
      name: name.trim(),
      status: "active",
      createdBy,
      createdAt: now,
      expiresAt: expiresAt || null,
      scopes: scopes || [],
      message: "Save this key now — it will not be shown again.",
    }),
  };
}

async function handleUpdate(keyId: string, rawBody: string | undefined) {
  if (!rawBody) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Request body required" }),
    };
  }

  const updates = JSON.parse(rawBody);

  // Find key by keyId via GSI
  const { Items = [] } = await ddb.send(
    new QueryCommand({
      TableName: Resource.DocProofTable.name,
      IndexName: "gsi1",
      KeyConditionExpression: "gsi1pk = :pk AND gsi1sk = :sk",
      ExpressionAttributeValues: { ":pk": "APIKEYS", ":sk": keyId },
    })
  );

  if (Items.length === 0) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: "API key not found" }),
    };
  }

  const item = Items[0];
  const updateExpressions: string[] = ["updatedAt = :now"];
  const exprValues: Record<string, unknown> = {
    ":now": new Date().toISOString(),
  };

  if (updates.name !== undefined) {
    updateExpressions.push("#name = :name");
    exprValues[":name"] = updates.name;
  }
  if (updates.scopes !== undefined) {
    updateExpressions.push("scopes = :scopes");
    exprValues[":scopes"] = updates.scopes;
  }
  if (updates.expiresAt !== undefined) {
    updateExpressions.push("expiresAt = :exp");
    exprValues[":exp"] = updates.expiresAt;
  }

  await ddb.send(
    new UpdateCommand({
      TableName: Resource.DocProofTable.name,
      Key: { pk: item.pk, sk: "META" },
      UpdateExpression: `SET ${updateExpressions.join(", ")}`,
      ExpressionAttributeNames:
        updates.name !== undefined ? { "#name": "name" } : undefined,
      ExpressionAttributeValues: exprValues,
    })
  );

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keyId, updated: true }),
  };
}

async function handleRevoke(keyId: string, revokedBy: string) {
  // Find key by keyId via GSI
  const { Items = [] } = await ddb.send(
    new QueryCommand({
      TableName: Resource.DocProofTable.name,
      IndexName: "gsi1",
      KeyConditionExpression: "gsi1pk = :pk AND gsi1sk = :sk",
      ExpressionAttributeValues: { ":pk": "APIKEYS", ":sk": keyId },
    })
  );

  if (Items.length === 0) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: "API key not found" }),
    };
  }

  const item = Items[0];

  await ddb.send(
    new UpdateCommand({
      TableName: Resource.DocProofTable.name,
      Key: { pk: item.pk, sk: "META" },
      UpdateExpression:
        "SET #status = :s, revokedBy = :by, revokedAt = :at",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":s": "revoked",
        ":by": revokedBy,
        ":at": new Date().toISOString(),
      },
    })
  );

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keyId, status: "revoked" }),
  };
}
