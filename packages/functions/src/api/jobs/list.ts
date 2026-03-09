import { Resource } from "sst";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const status = event.queryStringParameters?.status;
  const limit = Math.min(parseInt(event.queryStringParameters?.limit ?? "20"), 100);

  try {
    if (status) {
      // Query by status using GSI
      const { Items = [] } = await ddb.send(
        new QueryCommand({
          TableName: Resource.DocProofTable.name,
          IndexName: "gsi1",
          KeyConditionExpression: "gsi1pk = :pk",
          ExpressionAttributeValues: { ":pk": `STATUS#${status}` },
          ScanIndexForward: false,
          Limit: limit,
        })
      );
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobs: Items, count: Items.length }),
      };
    }

    // Default: return recent jobs (would need a GSI or scan — simplified here)
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobs: [], count: 0, message: "Provide ?status= filter" }),
    };
  } catch (err) {
    console.error("Error listing jobs:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Internal server error" }) };
  }
};
