import { Resource } from "sst";
import type {
  APIGatewayRequestAuthorizerEventV2,
  APIGatewaySimpleAuthorizerWithContextResult,
} from "aws-lambda";
import { timingSafeEqual } from "crypto";

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
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
    const expectedKey = Resource.DocProofApiKey.value;

    if (!safeCompare(apiKey, expectedKey)) {
      return {
        isAuthorized: false,
        context: { error: "Invalid API key" },
      };
    }

    return {
      isAuthorized: true,
      context: { apiKeyValid: "true" },
    };
  } catch (err) {
    console.error("API key authorization error:", err);
    return {
      isAuthorized: false,
      context: { error: "Authorization error" },
    };
  }
};
