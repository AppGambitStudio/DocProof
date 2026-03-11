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
  PutCommand: vi.fn().mockImplementation((input) => ({ input, _type: "PutCommand" })),
  GetCommand: vi.fn().mockImplementation((input) => ({ input, _type: "GetCommand" })),
  QueryCommand: vi.fn().mockImplementation((input) => ({ input, _type: "QueryCommand" })),
  DeleteCommand: vi.fn().mockImplementation((input) => ({ input, _type: "DeleteCommand" })),
  BatchWriteCommand: vi.fn().mockImplementation((input) => ({ input, _type: "BatchWriteCommand" })),
}));

import { handler } from "../api/admin/rulesets";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

function makeEvent(
  method: string,
  ruleSetId?: string,
  body?: unknown
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: `${method} /admin/rulesets`,
    rawPath: ruleSetId ? `/admin/rulesets/${ruleSetId}` : "/admin/rulesets",
    rawQueryString: "",
    headers: { "content-type": "application/json" },
    pathParameters: ruleSetId ? { id: ruleSetId } : undefined,
    requestContext: {
      accountId: "123",
      apiId: "api",
      domainName: "api.example.com",
      domainPrefix: "api",
      http: {
        method,
        path: ruleSetId ? `/admin/rulesets/${ruleSetId}` : "/admin/rulesets",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test",
      },
      requestId: "req-1",
      routeKey: `${method} /admin/rulesets`,
      stage: "$default",
      time: "01/Jan/2025:00:00:00 +0000",
      timeEpoch: 1704067200000,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

describe("Admin Rulesets Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDdbSend.mockResolvedValue({});
  });

  // --- GET (list) ---
  describe("GET /admin/rulesets (list)", () => {
    it("should list all rulesets across statuses", async () => {
      // Three parallel queries for draft, active, archived
      mockDdbSend
        .mockResolvedValueOnce({ Items: [{ id: "rs-1", status: "draft" }] })
        .mockResolvedValueOnce({ Items: [{ id: "rs-2", status: "active" }] })
        .mockResolvedValueOnce({ Items: [] });

      const result = await handler(makeEvent("GET"), {} as any, () => {});
      const parsed = JSON.parse((result as any).body);

      expect((result as any).statusCode).toBe(200);
      expect(parsed.ruleSets).toHaveLength(2);
    });
  });

  // --- GET (detail) ---
  describe("GET /admin/rulesets/:id (detail)", () => {
    it("should return ruleset by ID", async () => {
      mockDdbSend.mockResolvedValueOnce({
        Item: { id: "kyc-india", name: "KYC India", status: "active" },
      });

      const result = await handler(makeEvent("GET", "kyc-india"), {} as any, () => {});
      const parsed = JSON.parse((result as any).body);

      expect((result as any).statusCode).toBe(200);
      expect(parsed.id).toBe("kyc-india");
    });

    it("should return 404 for non-existent ruleset", async () => {
      mockDdbSend.mockResolvedValueOnce({ Item: undefined });

      const result = await handler(makeEvent("GET", "nonexistent"), {} as any, () => {});
      const parsed = JSON.parse((result as any).body);

      expect((result as any).statusCode).toBe(404);
      expect(parsed.error).toBe("Not found");
    });
  });

  // --- POST ---
  describe("POST /admin/rulesets", () => {
    it("should create a ruleset successfully", async () => {
      const body = {
        id: "kyc-india",
        name: "KYC India",
        description: "Indian KYC ruleset",
        status: "draft",
        documentTypes: [{ typeId: "pan_card", name: "PAN Card" }],
      };

      const result = await handler(makeEvent("POST", undefined, body), {} as any, () => {});
      const parsed = JSON.parse((result as any).body);

      expect((result as any).statusCode).toBe(201);
      expect(parsed.id).toBe("kyc-india");
      expect(parsed.status).toBe("created");
      // 1 PutCommand for META + 1 for DOCTYPE
      expect(mockDdbSend).toHaveBeenCalledTimes(2);
    });

    it("should return 400 for invalid JSON body", async () => {
      const event = makeEvent("POST");
      event.body = "not-json{";

      const result = await handler(event, {} as any, () => {});
      const parsed = JSON.parse((result as any).body);

      expect((result as any).statusCode).toBe(400);
      expect(parsed.error).toBe("Invalid JSON in request body");
    });

    it("should return 400 when id is missing", async () => {
      const result = await handler(
        makeEvent("POST", undefined, { name: "Test" }),
        {} as any,
        () => {}
      );
      const parsed = JSON.parse((result as any).body);

      expect((result as any).statusCode).toBe(400);
      expect(parsed.error).toContain("id is required");
    });

    it("should return 400 when id is empty string", async () => {
      const result = await handler(
        makeEvent("POST", undefined, { id: "  " }),
        {} as any,
        () => {}
      );
      const parsed = JSON.parse((result as any).body);

      expect((result as any).statusCode).toBe(400);
      expect(parsed.error).toContain("id is required");
    });

    it("should sanitize input and ignore unknown fields", async () => {
      const body = {
        id: "test-rs",
        name: "Test",
        maliciousField: "should be stripped",
        __proto__: { admin: true },
      };

      await handler(makeEvent("POST", undefined, body), {} as any, () => {});

      const putCall = mockDdbSend.mock.calls[0][0];
      expect(putCall.input.Item.maliciousField).toBeUndefined();
      expect(putCall.input.Item.id).toBe("test-rs");
    });

    it("should default status to draft in GSI key", async () => {
      const body = { id: "test-rs", name: "Test" };

      await handler(makeEvent("POST", undefined, body), {} as any, () => {});

      const putCall = mockDdbSend.mock.calls[0][0];
      expect(putCall.input.Item.gsi1pk).toBe("RULESET#draft");
    });
  });

  // --- PUT ---
  describe("PUT /admin/rulesets/:id", () => {
    it("should return 400 when ID is missing", async () => {
      const result = await handler(
        makeEvent("PUT", undefined, { name: "Updated" }),
        {} as any,
        () => {}
      );
      const parsed = JSON.parse((result as any).body);

      expect((result as any).statusCode).toBe(400);
      expect(parsed.error).toBe("ID required");
    });

    it("should return 404 for non-existent ruleset", async () => {
      mockDdbSend.mockResolvedValueOnce({ Item: undefined });

      const result = await handler(
        makeEvent("PUT", "nonexistent", { name: "Updated" }),
        {} as any,
        () => {}
      );
      const parsed = JSON.parse((result as any).body);

      expect((result as any).statusCode).toBe(404);
      expect(parsed.error).toBe("Not found");
    });

    it("should return 400 for invalid JSON body", async () => {
      const event = makeEvent("PUT", "kyc-india");
      event.body = "bad-json{";

      const result = await handler(event, {} as any, () => {});
      const parsed = JSON.parse((result as any).body);

      expect((result as any).statusCode).toBe(400);
      expect(parsed.error).toBe("Invalid JSON in request body");
    });

    it("should update ruleset successfully", async () => {
      mockDdbSend.mockResolvedValueOnce({
        Item: { pk: "RULESET#kyc-india", sk: "META", id: "kyc-india", status: "draft" },
      });

      const result = await handler(
        makeEvent("PUT", "kyc-india", { name: "Updated KYC", status: "active" }),
        {} as any,
        () => {}
      );
      const parsed = JSON.parse((result as any).body);

      expect((result as any).statusCode).toBe(200);
      expect(parsed.id).toBe("kyc-india");
      expect(parsed.status).toBe("updated");
    });

    it("should update documentTypes by deleting old and writing new", async () => {
      // GetCommand for existing
      mockDdbSend.mockResolvedValueOnce({
        Item: { pk: "RULESET#kyc-india", sk: "META", id: "kyc-india", status: "active" },
      });
      // PutCommand for META update
      mockDdbSend.mockResolvedValueOnce({});
      // QueryCommand for old DOCTYPE records
      mockDdbSend.mockResolvedValueOnce({
        Items: [{ pk: "RULESET#kyc-india", sk: "DOCTYPE#old_type" }],
      });
      // BatchWriteCommand to delete old
      mockDdbSend.mockResolvedValueOnce({});
      // PutCommand for new DOCTYPE
      mockDdbSend.mockResolvedValueOnce({});

      const result = await handler(
        makeEvent("PUT", "kyc-india", {
          documentTypes: [{ typeId: "new_type", name: "New Type" }],
        }),
        {} as any,
        () => {}
      );

      expect((result as any).statusCode).toBe(200);
      expect(mockDdbSend).toHaveBeenCalledTimes(5);
    });
  });

  // --- DELETE ---
  describe("DELETE /admin/rulesets/:id", () => {
    it("should return 400 when ID is missing", async () => {
      const result = await handler(makeEvent("DELETE"), {} as any, () => {});
      const parsed = JSON.parse((result as any).body);

      expect((result as any).statusCode).toBe(400);
      expect(parsed.error).toBe("ID required");
    });

    it("should delete ruleset and all associated records", async () => {
      mockDdbSend.mockResolvedValueOnce({
        Items: [
          { pk: "RULESET#kyc-india", sk: "META" },
          { pk: "RULESET#kyc-india", sk: "DOCTYPE#pan_card" },
        ],
      });
      mockDdbSend.mockResolvedValueOnce({}); // BatchWrite

      const result = await handler(makeEvent("DELETE", "kyc-india"), {} as any, () => {});
      const parsed = JSON.parse((result as any).body);

      expect((result as any).statusCode).toBe(200);
      expect(parsed.deleted).toBe(true);
    });

    it("should handle delete when no items found (no-op)", async () => {
      mockDdbSend.mockResolvedValueOnce({ Items: [] });

      const result = await handler(makeEvent("DELETE", "nonexistent"), {} as any, () => {});
      const parsed = JSON.parse((result as any).body);

      expect((result as any).statusCode).toBe(200);
      expect(parsed.deleted).toBe(true);
    });
  });

  // --- Unsupported method ---
  it("should return 405 for unsupported methods", async () => {
    const result = await handler(makeEvent("PATCH", "kyc-india"), {} as any, () => {});
    const parsed = JSON.parse((result as any).body);

    expect((result as any).statusCode).toBe(405);
    expect(parsed.error).toBe("Method not allowed");
  });

  // --- Error handling ---
  it("should return 500 on unexpected error", async () => {
    mockDdbSend.mockRejectedValueOnce(new Error("DDB error"));

    const result = await handler(makeEvent("GET", "test"), {} as any, () => {});
    const parsed = JSON.parse((result as any).body);

    expect((result as any).statusCode).toBe(500);
    expect(parsed.error).toBe("Internal server error");
  });
});
