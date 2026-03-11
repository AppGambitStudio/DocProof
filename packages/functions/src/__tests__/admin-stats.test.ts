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
  QueryCommand: vi.fn().mockImplementation((input) => ({ input, _type: "QueryCommand" })),
}));

import { handler } from "../api/admin/stats";

describe("Admin Stats Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return aggregated stats", async () => {
    // 10 status queries + 1 ruleset count query = 11 calls
    // Order: created, uploading, processing, extracting, validating, completed, failed, review_required, approved, rejected
    mockDdbSend
      .mockResolvedValueOnce({ Count: 5, Items: [] }) // created (COUNT only)
      .mockResolvedValueOnce({ Count: 2, Items: [] }) // uploading
      .mockResolvedValueOnce({ Count: 1, Items: [] }) // processing
      .mockResolvedValueOnce({ Count: 3, Items: [] }) // extracting
      .mockResolvedValueOnce({ Count: 1, Items: [] }) // validating
      .mockResolvedValueOnce({
        // completed (fetches items)
        Count: 2,
        Items: [
          { jobId: "j1", ruleSetId: "r1", costUsd: 0.01, files: ["f1"], completedAt: "2025-01-01T00:00:00Z" },
          { jobId: "j2", ruleSetId: "r1", costUsd: 0.02, files: ["f1", "f2"], completedAt: "2025-01-02T00:00:00Z" },
        ],
      })
      .mockResolvedValueOnce({
        // failed (fetches items)
        Count: 1,
        Items: [{ jobId: "j3", costUsd: 0.005, files: [] }],
      })
      .mockResolvedValueOnce({
        // review_required (fetches items)
        Count: 1,
        Items: [{ jobId: "j4", costUsd: 0.003, files: [] }],
      })
      .mockResolvedValueOnce({
        // approved (fetches items)
        Count: 0,
        Items: [],
      })
      .mockResolvedValueOnce({
        // rejected (fetches items)
        Count: 0,
        Items: [],
      })
      .mockResolvedValueOnce({ Count: 3 }); // active rulesets

    const result = await handler({} as any, {} as any, () => {});
    const parsed = JSON.parse((result as any).body);

    expect((result as any).statusCode).toBe(200);

    // Job counts
    expect(parsed.jobs.total).toBe(16); // 5+2+1+3+1+2+1+1+0+0
    expect(parsed.jobs.processing).toBe(4); // extracting(3) + validating(1)
    expect(parsed.jobs.completed).toBe(2);
    expect(parsed.jobs.failed).toBe(1);
    expect(parsed.jobs.reviewRequired).toBe(1);
    expect(parsed.jobs.byStatus.created).toBe(5);

    // Cost
    expect(parsed.cost.totalUsd).toBeCloseTo(0.038, 6); // 0.01+0.02+0.005+0.003

    // Rulesets
    expect(parsed.ruleSets.active).toBe(3);

    // Recent completed
    expect(parsed.recentCompleted).toHaveLength(2);
    expect(parsed.recentCompleted[0].jobId).toBe("j1");
    expect(parsed.recentCompleted[1].fileCount).toBe(2);
  });

  it("should handle empty database", async () => {
    // 10 status queries all empty + 1 ruleset count
    for (let i = 0; i < 10; i++) {
      mockDdbSend.mockResolvedValueOnce({ Count: 0, Items: [] });
    }
    mockDdbSend.mockResolvedValueOnce({ Count: 0 }); // rulesets

    const result = await handler({} as any, {} as any, () => {});
    const parsed = JSON.parse((result as any).body);

    expect((result as any).statusCode).toBe(200);
    expect(parsed.jobs.total).toBe(0);
    expect(parsed.jobs.processing).toBe(0);
    expect(parsed.cost.totalUsd).toBe(0);
    expect(parsed.recentCompleted).toHaveLength(0);
    expect(parsed.ruleSets.active).toBe(0);
  });

  it("should handle items with missing costUsd", async () => {
    for (let i = 0; i < 5; i++) {
      mockDdbSend.mockResolvedValueOnce({ Count: 0, Items: [] });
    }
    mockDdbSend.mockResolvedValueOnce({
      Count: 1,
      Items: [{ jobId: "j1", ruleSetId: "r1", files: [], completedAt: "2025-01-01" }], // no costUsd
    });
    mockDdbSend.mockResolvedValueOnce({ Count: 0, Items: [] }); // failed
    mockDdbSend.mockResolvedValueOnce({ Count: 0, Items: [] }); // review_required
    mockDdbSend.mockResolvedValueOnce({ Count: 0, Items: [] }); // approved
    mockDdbSend.mockResolvedValueOnce({ Count: 0, Items: [] }); // rejected
    mockDdbSend.mockResolvedValueOnce({ Count: 0 }); // rulesets

    const result = await handler({} as any, {} as any, () => {});
    const parsed = JSON.parse((result as any).body);

    expect(parsed.cost.totalUsd).toBe(0);
    expect(parsed.recentCompleted[0].costUsd).toBe(0);
  });

  it("should return 500 on DynamoDB error", async () => {
    mockDdbSend.mockRejectedValueOnce(new Error("DDB error"));

    const result = await handler({} as any, {} as any, () => {});
    const parsed = JSON.parse((result as any).body);

    expect((result as any).statusCode).toBe(500);
    expect(parsed.error).toBe("Internal server error");
  });
});
