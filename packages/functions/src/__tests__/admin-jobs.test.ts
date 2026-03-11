import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDdbSend } = vi.hoisted(() => ({ mockDdbSend: vi.fn() }));

vi.mock("sst", () => ({
  Resource: {
    DocProofTable: { name: "test-table" },
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
  QueryCommand: vi.fn().mockImplementation((input) => ({ input, _type: "QueryCommand" })),
}));

import { handler } from "../api/admin/jobs";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

function makeEvent(
  jobId?: string,
  queryParams?: Record<string, string>
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "GET /admin/jobs",
    rawPath: jobId ? `/admin/jobs/${jobId}` : "/admin/jobs",
    rawQueryString: "",
    headers: {},
    pathParameters: jobId ? { id: jobId } : undefined,
    queryStringParameters: queryParams ?? undefined,
    requestContext: {
      accountId: "123",
      apiId: "api",
      domainName: "api.example.com",
      domainPrefix: "api",
      http: {
        method: "GET",
        path: jobId ? `/admin/jobs/${jobId}` : "/admin/jobs",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test",
      },
      requestId: "req-1",
      routeKey: "GET /admin/jobs",
      stage: "$default",
      time: "01/Jan/2025:00:00:00 +0000",
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

describe("Admin Jobs Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- GET detail ---
  describe("GET /admin/jobs/:id (detail)", () => {
    it("should return job detail for a created job", async () => {
      mockDdbSend.mockResolvedValueOnce({
        Item: {
          pk: "JOB#job_abc123",
          sk: "META",
          jobId: "job_abc123",
          status: "created",
          ruleSetId: "kyc-india",
          ruleSetVersion: 1,
          externalRef: "EXT-1",
          metadata: { key: "val" },
          files: [],
          costUsd: 0,
          createdAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-01-01T00:00:00Z",
        },
      });

      const result = await handler(makeEvent("job_abc123"), {} as any, () => {});
      const parsed = JSON.parse((result as any).body);

      expect((result as any).statusCode).toBe(200);
      expect(parsed.jobId).toBe("job_abc123");
      expect(parsed.status).toBe("created");
      expect(parsed.result).toBeNull();
      expect(parsed.timestamps.created).toBe("2025-01-01T00:00:00Z");
    });

    it("should include result for completed job", async () => {
      mockDdbSend
        .mockResolvedValueOnce({
          Item: {
            jobId: "job_abc123",
            status: "completed",
            ruleSetId: "kyc-india",
            files: ["file1"],
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T01:00:00Z",
            completedAt: "2025-01-01T01:00:00Z",
          },
        })
        .mockResolvedValueOnce({
          Item: {
            result: { documents: [], anomalies: [], overallStatus: "pass" },
          },
        });

      const result = await handler(makeEvent("job_abc123"), {} as any, () => {});
      const parsed = JSON.parse((result as any).body);

      expect((result as any).statusCode).toBe(200);
      expect(parsed.result).toEqual({
        documents: [],
        anomalies: [],
        overallStatus: "pass",
      });
    });

    it("should include result for review_required job", async () => {
      mockDdbSend
        .mockResolvedValueOnce({
          Item: { jobId: "job_abc123", status: "review_required", ruleSetId: "r1", files: [] },
        })
        .mockResolvedValueOnce({
          Item: { result: { anomalies: [{ field: "name", issue: "mismatch" }] } },
        });

      const result = await handler(makeEvent("job_abc123"), {} as any, () => {});
      const parsed = JSON.parse((result as any).body);

      expect((result as any).statusCode).toBe(200);
      expect(parsed.result.anomalies).toHaveLength(1);
    });

    it("should include result for failed job", async () => {
      mockDdbSend
        .mockResolvedValueOnce({
          Item: { jobId: "job_abc123", status: "failed", ruleSetId: "r1", files: [] },
        })
        .mockResolvedValueOnce({
          Item: { result: { error: "extraction failed" } },
        });

      const result = await handler(makeEvent("job_abc123"), {} as any, () => {});
      const parsed = JSON.parse((result as any).body);

      expect((result as any).statusCode).toBe(200);
      expect(parsed.result.error).toBe("extraction failed");
    });

    it("should handle missing result record gracefully", async () => {
      mockDdbSend
        .mockResolvedValueOnce({
          Item: { jobId: "job_abc123", status: "completed", ruleSetId: "r1", files: [] },
        })
        .mockResolvedValueOnce({ Item: undefined });

      const result = await handler(makeEvent("job_abc123"), {} as any, () => {});
      const parsed = JSON.parse((result as any).body);

      expect((result as any).statusCode).toBe(200);
      expect(parsed.result).toBeNull();
    });

    it("should return 404 for non-existent job", async () => {
      mockDdbSend.mockResolvedValueOnce({ Item: undefined });

      const result = await handler(makeEvent("job_nonexistent"), {} as any, () => {});
      const parsed = JSON.parse((result as any).body);

      expect((result as any).statusCode).toBe(404);
      expect(parsed.error).toBe("Job not found");
    });
  });

  // --- GET list ---
  describe("GET /admin/jobs (list)", () => {
    it("should list jobs filtered by status", async () => {
      mockDdbSend.mockResolvedValueOnce({
        Items: [
          {
            jobId: "job_1",
            status: "completed",
            ruleSetId: "r1",
            files: ["f1", "f2"],
            costUsd: 0.01,
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T01:00:00Z",
            completedAt: "2025-01-01T01:00:00Z",
          },
        ],
        LastEvaluatedKey: undefined,
      });

      const result = await handler(
        makeEvent(undefined, { status: "completed" }),
        {} as any,
        () => {}
      );
      const parsed = JSON.parse((result as any).body);

      expect((result as any).statusCode).toBe(200);
      expect(parsed.jobs).toHaveLength(1);
      expect(parsed.jobs[0].jobId).toBe("job_1");
      expect(parsed.jobs[0].fileCount).toBe(2);
      expect(parsed.count).toBe(1);
      expect(parsed.nextCursor).toBeUndefined();
    });

    it("should return nextCursor when more results available", async () => {
      mockDdbSend.mockResolvedValueOnce({
        Items: [{ jobId: "job_1", status: "completed", ruleSetId: "r1", files: [] }],
        LastEvaluatedKey: { pk: "JOB#job_1", sk: "META", gsi1pk: "STATUS#completed", gsi1sk: "2025-01-01" },
      });

      const result = await handler(
        makeEvent(undefined, { status: "completed", limit: "1" }),
        {} as any,
        () => {}
      );
      const parsed = JSON.parse((result as any).body);

      expect(parsed.nextCursor).toBeDefined();
      expect(typeof parsed.nextCursor).toBe("string");
    });

    it("should list all jobs without status filter", async () => {
      // 10 parallel queries for all statuses (including approved/rejected)
      for (let i = 0; i < 10; i++) {
        mockDdbSend.mockResolvedValueOnce({
          Items:
            i === 0
              ? [
                  {
                    jobId: "job_1",
                    status: "created",
                    ruleSetId: "r1",
                    files: [],
                    updatedAt: "2025-01-01T00:00:00Z",
                  },
                ]
              : [],
        });
      }

      const result = await handler(makeEvent(), {} as any, () => {});
      const parsed = JSON.parse((result as any).body);

      expect((result as any).statusCode).toBe(200);
      expect(parsed.jobs).toHaveLength(1);
      expect(parsed.count).toBe(1);
    });

    it("should cap limit at 100", async () => {
      mockDdbSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

      await handler(
        makeEvent(undefined, { status: "completed", limit: "999" }),
        {} as any,
        () => {}
      );

      const queryInput = mockDdbSend.mock.calls[0][0].input;
      expect(queryInput.Limit).toBe(100);
    });

    it("should default limit to 50", async () => {
      mockDdbSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

      await handler(
        makeEvent(undefined, { status: "completed" }),
        {} as any,
        () => {}
      );

      const queryInput = mockDdbSend.mock.calls[0][0].input;
      expect(queryInput.Limit).toBe(50);
    });
  });

  // --- Error handling ---
  it("should return 500 on unexpected error", async () => {
    mockDdbSend.mockRejectedValueOnce(new Error("DDB error"));

    const result = await handler(makeEvent("job_abc123"), {} as any, () => {});
    const parsed = JSON.parse((result as any).body);

    expect((result as any).statusCode).toBe(500);
    expect(parsed.error).toBe("Internal server error");
  });
});
