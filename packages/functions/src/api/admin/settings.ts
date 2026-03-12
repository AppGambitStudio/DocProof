import { Resource } from "sst";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { DEFAULT_SETTINGS, SETTINGS_FIELDS } from "@docproof/core";
import type { AppSettings } from "@docproof/core";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const method = event.requestContext.http.method;

  if (method === "GET") {
    return handleGet();
  }
  if (method === "PUT") {
    return handlePut(event.body);
  }

  return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
};

async function handleGet() {
  try {
    const { Item } = await ddb.send(
      new GetCommand({
        TableName: Resource.DocProofTable.name,
        Key: { pk: "SETTINGS", sk: "GLOBAL" },
      })
    );

    // Merge stored settings with defaults (so new settings fields auto-populate)
    const stored = (Item?.settings ?? {}) as Partial<AppSettings>;
    const settings: AppSettings = { ...DEFAULT_SETTINGS, ...stored };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    };
  } catch (err) {
    console.error("Settings GET error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Internal server error" }) };
  }
}

async function handlePut(rawBody: string | undefined) {
  try {
    if (!rawBody) {
      return { statusCode: 400, body: JSON.stringify({ error: "Request body required" }) };
    }

    const updates = JSON.parse(rawBody);

    // Validate: only allow known fields
    const sanitized: Partial<AppSettings> = {};
    for (const key of SETTINGS_FIELDS) {
      if (key in updates) {
        (sanitized as any)[key] = updates[key];
      }
    }

    if (Object.keys(sanitized).length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: "No valid settings fields provided" }) };
    }

    // Validate specific fields
    if (sanitized.defaultTemperature !== undefined) {
      if (typeof sanitized.defaultTemperature !== "number" || sanitized.defaultTemperature < 0 || sanitized.defaultTemperature > 1) {
        return { statusCode: 400, body: JSON.stringify({ error: "Temperature must be between 0 and 1" }) };
      }
    }
    if (sanitized.maxFileSizeMb !== undefined) {
      if (typeof sanitized.maxFileSizeMb !== "number" || sanitized.maxFileSizeMb < 1 || sanitized.maxFileSizeMb > 100) {
        return { statusCode: 400, body: JSON.stringify({ error: "Max file size must be between 1 and 100 MB" }) };
      }
    }
    if (sanitized.maxFilesPerJob !== undefined) {
      if (typeof sanitized.maxFilesPerJob !== "number" || sanitized.maxFilesPerJob < 1 || sanitized.maxFilesPerJob > 100) {
        return { statusCode: 400, body: JSON.stringify({ error: "Max files per job must be between 1 and 100" }) };
      }
    }
    if (sanitized.reviewAssignmentMode !== undefined) {
      if (!["manual", "round_robin"].includes(sanitized.reviewAssignmentMode)) {
        return { statusCode: 400, body: JSON.stringify({ error: "Invalid review assignment mode" }) };
      }
    }

    // Load existing settings, merge, save
    const { Item } = await ddb.send(
      new GetCommand({
        TableName: Resource.DocProofTable.name,
        Key: { pk: "SETTINGS", sk: "GLOBAL" },
      })
    );

    const existing = (Item?.settings ?? {}) as Partial<AppSettings>;
    const merged = { ...existing, ...sanitized };

    await ddb.send(
      new PutCommand({
        TableName: Resource.DocProofTable.name,
        Item: {
          pk: "SETTINGS",
          sk: "GLOBAL",
          settings: merged,
          updatedAt: new Date().toISOString(),
        },
      })
    );

    const fullSettings: AppSettings = { ...DEFAULT_SETTINGS, ...merged };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fullSettings),
    };
  } catch (err) {
    console.error("Settings PUT error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Internal server error" }) };
  }
}
