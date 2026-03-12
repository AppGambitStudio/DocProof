import { storage } from "./storage";
import { auth } from "./auth";
import { pipeline } from "./jobs";
import { bus } from "./events";

export const api = new sst.aws.ApiGatewayV2("DocProofApi", {
  cors: {
    allowOrigins: ["*"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Api-Key"],
  },
});

// --- Cognito JWT Authorizer for Admin routes ---

const cognitoAuthorizer = api.addAuthorizer({
  name: "DocProofCognitoAuthorizer",
  jwt: {
    issuer: $interpolate`https://cognito-idp.${aws.getRegionOutput().name}.amazonaws.com/${auth.userPool.id}`,
    audiences: [auth.userPoolClient.id],
  },
});

// --- Lambda Authorizer for API Key on Job routes ---

const apiKeyAuthorizer = api.addAuthorizer({
  name: "DocProofApiKeyAuthorizer",
  lambda: {
    function: auth.apiKeyAuthorizer.arn,
  },
});

// --- Job API Routes (API Key auth) ---

api.route("POST /jobs", {
  handler: "packages/functions/src/api/jobs/create.handler",
  link: [storage.table, storage.bucket],
  timeout: "30 seconds",
}, {
  auth: { lambda: apiKeyAuthorizer.id },
});

api.route("GET /jobs/{id}", {
  handler: "packages/functions/src/api/jobs/get.handler",
  link: [storage.table, storage.bucket],
}, {
  auth: { lambda: apiKeyAuthorizer.id },
});

api.route("GET /jobs", {
  handler: "packages/functions/src/api/jobs/list.handler",
  link: [storage.table],
}, {
  auth: { lambda: apiKeyAuthorizer.id },
});

api.route("POST /jobs/{id}/files", {
  handler: "packages/functions/src/api/jobs/upload.handler",
  link: [storage.table, storage.bucket],
  timeout: "60 seconds",
}, {
  auth: { lambda: apiKeyAuthorizer.id },
});

api.route("POST /jobs/{id}/process", {
  handler: "packages/functions/src/api/jobs/process.handler",
  link: [storage.table, pipeline.orchestrator],
  timeout: "30 seconds",
}, {
  auth: { lambda: apiKeyAuthorizer.id },
});

// --- Admin API Routes (Cognito JWT auth) ---

api.route("GET /admin/rule-sets", {
  handler: "packages/functions/src/api/admin/rulesets.handler",
  link: [storage.table],
}, {
  auth: { jwt: { authorizer: cognitoAuthorizer.id } },
});

api.route("POST /admin/rule-sets", {
  handler: "packages/functions/src/api/admin/rulesets.handler",
  link: [storage.table],
}, {
  auth: { jwt: { authorizer: cognitoAuthorizer.id } },
});

api.route("GET /admin/rule-sets/{id}", {
  handler: "packages/functions/src/api/admin/rulesets.handler",
  link: [storage.table],
}, {
  auth: { jwt: { authorizer: cognitoAuthorizer.id } },
});

api.route("PUT /admin/rule-sets/{id}", {
  handler: "packages/functions/src/api/admin/rulesets.handler",
  link: [storage.table],
}, {
  auth: { jwt: { authorizer: cognitoAuthorizer.id } },
});

api.route("DELETE /admin/rule-sets/{id}", {
  handler: "packages/functions/src/api/admin/rulesets.handler",
  link: [storage.table],
}, {
  auth: { jwt: { authorizer: cognitoAuthorizer.id } },
});

api.route("GET /admin/stats", {
  handler: "packages/functions/src/api/admin/stats.handler",
  link: [storage.table],
}, {
  auth: { jwt: { authorizer: cognitoAuthorizer.id } },
});

// --- Admin Job Routes (Cognito JWT auth — read-only view for admin console) ---

api.route("GET /admin/jobs", {
  handler: "packages/functions/src/api/admin/jobs.handler",
  link: [storage.table],
}, {
  auth: { jwt: { authorizer: cognitoAuthorizer.id } },
});

api.route("GET /admin/jobs/{id}", {
  handler: "packages/functions/src/api/admin/jobs.handler",
  link: [storage.table, storage.bucket],
}, {
  auth: { jwt: { authorizer: cognitoAuthorizer.id } },
});

// Admin job creation routes (same handlers, Cognito auth instead of API Key)
api.route("POST /admin/jobs", {
  handler: "packages/functions/src/api/jobs/create.handler",
  link: [storage.table, storage.bucket],
  timeout: "30 seconds",
}, {
  auth: { jwt: { authorizer: cognitoAuthorizer.id } },
});

api.route("POST /admin/jobs/{id}/upload", {
  handler: "packages/functions/src/api/jobs/upload.handler",
  link: [storage.table, storage.bucket],
  timeout: "60 seconds",
}, {
  auth: { jwt: { authorizer: cognitoAuthorizer.id } },
});

api.route("POST /admin/jobs/{id}/process", {
  handler: "packages/functions/src/api/jobs/process.handler",
  link: [storage.table, pipeline.orchestrator],
  timeout: "30 seconds",
}, {
  auth: { jwt: { authorizer: cognitoAuthorizer.id } },
});

api.route("POST /admin/jobs/{id}/review", {
  handler: "packages/functions/src/api/admin/review.handler",
  link: [storage.table, bus],
  timeout: "15 seconds",
  permissions: [
    { actions: ["events:PutEvents"], resources: ["*"] },
  ],
}, {
  auth: { jwt: { authorizer: cognitoAuthorizer.id } },
});

// --- Settings API Routes (Cognito JWT auth) ---

api.route("GET /admin/settings", {
  handler: "packages/functions/src/api/admin/settings.handler",
  link: [storage.table],
}, {
  auth: { jwt: { authorizer: cognitoAuthorizer.id } },
});

api.route("PUT /admin/settings", {
  handler: "packages/functions/src/api/admin/settings.handler",
  link: [storage.table],
}, {
  auth: { jwt: { authorizer: cognitoAuthorizer.id } },
});

// --- API Key Management Routes (Cognito JWT auth) ---

api.route("GET /admin/api-keys", {
  handler: "packages/functions/src/api/admin/api-keys.handler",
  link: [storage.table],
}, {
  auth: { jwt: { authorizer: cognitoAuthorizer.id } },
});

api.route("POST /admin/api-keys", {
  handler: "packages/functions/src/api/admin/api-keys.handler",
  link: [storage.table],
}, {
  auth: { jwt: { authorizer: cognitoAuthorizer.id } },
});

api.route("GET /admin/api-keys/{id}", {
  handler: "packages/functions/src/api/admin/api-keys.handler",
  link: [storage.table],
}, {
  auth: { jwt: { authorizer: cognitoAuthorizer.id } },
});

api.route("PUT /admin/api-keys/{id}", {
  handler: "packages/functions/src/api/admin/api-keys.handler",
  link: [storage.table],
}, {
  auth: { jwt: { authorizer: cognitoAuthorizer.id } },
});

api.route("DELETE /admin/api-keys/{id}", {
  handler: "packages/functions/src/api/admin/api-keys.handler",
  link: [storage.table],
}, {
  auth: { jwt: { authorizer: cognitoAuthorizer.id } },
});

// --- OpenAPI Spec (public, no auth) ---

api.route("GET /openapi.json", {
  handler: "packages/functions/src/api/openapi.handler",
});
