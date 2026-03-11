import { useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AuthType = "api-key" | "jwt";

interface Endpoint {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  description: string;
  auth: AuthType;
  body?: string;
  response?: string;
  notes?: string;
}

interface EndpointGroup {
  title: string;
  description: string;
  endpoints: Endpoint[];
}

// ---------------------------------------------------------------------------
// API Data
// ---------------------------------------------------------------------------

const API_GROUPS: EndpointGroup[] = [
  {
    title: "Jobs (API Key)",
    description:
      "Programmatic endpoints for creating and managing verification jobs. Use these from your backend services.",
    endpoints: [
      {
        method: "POST",
        path: "/jobs",
        description: "Create a new verification job",
        auth: "api-key",
        body: `{
  "ruleSetId": "kyc_india_individual",
  "externalRef": "APP-12345",
  "metadata": {
    "applicantName": "Rahul Sharma"
  },
  "documentTypes": ["pan_card", "aadhaar_card"]
}`,
        response: `{
  "jobId": "job_a1b2c3d4e5f6",
  "status": "created",
  "uploadUrls": {
    "pan_card": "https://s3.amazonaws.com/...",
    "aadhaar_card": "https://s3.amazonaws.com/..."
  }
}`,
        notes:
          "If documentTypes is provided, presigned S3 upload URLs are returned. Otherwise, use POST /jobs/:id/files to upload individually.",
      },
      {
        method: "POST",
        path: "/jobs/:id/files",
        description: "Upload a document file to a job",
        auth: "api-key",
        body: `{
  "fileName": "pan_card.pdf",
  "mimeType": "application/pdf",
  "documentType": "pan_card",
  "size": 102400
}`,
        response: `{
  "fileId": "file_a1b2c3d4",
  "uploadUrl": "https://s3.amazonaws.com/..."
}`,
        notes:
          "documentType is optional — if omitted, the engine auto-classifies the document during extraction. Returns a presigned PUT URL; upload the file directly to this URL with the correct Content-Type header.",
      },
      {
        method: "POST",
        path: "/jobs/:id/process",
        description: "Start the verification pipeline",
        auth: "api-key",
        response: `{
  "jobId": "job_a1b2c3d4e5f6",
  "status": "processing",
  "message": "Pipeline started"
}`,
        notes:
          "Returns 202 immediately. The pipeline runs asynchronously. Poll GET /jobs/:id for status updates.",
      },
      {
        method: "GET",
        path: "/jobs/:id",
        description: "Get job details and results",
        auth: "api-key",
        response: `{
  "jobId": "job_a1b2c3d4e5f6",
  "status": "completed",
  "ruleSetId": "kyc_india_individual",
  "result": {
    "overallStatus": "pass",
    "documents": [...],
    "crossDocResults": [...],
    "anomalies": [...]
  },
  "timestamps": { "created": "...", "completed": "..." }
}`,
      },
      {
        method: "GET",
        path: "/jobs",
        description: "List jobs with optional status filter",
        auth: "api-key",
        notes: "Query params: status (required), limit (default 20, max 100).",
      },
    ],
  },
  {
    title: "Admin: RuleSets",
    description:
      "Manage verification rulesets. These endpoints require Cognito JWT authentication.",
    endpoints: [
      {
        method: "GET",
        path: "/admin/rule-sets",
        description: "List all rulesets",
        auth: "jwt",
        response: `{
  "ruleSets": [
    {
      "id": "kyc_india_individual",
      "name": "KYC \u2014 Individual (India)",
      "status": "active",
      "version": 1,
      "documentTypes": [...]
    }
  ]
}`,
      },
      {
        method: "POST",
        path: "/admin/rule-sets",
        description: "Create a new ruleset",
        auth: "jwt",
        body: `{
  "id": "kyc_india_individual",
  "name": "KYC \u2014 Individual (India)",
  "description": "Standard KYC verification",
  "version": 1,
  "status": "active",
  "documentTypes": [...],
  "fieldRules": [...],
  "crossDocRules": [...],
  "metadataRules": [...],
  "promptConfig": { ... }
}`,
        notes: "You can import example rulesets from the examples/ directory.",
      },
      {
        method: "GET",
        path: "/admin/rule-sets/:id",
        description: "Get a specific ruleset",
        auth: "jwt",
      },
      {
        method: "PUT",
        path: "/admin/rule-sets/:id",
        description: "Update a ruleset",
        auth: "jwt",
        notes: "Same fields as POST, except id cannot be changed.",
      },
      {
        method: "DELETE",
        path: "/admin/rule-sets/:id",
        description: "Delete a ruleset",
        auth: "jwt",
      },
    ],
  },
  {
    title: "Admin: Jobs",
    description:
      "Admin-facing job management with Cognito JWT auth. Includes job creation, monitoring, and review workflow.",
    endpoints: [
      {
        method: "POST",
        path: "/admin/jobs",
        description: "Create a job (admin auth)",
        auth: "jwt",
        body: `{
  "ruleSetId": "kyc_india_individual",
  "externalRef": "APP-12345",
  "metadata": { "applicantName": "Rahul Sharma" }
}`,
        notes: "Same as POST /jobs but uses Cognito JWT instead of API Key. Used by the admin UI.",
      },
      {
        method: "POST",
        path: "/admin/jobs/:id/upload",
        description: "Upload file to job (admin auth)",
        auth: "jwt",
        body: `{
  "fileName": "pan_card.pdf",
  "mimeType": "application/pdf"
}`,
        notes:
          "documentType is optional. Omit it to let the engine auto-detect the document type.",
      },
      {
        method: "POST",
        path: "/admin/jobs/:id/process",
        description: "Start pipeline (admin auth)",
        auth: "jwt",
      },
      {
        method: "GET",
        path: "/admin/jobs",
        description: "List jobs with filters and pagination",
        auth: "jwt",
        notes:
          "Query params: status (optional), limit (default 50, max 100), cursor (pagination token).",
      },
      {
        method: "GET",
        path: "/admin/jobs/:id",
        description: "Get job detail with result and file URLs",
        auth: "jwt",
        notes: "Returns presigned download URLs for uploaded files and review metadata.",
      },
      {
        method: "POST",
        path: "/admin/jobs/:id/review",
        description: "Approve or reject a job in review",
        auth: "jwt",
        body: `{
  "action": "approve",
  "notes": "All documents verified manually"
}`,
        response: `{
  "jobId": "job_a1b2c3d4e5f6",
  "status": "approved",
  "reviewedBy": "admin@example.com",
  "reviewedAt": "2025-01-15T10:30:00Z"
}`,
        notes: 'Only works on jobs with status "review_required". Action must be "approve" or "reject".',
      },
    ],
  },
  {
    title: "Admin: Stats",
    description: "Dashboard statistics for the admin console.",
    endpoints: [
      {
        method: "GET",
        path: "/admin/stats",
        description: "Get dashboard statistics",
        auth: "jwt",
        response: `{
  "jobs": {
    "total": 42,
    "processing": 3,
    "completed": 30,
    "failed": 2,
    "reviewRequired": 1,
    "byStatus": { "created": 5, "completed": 30, ... }
  },
  "ruleSets": { "active": 3 },
  "cost": { "totalUsd": 1.234567 },
  "recentCompleted": [...]
}`,
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const METHOD_COLORS: Record<string, string> = {
  GET: "bg-green-100 text-green-700",
  POST: "bg-blue-100 text-blue-700",
  PUT: "bg-amber-100 text-amber-700",
  DELETE: "bg-red-100 text-red-700",
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 text-xs px-2 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
      title="Copy to clipboard"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function buildCurl(ep: Endpoint, apiUrl: string): string {
  const url = `${apiUrl || "<API_URL>"}${ep.path}`;
  const lines: string[] = [`curl -X ${ep.method} '${url}'`];

  if (ep.auth === "api-key") {
    lines.push(`  -H 'X-Api-Key: <YOUR_API_KEY>'`);
  } else {
    lines.push(`  -H 'Authorization: Bearer <JWT_TOKEN>'`);
  }

  if (ep.body) {
    lines.push(`  -H 'Content-Type: application/json'`);
    lines.push(`  -d '${ep.body.replace(/\n\s*/g, " ").trim()}'`);
  }

  return lines.join(" \\\n");
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <div className="relative">
      {label && (
        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">
          {label}
        </span>
      )}
      <div className="relative mt-1">
        <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 text-xs overflow-x-auto leading-relaxed">
          <code>{code}</code>
        </pre>
        <CopyButton text={code} />
      </div>
    </div>
  );
}

function EndpointCard({
  endpoint,
  apiUrl,
}: {
  endpoint: Endpoint;
  apiUrl: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
      >
        <span
          className={`px-2 py-0.5 rounded text-xs font-bold ${METHOD_COLORS[endpoint.method]}`}
        >
          {endpoint.method}
        </span>
        <code className="text-sm font-mono text-gray-800 flex-1">
          {endpoint.path}
        </code>
        <span className="text-xs text-gray-400 hidden sm:inline">
          {endpoint.description}
        </span>
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-gray-200 px-4 py-4 space-y-4 bg-gray-50">
          <p className="text-sm text-gray-600">{endpoint.description}</p>

          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-500">Auth:</span>
            {endpoint.auth === "api-key" ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
                X-Api-Key
              </span>
            ) : (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-700">
                Cognito JWT
              </span>
            )}
          </div>

          {endpoint.notes && (
            <p className="text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              {endpoint.notes}
            </p>
          )}

          <CodeBlock code={buildCurl(endpoint, apiUrl)} label="curl" />

          {endpoint.body && (
            <CodeBlock code={endpoint.body} label="Request body" />
          )}

          {endpoint.response && (
            <CodeBlock code={endpoint.response} label="Response" />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function ApiReference() {
  const apiUrl = import.meta.env.VITE_API_URL || "";
  const [search, setSearch] = useState("");

  const filtered = API_GROUPS.map((group) => ({
    ...group,
    endpoints: group.endpoints.filter(
      (ep) =>
        !search ||
        ep.path.toLowerCase().includes(search.toLowerCase()) ||
        ep.description.toLowerCase().includes(search.toLowerCase()) ||
        ep.method.toLowerCase().includes(search.toLowerCase())
    ),
  })).filter((g) => g.endpoints.length > 0);

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">API Reference</h1>
        <p className="mt-1 text-sm text-gray-500">
          Interactive API documentation with copy-paste curl commands
        </p>
      </div>

      {/* Quick start */}
      <div className="bg-white shadow rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Quick Start</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-gray-50 rounded-lg p-4">
            <h3 className="text-sm font-medium text-gray-700 mb-2">
              API Key Authentication
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              For programmatic access from your backend. Pass the API key in the
              X-Api-Key header.
            </p>
            <code className="text-xs bg-gray-900 text-gray-100 rounded px-2 py-1 block">
              -H 'X-Api-Key: your-api-key'
            </code>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <h3 className="text-sm font-medium text-gray-700 mb-2">
              JWT Authentication
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              For admin endpoints. Get a token via Cognito and pass it as a
              Bearer token.
            </p>
            <code className="text-xs bg-gray-900 text-gray-100 rounded px-2 py-1 block">
              -H 'Authorization: Bearer &lt;jwt&gt;'
            </code>
          </div>
        </div>

        {apiUrl && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-500">Base URL:</span>
            <code className="bg-gray-100 px-2 py-0.5 rounded font-mono text-gray-800">
              {apiUrl}
            </code>
          </div>
        )}

        <div className="bg-blue-50 border border-blue-200 rounded-md px-4 py-3">
          <h4 className="text-sm font-medium text-blue-800 mb-1">
            Typical Integration Flow
          </h4>
          <ol className="text-xs text-blue-700 space-y-1 list-decimal list-inside">
            <li>
              <strong>Create a ruleset</strong> via admin UI or POST
              /admin/rule-sets
            </li>
            <li>
              <strong>Create a job</strong> with POST /jobs (returns upload
              URLs)
            </li>
            <li>
              <strong>Upload documents</strong> to the presigned S3 URLs
              (PUT)
            </li>
            <li>
              <strong>Start processing</strong> with POST /jobs/:id/process
            </li>
            <li>
              <strong>Poll for results</strong> with GET /jobs/:id until status
              is terminal
            </li>
            <li>
              <strong>Review anomalies</strong> (if status is
              "review_required") via the admin UI or POST
              /admin/jobs/:id/review
            </li>
          </ol>
        </div>
      </div>

      {/* Search */}
      <div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter endpoints... (e.g. POST, /jobs, review)"
          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
        />
      </div>

      {/* Endpoint groups */}
      {filtered.map((group) => (
        <div key={group.title} className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {group.title}
            </h2>
            <p className="text-sm text-gray-500">{group.description}</p>
          </div>
          <div className="space-y-2">
            {group.endpoints.map((ep) => (
              <EndpointCard
                key={`${ep.method} ${ep.path}`}
                endpoint={ep}
                apiUrl={apiUrl}
              />
            ))}
          </div>
        </div>
      ))}

      {filtered.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          No endpoints match "{search}"
        </div>
      )}
    </div>
  );
}
