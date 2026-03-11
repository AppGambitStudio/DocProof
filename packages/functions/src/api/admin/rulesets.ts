import { Resource } from "sst";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  DeleteCommand,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const method = event.requestContext.http.method;
  const ruleSetId = event.pathParameters?.id;

  try {
    switch (method) {
      case "GET": {
        if (ruleSetId) {
          const { Item } = await ddb.send(
            new GetCommand({
              TableName: Resource.DocProofTable.name,
              Key: { pk: `RULESET#${ruleSetId}`, sk: "META" },
            })
          );
          if (!Item)
            return { statusCode: 404, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Not found" }) };
          return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(Item) };
        }
        // Fetch all rulesets across statuses (draft, active, archived)
        const statusValues = ["draft", "active", "archived"];
        const allItems: Record<string, unknown>[] = [];
        await Promise.all(
          statusValues.map(async (s) => {
            const { Items = [] } = await ddb.send(
              new QueryCommand({
                TableName: Resource.DocProofTable.name,
                IndexName: "gsi1",
                KeyConditionExpression: "gsi1pk = :pk",
                ExpressionAttributeValues: { ":pk": `RULESET#${s}` },
              })
            );
            allItems.push(...Items);
          })
        );
        return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ruleSets: allItems }) };
      }

      case "POST": {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(event.body ?? "{}");
        } catch {
          return { statusCode: 400, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Invalid JSON in request body" }) };
        }

        if (!body.id || typeof body.id !== "string" || body.id.trim() === "") {
          return { statusCode: 400, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "id is required and must be a non-empty string" }) };
        }

        // Whitelist allowed fields
        const sanitized: Record<string, unknown> = {};
        const allowedFields = ["id", "name", "description", "version", "status", "documentTypes", "fieldRules", "crossDocRules", "metadataRules", "promptConfig"];
        for (const key of allowedFields) {
          if (key in body) {
            sanitized[key] = body[key];
          }
        }

        const now = new Date().toISOString();
        await ddb.send(
          new PutCommand({
            TableName: Resource.DocProofTable.name,
            Item: {
              pk: `RULESET#${sanitized.id}`,
              sk: "META",
              ...sanitized,
              createdAt: now,
              updatedAt: now,
              gsi1pk: `RULESET#${sanitized.status ?? "draft"}`,
              gsi1sk: sanitized.id,
            },
          })
        );
        for (const dt of (sanitized.documentTypes as Record<string, unknown>[]) ?? []) {
          await ddb.send(
            new PutCommand({
              TableName: Resource.DocProofTable.name,
              Item: { pk: `RULESET#${sanitized.id}`, sk: `DOCTYPE#${dt.typeId}`, ...dt },
            })
          );
        }
        return {
          statusCode: 201,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: sanitized.id, status: "created" }),
        };
      }

      case "PUT": {
        if (!ruleSetId)
          return { statusCode: 400, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "ID required" }) };

        let putBody: Record<string, unknown>;
        try {
          putBody = JSON.parse(event.body ?? "{}");
        } catch {
          return { statusCode: 400, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Invalid JSON in request body" }) };
        }

        // Verify ruleset exists
        const { Item: existing } = await ddb.send(
          new GetCommand({
            TableName: Resource.DocProofTable.name,
            Key: { pk: `RULESET#${ruleSetId}`, sk: "META" },
          })
        );
        if (!existing)
          return { statusCode: 404, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Not found" }) };

        // Whitelist allowed fields (same as POST, minus id)
        const putSanitized: Record<string, unknown> = {};
        const putAllowedFields = ["name", "description", "version", "status", "documentTypes", "fieldRules", "crossDocRules", "metadataRules", "promptConfig"];
        for (const key of putAllowedFields) {
          if (key in putBody) {
            putSanitized[key] = putBody[key];
          }
        }

        const putNow = new Date().toISOString();
        const newStatus = (putSanitized.status as string) ?? existing.status ?? "draft";

        // Update META record
        await ddb.send(
          new PutCommand({
            TableName: Resource.DocProofTable.name,
            Item: {
              ...existing,
              ...putSanitized,
              pk: `RULESET#${ruleSetId}`,
              sk: "META",
              updatedAt: putNow,
              gsi1pk: `RULESET#${newStatus}`,
              gsi1sk: ruleSetId,
            },
          })
        );

        // If documentTypes updated, delete old DOCTYPE records and write new ones
        if (putSanitized.documentTypes) {
          // Delete existing DOCTYPE records
          const { Items: oldDocTypes = [] } = await ddb.send(
            new QueryCommand({
              TableName: Resource.DocProofTable.name,
              KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
              ExpressionAttributeValues: {
                ":pk": `RULESET#${ruleSetId}`,
                ":prefix": "DOCTYPE#",
              },
            })
          );
          for (let i = 0; i < oldDocTypes.length; i += 25) {
            const batch = oldDocTypes.slice(i, i + 25).map((item) => ({
              DeleteRequest: { Key: { pk: item.pk, sk: item.sk } },
            }));
            await ddb.send(
              new BatchWriteCommand({
                RequestItems: { [Resource.DocProofTable.name]: batch },
              })
            );
          }

          // Write new DOCTYPE records
          for (const dt of (putSanitized.documentTypes as Record<string, unknown>[]) ?? []) {
            await ddb.send(
              new PutCommand({
                TableName: Resource.DocProofTable.name,
                Item: { pk: `RULESET#${ruleSetId}`, sk: `DOCTYPE#${dt.typeId}`, ...dt },
              })
            );
          }
        }

        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: ruleSetId, status: "updated" }),
        };
      }

      case "DELETE": {
        if (!ruleSetId)
          return { statusCode: 400, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "ID required" }) };

        // Query all items with this ruleset's pk
        const { Items: ruleSetItems = [] } = await ddb.send(
          new QueryCommand({
            TableName: Resource.DocProofTable.name,
            KeyConditionExpression: "pk = :pk",
            ExpressionAttributeValues: { ":pk": `RULESET#${ruleSetId}` },
          })
        );

        // Batch delete all items (META + DOCTYPE records)
        const deleteRequests = ruleSetItems.map((item) => ({
          DeleteRequest: { Key: { pk: item.pk, sk: item.sk } },
        }));

        // DynamoDB BatchWrite supports max 25 items per call
        for (let i = 0; i < deleteRequests.length; i += 25) {
          const batch = deleteRequests.slice(i, i + 25);
          await ddb.send(
            new BatchWriteCommand({
              RequestItems: {
                [Resource.DocProofTable.name]: batch,
              },
            })
          );
        }

        return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deleted: true }) };
      }

      default:
        return { statusCode: 405, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Method not allowed" }) };
    }
  } catch (err) {
    console.error("RuleSets error:", err);
    return { statusCode: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Internal server error" }) };
  }
};
