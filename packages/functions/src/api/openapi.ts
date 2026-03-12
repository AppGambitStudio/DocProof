import type { APIGatewayProxyHandlerV2 } from "aws-lambda";

const spec = {
  openapi: "3.0.3",
  info: {
    title: "DocProof Job API",
    description:
      "AI-powered document validation engine. Submit documents for extraction and rule-based validation.",
    version: "1.0.0",
    license: {
      name: "MIT",
      url: "https://github.com/AppGambitStudio/docproof/blob/main/LICENSE",
    },
  },
  servers: [{ url: "/", description: "Current environment" }],
  security: [{ ApiKeyAuth: [] }],
  paths: {
    "/jobs": {
      post: {
        summary: "Create a validation job",
        operationId: "createJob",
        tags: ["Jobs"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateJobRequest" },
            },
          },
        },
        responses: {
          "201": {
            description: "Job created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateJobResponse" },
              },
            },
          },
          "400": { description: "Validation error" },
          "401": { description: "Invalid API key" },
        },
      },
      get: {
        summary: "List jobs",
        operationId: "listJobs",
        tags: ["Jobs"],
        parameters: [
          {
            name: "status",
            in: "query",
            schema: {
              type: "string",
              enum: [
                "created",
                "uploading",
                "processing",
                "extracting",
                "validating",
                "completed",
                "failed",
                "review_required",
              ],
            },
            description: "Filter by status",
          },
          {
            name: "cursor",
            in: "query",
            schema: { type: "string" },
            description: "Pagination cursor",
          },
        ],
        responses: {
          "200": {
            description: "Job list",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/JobListResponse" },
              },
            },
          },
        },
      },
    },
    "/jobs/{id}": {
      get: {
        summary: "Get job details and results",
        operationId: "getJob",
        tags: ["Jobs"],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "Job ID",
          },
        ],
        responses: {
          "200": {
            description: "Job detail",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/JobDetail" },
              },
            },
          },
          "404": { description: "Job not found" },
        },
      },
    },
    "/jobs/{id}/files": {
      post: {
        summary: "Upload a file to a job",
        operationId: "uploadFile",
        tags: ["Jobs"],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/UploadFileRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Presigned upload URL",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/UploadFileResponse" },
              },
            },
          },
          "400": { description: "Validation error" },
          "404": { description: "Job not found" },
        },
      },
    },
    "/jobs/{id}/process": {
      post: {
        summary: "Start job processing",
        operationId: "processJob",
        tags: ["Jobs"],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "202": {
            description: "Processing started",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    jobId: { type: "string" },
                    status: { type: "string" },
                  },
                },
              },
            },
          },
          "400": { description: "Job not in valid state for processing" },
          "404": { description: "Job not found" },
        },
      },
    },
    "/openapi.json": {
      get: {
        summary: "OpenAPI specification",
        operationId: "getSpec",
        tags: ["Meta"],
        security: [],
        responses: {
          "200": { description: "OpenAPI 3.0.3 spec" },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "X-Api-Key",
        description: "API key for job operations",
      },
    },
    schemas: {
      CreateJobRequest: {
        type: "object",
        required: ["ruleSetId"],
        properties: {
          ruleSetId: {
            type: "string",
            description: "ID of the ruleset to validate against",
          },
          externalRef: {
            type: "string",
            description: "Your external reference (e.g., application ID)",
          },
          metadata: {
            type: "object",
            additionalProperties: true,
            description: "Key-value metadata (e.g., applicantName)",
          },
          callbackUrl: {
            type: "string",
            format: "uri",
            description:
              "Webhook URL for completion notification (HTTPS only)",
          },
          documentTypes: {
            type: "array",
            items: { type: "string" },
            description:
              "Document types to upload. Each gets a presigned URL in the response.",
          },
        },
      },
      CreateJobResponse: {
        type: "object",
        properties: {
          jobId: { type: "string" },
          status: { type: "string", example: "created" },
          files: {
            type: "array",
            items: {
              type: "object",
              properties: {
                fileId: { type: "string" },
                documentType: { type: "string" },
                uploadUrl: { type: "string", format: "uri" },
              },
            },
          },
        },
      },
      UploadFileRequest: {
        type: "object",
        required: ["documentType", "fileName"],
        properties: {
          documentType: {
            type: "string",
            description: "Document type ID (must match ruleset)",
          },
          fileName: {
            type: "string",
            description: "Original file name",
          },
        },
      },
      UploadFileResponse: {
        type: "object",
        properties: {
          fileId: { type: "string" },
          uploadUrl: {
            type: "string",
            format: "uri",
            description: "PUT this URL with the file content",
          },
        },
      },
      JobListResponse: {
        type: "object",
        properties: {
          jobs: {
            type: "array",
            items: { $ref: "#/components/schemas/JobSummary" },
          },
          cursor: { type: "string", nullable: true },
        },
      },
      JobSummary: {
        type: "object",
        properties: {
          jobId: { type: "string" },
          ruleSetId: { type: "string" },
          status: { type: "string" },
          externalRef: { type: "string" },
          fileCount: { type: "integer" },
          costUsd: { type: "number" },
          createdAt: { type: "string", format: "date-time" },
          completedAt: { type: "string", format: "date-time", nullable: true },
        },
      },
      JobDetail: {
        type: "object",
        properties: {
          jobId: { type: "string" },
          ruleSetId: { type: "string" },
          status: {
            type: "string",
            enum: [
              "created",
              "uploading",
              "processing",
              "extracting",
              "validating",
              "completed",
              "failed",
              "review_required",
              "approved",
              "rejected",
            ],
          },
          externalRef: { type: "string" },
          metadata: { type: "object", additionalProperties: true },
          files: {
            type: "array",
            items: {
              type: "object",
              properties: {
                fileId: { type: "string" },
                fileName: { type: "string" },
                documentType: { type: "string" },
                mimeType: { type: "string" },
                size: { type: "integer" },
              },
            },
          },
          result: { $ref: "#/components/schemas/JobResult" },
          costUsd: { type: "number" },
          createdAt: { type: "string", format: "date-time" },
          completedAt: { type: "string", format: "date-time", nullable: true },
        },
      },
      JobResult: {
        type: "object",
        properties: {
          overallStatus: {
            type: "string",
            enum: ["pass", "fail", "review_required"],
          },
          summary: {
            type: "object",
            properties: {
              totalDocuments: { type: "integer" },
              valid: { type: "integer" },
              invalid: { type: "integer" },
              anomalies: { type: "integer" },
            },
          },
          documents: {
            type: "array",
            items: {
              type: "object",
              properties: {
                fileId: { type: "string" },
                fileName: { type: "string" },
                documentType: { type: "string" },
                status: {
                  type: "string",
                  enum: ["valid", "invalid", "anomaly"],
                },
                fieldResults: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      field: { type: "string" },
                      ruleId: { type: "string" },
                      status: {
                        type: "string",
                        enum: ["pass", "fail", "warn"],
                      },
                      expected: { type: "string" },
                      actual: { type: "string" },
                      message: { type: "string" },
                    },
                  },
                },
              },
            },
          },
          crossDocResults: {
            type: "array",
            items: {
              type: "object",
              properties: {
                ruleId: { type: "string" },
                description: { type: "string" },
                status: { type: "string", enum: ["pass", "fail", "warn"] },
                confidence: { type: "number" },
                sourceValue: { type: "string" },
                targetValue: { type: "string" },
                reasoning: { type: "string" },
              },
            },
          },
          anomalies: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string" },
                severity: {
                  type: "string",
                  enum: ["low", "medium", "high"],
                },
                message: { type: "string" },
              },
            },
          },
          tokenUsage: { type: "object" },
          costUsd: { type: "number" },
          processedAt: { type: "string", format: "date-time" },
        },
      },
    },
  },
};

export const handler: APIGatewayProxyHandlerV2 = async () => {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(spec, null, 2),
  };
};
