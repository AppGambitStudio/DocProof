import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock AWS SDK clients — vi.hoisted runs before vi.mock hoisting
const { mockDdbSend, mockS3Send, mockGetSignedUrl } = vi.hoisted(() => ({
  mockDdbSend: vi.fn(),
  mockS3Send: vi.fn(),
  mockGetSignedUrl: vi.fn(),
}));

vi.mock("sst", () => ({
  Resource: {
    DocProofTable: { name: "test-table" },
    DocProofBucket: { name: "test-bucket" },
  },
}));

vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: vi.fn().mockImplementation(() => ({ send: mockDdbSend })),
  },
  PutCommand: vi.fn().mockImplementation((input) => ({ input, _type: "PutCommand" })),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: mockS3Send })),
  PutObjectCommand: vi.fn().mockImplementation((input) => ({ input, _type: "PutObjectCommand" })),
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
}));

import { handler } from "../api/jobs/create";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

function makeEvent(overrides: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "POST /jobs",
    rawPath: "/jobs",
    rawQueryString: "",
    headers: { "content-type": "application/json" },
    requestContext: {
      accountId: "123",
      apiId: "api",
      domainName: "api.example.com",
      domainPrefix: "api",
      http: { method: "POST", path: "/jobs", protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent: "test" },
      requestId: "req-1",
      routeKey: "POST /jobs",
      stage: "$default",
      time: "01/Jan/2025:00:00:00 +0000",
      timeEpoch: 1704067200000,
    },
    body: JSON.stringify({ ruleSetId: "kyc-india" }),
    isBase64Encoded: false,
    ...overrides,
  } as APIGatewayProxyEventV2;
}

describe("Jobs Create Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDdbSend.mockResolvedValue({});
    mockGetSignedUrl.mockResolvedValue("https://s3.example.com/presigned");
  });

  it("should return 400 for invalid JSON body", async () => {
    const result = await handler(makeEvent({ body: "not-json{" }), {} as any, () => {});
    const parsed = JSON.parse((result as any).body);
    expect((result as any).statusCode).toBe(400);
    expect(parsed.error).toBe("Invalid JSON in request body");
  });

  it("should return 400 when ruleSetId is missing", async () => {
    const result = await handler(makeEvent({ body: JSON.stringify({}) }), {} as any, () => {});
    const parsed = JSON.parse((result as any).body);
    expect((result as any).statusCode).toBe(400);
    expect(parsed.error).toBe("ruleSetId is required");
  });

  it("should create job successfully with minimal input", async () => {
    const result = await handler(makeEvent(), {} as any, () => {});
    const parsed = JSON.parse((result as any).body);

    expect((result as any).statusCode).toBe(201);
    expect(parsed.jobId).toMatch(/^job_[a-f0-9]{12}$/);
    expect(parsed.status).toBe("created");
    expect(parsed.uploadUrls).toBeUndefined();
    // Should call DynamoDB once for META record
    expect(mockDdbSend).toHaveBeenCalledTimes(1);
  });

  it("should create external ref lookup record when externalRef provided", async () => {
    const event = makeEvent({
      body: JSON.stringify({ ruleSetId: "kyc-india", externalRef: "EXT-123" }),
    });
    const result = await handler(event, {} as any, () => {});
    const parsed = JSON.parse((result as any).body);

    expect((result as any).statusCode).toBe(201);
    expect(parsed.jobId).toBeDefined();
    // Two DynamoDB puts: META + EXTERNAL lookup
    expect(mockDdbSend).toHaveBeenCalledTimes(2);
  });

  it("should generate presigned upload URLs when documentTypes provided", async () => {
    const event = makeEvent({
      body: JSON.stringify({
        ruleSetId: "kyc-india",
        documentTypes: ["pan_card", "aadhaar"],
      }),
    });
    const result = await handler(event, {} as any, () => {});
    const parsed = JSON.parse((result as any).body);

    expect((result as any).statusCode).toBe(201);
    expect(parsed.uploadUrls).toBeDefined();
    expect(parsed.uploadUrls.pan_card).toBe("https://s3.example.com/presigned");
    expect(parsed.uploadUrls.aadhaar).toBe("https://s3.example.com/presigned");
    expect(mockGetSignedUrl).toHaveBeenCalledTimes(2);
  });

  it("should return 500 when DynamoDB throws", async () => {
    mockDdbSend.mockRejectedValueOnce(new Error("DDB error"));
    const result = await handler(makeEvent(), {} as any, () => {});
    const parsed = JSON.parse((result as any).body);

    expect((result as any).statusCode).toBe(500);
    expect(parsed.error).toBe("Internal server error");
  });

  it("should handle empty body gracefully", async () => {
    const result = await handler(makeEvent({ body: undefined }), {} as any, () => {});
    const parsed = JSON.parse((result as any).body);
    // empty body parses to {} which has no ruleSetId
    expect((result as any).statusCode).toBe(400);
    expect(parsed.error).toBe("ruleSetId is required");
  });

  it("should pass metadata and callbackUrl through to DynamoDB", async () => {
    const event = makeEvent({
      body: JSON.stringify({
        ruleSetId: "kyc-india",
        metadata: { customerId: "cust-1" },
        callbackUrl: "https://webhook.example.com/callback",
      }),
    });
    await handler(event, {} as any, () => {});

    const putCall = mockDdbSend.mock.calls[0][0];
    expect(putCall.input.Item.metadata).toEqual({ customerId: "cust-1" });
    expect(putCall.input.Item.callbackUrl).toBe("https://webhook.example.com/callback");
    expect(putCall.input.Item.status).toBe("created");
    expect(putCall.input.Item.gsi1pk).toBe("STATUS#created");
  });
});
