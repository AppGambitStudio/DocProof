import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("sst", () => ({
  Resource: {
    DocProofApiKey: { value: "test-api-key-12345" },
  },
}));

import { handler } from "../api/auth/api-key-authorizer";
import type { APIGatewayRequestAuthorizerEventV2 } from "aws-lambda";

function makeAuthEvent(
  headers: Record<string, string> = {}
): APIGatewayRequestAuthorizerEventV2 {
  return {
    version: "2.0",
    type: "REQUEST",
    routeArn: "arn:aws:execute-api:us-east-1:123456789:api/GET/test",
    identitySource: headers["x-api-key"] ?? "",
    routeKey: "GET /test",
    rawPath: "/test",
    rawQueryString: "",
    headers,
    requestContext: {
      accountId: "123456789",
      apiId: "api",
      domainName: "api.example.com",
      domainPrefix: "api",
      http: {
        method: "GET",
        path: "/test",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test",
      },
      requestId: "req-1",
      routeKey: "GET /test",
      stage: "$default",
      time: "01/Jan/2025:00:00:00 +0000",
      timeEpoch: 1704067200000,
    },
  };
}

describe("API Key Authorizer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should deny when x-api-key header is missing", async () => {
    const result = await handler(makeAuthEvent({}), {} as any, () => {});
    expect(result).toEqual({
      isAuthorized: false,
      context: { error: "Missing X-Api-Key header" },
    });
  });

  it("should deny when x-api-key header is empty string", async () => {
    const result = await handler(
      makeAuthEvent({ "x-api-key": "" }),
      {} as any,
      () => {}
    );
    expect(result).toEqual({
      isAuthorized: false,
      context: { error: "Missing X-Api-Key header" },
    });
  });

  it("should deny when API key is invalid", async () => {
    const result = await handler(
      makeAuthEvent({ "x-api-key": "wrong-key" }),
      {} as any,
      () => {}
    );
    expect(result).toEqual({
      isAuthorized: false,
      context: { error: "Invalid API key" },
    });
  });

  it("should authorize when API key is valid (lowercase header)", async () => {
    const result = await handler(
      makeAuthEvent({ "x-api-key": "test-api-key-12345" }),
      {} as any,
      () => {}
    );
    expect(result).toEqual({
      isAuthorized: true,
      context: { apiKeyValid: "true" },
    });
  });

  it("should authorize when API key is valid (mixed-case header)", async () => {
    const result = await handler(
      makeAuthEvent({ "X-Api-Key": "test-api-key-12345" }),
      {} as any,
      () => {}
    );
    expect(result).toEqual({
      isAuthorized: true,
      context: { apiKeyValid: "true" },
    });
  });

  it("should deny when key has different length (timing-safe)", async () => {
    const result = await handler(
      makeAuthEvent({ "x-api-key": "short" }),
      {} as any,
      () => {}
    );
    expect(result).toEqual({
      isAuthorized: false,
      context: { error: "Invalid API key" },
    });
  });
});
