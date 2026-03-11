import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDdbSend, mockLambdaSend } = vi.hoisted(() => ({
  mockDdbSend: vi.fn(),
  mockLambdaSend: vi.fn(),
}));

vi.mock("sst", () => ({
  Resource: {
    DocProofTable: { name: "test-table" },
    PipelineOrchestrator: { name: "test-orchestrator" },
  },
}));

vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: vi.fn().mockImplementation(() => ({ send: mockDdbSend })),
  },
  GetCommand: vi.fn().mockImplementation((input) => ({ input, _type: "GetCommand" })),
}));

vi.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: vi.fn().mockImplementation(() => ({ send: mockLambdaSend })),
  InvokeCommand: vi.fn().mockImplementation((input) => ({ input, _type: "InvokeCommand" })),
}));

import { handler } from "../api/jobs/process";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

function makeEvent(
  jobId?: string,
  overrides: Partial<APIGatewayProxyEventV2> = {}
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "POST /jobs/{id}/process",
    rawPath: `/jobs/${jobId ?? ""}/process`,
    rawQueryString: "",
    headers: { "content-type": "application/json" },
    pathParameters: jobId ? { id: jobId } : undefined,
    requestContext: {
      accountId: "123",
      apiId: "api",
      domainName: "api.example.com",
      domainPrefix: "api",
      http: { method: "POST", path: `/jobs/${jobId}/process`, protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent: "test" },
      requestId: "req-1",
      routeKey: "POST /jobs/{id}/process",
      stage: "$default",
      time: "01/Jan/2025:00:00:00 +0000",
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
    ...overrides,
  } as APIGatewayProxyEventV2;
}

describe("Jobs Process Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLambdaSend.mockResolvedValue({});
  });

  it("should return 400 when job ID is missing", async () => {
    const event = makeEvent(undefined, { pathParameters: undefined } as any);
    const result = await handler(event, {} as any, () => {});
    const parsed = JSON.parse((result as any).body);

    expect((result as any).statusCode).toBe(400);
    expect(parsed.error).toBe("Job ID required");
  });

  it("should return 404 when job is not found", async () => {
    mockDdbSend.mockResolvedValueOnce({ Item: undefined });

    const result = await handler(makeEvent("job_abc123"), {} as any, () => {});
    const parsed = JSON.parse((result as any).body);

    expect((result as any).statusCode).toBe(404);
    expect(parsed.error).toBe("Job not found");
  });

  it("should return 400 when job is in completed state", async () => {
    mockDdbSend.mockResolvedValueOnce({
      Item: { jobId: "job_abc123", status: "completed", files: ["f1"] },
    });

    const result = await handler(makeEvent("job_abc123"), {} as any, () => {});
    const parsed = JSON.parse((result as any).body);

    expect((result as any).statusCode).toBe(400);
    expect(parsed.error).toContain('Cannot process job in "completed" state');
  });

  it("should return 400 when job is in processing state", async () => {
    mockDdbSend.mockResolvedValueOnce({
      Item: { jobId: "job_abc123", status: "processing", files: ["f1"] },
    });

    const result = await handler(makeEvent("job_abc123"), {} as any, () => {});
    const parsed = JSON.parse((result as any).body);

    expect((result as any).statusCode).toBe(400);
    expect(parsed.error).toContain("processing");
  });

  it("should return 400 when job is in failed state", async () => {
    mockDdbSend.mockResolvedValueOnce({
      Item: { jobId: "job_abc123", status: "failed", files: ["f1"] },
    });

    const result = await handler(makeEvent("job_abc123"), {} as any, () => {});
    const parsed = JSON.parse((result as any).body);

    expect((result as any).statusCode).toBe(400);
    expect(parsed.error).toContain("failed");
  });

  it("should return 400 when no files uploaded", async () => {
    mockDdbSend.mockResolvedValueOnce({
      Item: { jobId: "job_abc123", status: "created", files: [] },
    });

    const result = await handler(makeEvent("job_abc123"), {} as any, () => {});
    const parsed = JSON.parse((result as any).body);

    expect((result as any).statusCode).toBe(400);
    expect(parsed.error).toContain("No files uploaded");
  });

  it("should return 400 when files field is undefined", async () => {
    mockDdbSend.mockResolvedValueOnce({
      Item: { jobId: "job_abc123", status: "created" },
    });

    const result = await handler(makeEvent("job_abc123"), {} as any, () => {});
    const parsed = JSON.parse((result as any).body);

    expect((result as any).statusCode).toBe(400);
    expect(parsed.error).toContain("No files uploaded");
  });

  it("should invoke orchestrator and return 202 for valid created job", async () => {
    mockDdbSend.mockResolvedValueOnce({
      Item: { jobId: "job_abc123", status: "created", files: ["file1.pdf"] },
    });

    const result = await handler(makeEvent("job_abc123"), {} as any, () => {});
    const parsed = JSON.parse((result as any).body);

    expect((result as any).statusCode).toBe(202);
    expect(parsed.jobId).toBe("job_abc123");
    expect(parsed.status).toBe("processing");
    expect(parsed.message).toBe("Pipeline started");

    // Verify Lambda invoke
    expect(mockLambdaSend).toHaveBeenCalledTimes(1);
    const invokeInput = mockLambdaSend.mock.calls[0][0].input;
    expect(invokeInput.FunctionName).toBe("test-orchestrator");
    expect(invokeInput.InvocationType).toBe("Event");
    expect(JSON.parse(invokeInput.Payload)).toEqual({ jobId: "job_abc123" });
  });

  it("should invoke orchestrator for valid uploading job", async () => {
    mockDdbSend.mockResolvedValueOnce({
      Item: { jobId: "job_abc123", status: "uploading", files: ["file1.pdf"] },
    });

    const result = await handler(makeEvent("job_abc123"), {} as any, () => {});
    expect((result as any).statusCode).toBe(202);
    expect(mockLambdaSend).toHaveBeenCalledTimes(1);
  });

  it("should return 500 when DynamoDB throws", async () => {
    mockDdbSend.mockRejectedValueOnce(new Error("DDB error"));

    const result = await handler(makeEvent("job_abc123"), {} as any, () => {});
    const parsed = JSON.parse((result as any).body);

    expect((result as any).statusCode).toBe(500);
    expect(parsed.error).toBe("Internal server error");
  });

  it("should return 500 when Lambda invoke throws", async () => {
    mockDdbSend.mockResolvedValueOnce({
      Item: { jobId: "job_abc123", status: "created", files: ["file1.pdf"] },
    });
    mockLambdaSend.mockRejectedValueOnce(new Error("Lambda error"));

    const result = await handler(makeEvent("job_abc123"), {} as any, () => {});
    const parsed = JSON.parse((result as any).body);

    expect((result as any).statusCode).toBe(500);
    expect(parsed.error).toBe("Internal server error");
  });
});
