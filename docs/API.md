# DocProof API Reference

> Base URL is provided by `sst dev` output (local) or your deployed API Gateway URL.

---

## Authentication

DocProof uses two auth mechanisms:

| Route prefix | Auth method | Header |
|---|---|---|
| `/jobs/*` | API Key (Lambda authorizer) | `X-Api-Key: <your-api-key>` |
| `/admin/*` | Cognito JWT | `Authorization: Bearer <cognito-token>` |

---

## Job Endpoints

### POST /jobs

Create a new validation job.

**Auth:** `X-Api-Key`

**Request body:**

```json
{
  "ruleSetId": "kyc_india_individual",
  "ruleSetVersion": 1,
  "externalRef": "crm_ref_123",
  "metadata": { "applicantName": "Rahul Sharma" },
  "callbackUrl": "https://example.com/webhook",
  "documentTypes": ["pan_card", "aadhaar_card", "address_proof"]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `ruleSetId` | string | Yes | ID of the RuleSet to validate against |
| `ruleSetVersion` | number | No | Specific version; defaults to latest active |
| `externalRef` | string | No | Caller's reference ID for lookup |
| `metadata` | object | No | Job-level metadata (applicant name, etc.) |
| `callbackUrl` | string | No | Webhook URL for status updates |
| `documentTypes` | string[] | No | List of expected doc type IDs; presigned upload URLs are generated for each |

**Response (201):**

```json
{
  "jobId": "job_a1b2c3d4e5f6",
  "status": "created",
  "uploadUrls": {
    "pan_card": "https://s3.amazonaws.com/...",
    "aadhaar_card": "https://s3.amazonaws.com/...",
    "address_proof": "https://s3.amazonaws.com/..."
  }
}
```

`uploadUrls` is only present when `documentTypes` is provided. Each URL is a presigned S3 PUT URL valid for 1 hour.

**Error responses:**

| Status | Body | Cause |
|---|---|---|
| 400 | `{ "error": "ruleSetId is required" }` | Missing required field |
| 403 | `{ "message": "Forbidden" }` | Invalid or missing API key |
| 500 | `{ "error": "Internal server error" }` | Server error |

---

### GET /jobs/:id

Get job status and results.

**Auth:** `X-Api-Key`

**Path parameters:** `id` -- the job ID returned from POST /jobs.

**Response (200):**

```json
{
  "jobId": "job_a1b2c3d4e5f6",
  "status": "completed",
  "ruleSetId": "kyc_india_individual",
  "ruleSetVersion": 1,
  "externalRef": "crm_ref_123",
  "metadata": { "applicantName": "Rahul Sharma" },
  "files": [
    {
      "fileId": "file_abc12345",
      "fileName": "pan.pdf",
      "documentType": "pan_card",
      "s3Key": "jobs/job_a1b2c3d4e5f6/pan_card/...",
      "mimeType": "application/pdf",
      "uploadedAt": "2026-03-09T10:00:00.000Z"
    }
  ],
  "result": {
    "jobId": "job_a1b2c3d4e5f6",
    "overallStatus": "pass",
    "summary": {
      "totalDocuments": 3,
      "valid": 3,
      "invalid": 0,
      "anomalies": 0
    },
    "documents": [],
    "crossDocResults": [],
    "anomalies": []
  },
  "timestamps": {
    "created": "2026-03-09T09:00:00.000Z",
    "updated": "2026-03-09T10:05:00.000Z",
    "completed": "2026-03-09T10:05:00.000Z"
  }
}
```

The `result` field is `null` until the job reaches `completed` or `review_required` status.

**Error responses:**

| Status | Body | Cause |
|---|---|---|
| 400 | `{ "error": "Job ID required" }` | Missing path parameter |
| 403 | `{ "message": "Forbidden" }` | Invalid or missing API key |
| 404 | `{ "error": "Job not found" }` | No job with that ID |
| 500 | `{ "error": "Internal server error" }` | Server error |

---

### GET /jobs

List jobs, optionally filtered by status.

**Auth:** `X-Api-Key`

**Query parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `status` | string | -- | Filter by job status (`created`, `uploading`, `processing`, `extracting`, `validating`, `completed`, `failed`, `review_required`) |
| `limit` | number | 20 | Max results to return (capped at 100) |

**Response (200):**

```json
{
  "jobs": [ ... ],
  "count": 5
}
```

When no `status` filter is provided, the response returns an empty list with a message prompting for a `?status=` filter.

**Error responses:**

| Status | Body | Cause |
|---|---|---|
| 403 | `{ "message": "Forbidden" }` | Invalid or missing API key |
| 500 | `{ "error": "Internal server error" }` | Server error |

---

### POST /jobs/:id/files

Add a file to an existing job and get a presigned upload URL.

**Auth:** `X-Api-Key`

**Path parameters:** `id` -- the job ID.

**Request body:**

```json
{
  "fileName": "pan_card.pdf",
  "mimeType": "application/pdf",
  "documentType": "pan_card"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `fileName` | string | Yes | Original file name |
| `mimeType` | string | Yes | MIME type of the file |
| `documentType` | string | No | Document type ID matching the RuleSet. If omitted, the engine auto-classifies the document during extraction. |
| `size` | number | No | File size in bytes |

**Response (200):**

```json
{
  "fileId": "file_abc12345",
  "uploadUrl": "https://s3.amazonaws.com/..."
}
```

The presigned URL is valid for 1 hour. Upload the file with a PUT request to this URL.

**Error responses:**

| Status | Body | Cause |
|---|---|---|
| 400 | `{ "error": "fileName and mimeType are required" }` | Missing required fields |
| 400 | `{ "error": "Cannot upload files to job in completed state" }` | Job is not in `created` or `uploading` state |
| 403 | `{ "message": "Forbidden" }` | Invalid or missing API key |
| 404 | `{ "error": "Job not found" }` | No job with that ID |
| 500 | `{ "error": "Internal server error" }` | Server error |

---

### POST /jobs/:id/process

Start the processing pipeline for a job. The job must have at least one uploaded file and be in `created` or `uploading` state.

**Auth:** `X-Api-Key`

**Path parameters:** `id` -- the job ID.

**Response (202):**

```json
{
  "jobId": "job_a1b2c3d4e5f6",
  "status": "processing",
  "message": "Pipeline started"
}
```

The pipeline runs asynchronously. Poll `GET /jobs/:id` to check progress, or use the `callbackUrl` webhook for notifications.

**Error responses:**

| Status | Body | Cause |
|---|---|---|
| 400 | `{ "error": "Job ID required" }` | Missing path parameter |
| 400 | `{ "error": "Cannot process job in \"completed\" state..." }` | Job not in processable state |
| 400 | `{ "error": "No files uploaded..." }` | No files attached to job |
| 403 | `{ "message": "Forbidden" }` | Invalid or missing API key |
| 404 | `{ "error": "Job not found" }` | No job with that ID |
| 500 | `{ "error": "Internal server error" }` | Server error |

---

## Admin Endpoints

All admin endpoints require a Cognito JWT token in the `Authorization: Bearer <token>` header.

### GET /admin/rule-sets

List all active rule sets.

**Response (200):**

```json
{
  "ruleSets": [
    {
      "pk": "RULESET#kyc_india_individual",
      "sk": "META",
      "id": "kyc_india_individual",
      "name": "KYC — Individual (India)",
      "version": 1,
      "status": "active",
      ...
    }
  ]
}
```

---

### POST /admin/rule-sets

Create a new rule set.

**Request body:**

```json
{
  "id": "kyc_india_individual",
  "name": "KYC — Individual (India)",
  "description": "Standard KYC verification for individual onboarding",
  "version": 1,
  "status": "active",
  "documentTypes": [ ... ],
  "fieldRules": [ ... ],
  "crossDocRules": [ ... ],
  "metadataRules": [ ... ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | Yes | Unique identifier for the rule set |
| `name` | string | No | Human-readable name |
| `description` | string | No | Description of the rule set |
| `version` | number | No | Version number |
| `status` | string | No | `draft`, `active`, or `archived` (defaults to `draft`) |
| `documentTypes` | array | No | Document type configurations |
| `fieldRules` | array | No | Field-level validation rules |
| `crossDocRules` | array | No | Cross-document validation rules |
| `metadataRules` | array | No | Metadata validation rules |
| `promptConfig` | object | No | Custom prompt configuration for extraction |

See [RULES.md](RULES.md) for the full RuleSet schema.

**Response (201):**

```json
{
  "id": "kyc_india_individual",
  "status": "created"
}
```

**Error responses:**

| Status | Body | Cause |
|---|---|---|
| 400 | `{ "error": "id is required and must be a non-empty string" }` | Missing or invalid `id` |
| 400 | `{ "error": "Invalid JSON in request body" }` | Malformed JSON |
| 401 | Unauthorized | Invalid or missing Cognito token |
| 500 | `{ "error": "Internal server error" }` | Server error |

---

### GET /admin/rule-sets/:id

Get a specific rule set by ID.

**Response (200):** Full rule set object.

**Error responses:**

| Status | Body | Cause |
|---|---|---|
| 404 | `{ "error": "Not found" }` | No rule set with that ID |

---

### PUT /admin/rule-sets/:id

Update an existing rule set. Sends a partial update — only included fields are changed. Returns 404 if the rule set doesn't exist.

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | No | Human-readable name |
| `description` | string | No | Description of the rule set |
| `version` | number | No | Version number |
| `status` | string | No | `draft`, `active`, or `archived` |
| `documentTypes` | array | No | Document type configurations |
| `fieldRules` | array | No | Field-level validation rules |
| `crossDocRules` | array | No | Cross-document validation rules |
| `metadataRules` | array | No | Metadata validation rules |
| `promptConfig` | object | No | Custom prompt configuration for extraction |

**Response (200):**

```json
{
  "id": "kyc_india_individual",
  "status": "updated"
}
```

**Error responses:**

| Status | Body | Cause |
|---|---|---|
| 404 | `{ "error": "Not found" }` | No rule set with that ID |
| 400 | `{ "error": "Invalid JSON in request body" }` | Malformed JSON |
| 401 | Unauthorized | Invalid or missing Cognito token |
| 500 | `{ "error": "Internal server error" }` | Server error |

---

### DELETE /admin/rule-sets/:id

Delete a rule set and all its associated document type records.

**Response (200):**

```json
{
  "deleted": true
}
```

**Error responses:**

| Status | Body | Cause |
|---|---|---|
| 400 | `{ "error": "ID required" }` | Missing path parameter |

---

### GET /admin/jobs

List jobs with optional status filter and pagination.

**Query parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `status` | string | -- | Filter by job status |
| `limit` | number | 50 | Max results (capped at 100) |
| `cursor` | string | -- | Pagination cursor from previous response |

**Response (200):**

```json
{
  "jobs": [
    {
      "jobId": "job_a1b2c3d4e5f6",
      "status": "completed",
      "ruleSetId": "kyc_india_individual",
      "externalRef": "crm_ref_123",
      "fileCount": 3,
      "costUsd": 0.0042,
      "createdAt": "2026-03-09T09:00:00.000Z",
      "updatedAt": "2026-03-09T10:05:00.000Z",
      "completedAt": "2026-03-09T10:05:00.000Z"
    }
  ],
  "count": 1,
  "nextCursor": "eyJway..."
}
```

`count` is the number of jobs in the current page. Use `nextCursor` to fetch the next page.

When no `status` filter is provided, a DynamoDB scan is used (less efficient). Always provide a status filter when possible.

---

### GET /admin/jobs/:id

Get full job detail including result.

**Path parameters:** `id` — the job ID.

**Response (200):**

```json
{
  "jobId": "job_a1b2c3d4e5f6",
  "status": "completed",
  "ruleSetId": "kyc_india_individual",
  "ruleSetVersion": 1,
  "externalRef": "crm_ref_123",
  "metadata": { "applicantName": "Rahul Sharma" },
  "files": [ ... ],
  "fileUrls": { "file_abc123": "https://s3.presigned-url..." },
  "costUsd": 0.0042,
  "result": { ... },
  "reviewedBy": "admin@example.com",
  "reviewedAt": "2026-03-09T11:00:00.000Z",
  "reviewAction": "approve",
  "reviewNotes": "Verified manually",
  "timestamps": {
    "created": "2026-03-09T09:00:00.000Z",
    "updated": "2026-03-09T10:05:00.000Z",
    "completed": "2026-03-09T10:05:00.000Z"
  }
}
```

The `result` field is populated for `completed`, `failed`, and `review_required` jobs. The `fileUrls` object maps file IDs to presigned S3 URLs (1-hour expiry) for document preview. The `reviewedBy`, `reviewedAt`, `reviewAction`, and `reviewNotes` fields are present only for reviewed jobs.

**Error responses:**

| Status | Body | Cause |
|---|---|---|
| 404 | `{ "error": "Job not found" }` | No job with that ID |

---

### POST /admin/jobs

Create a new verification job (admin-authenticated version of `POST /jobs`).

**Auth:** Cognito JWT

**Request body:** Same as `POST /jobs` (see [Job Routes](#post-jobs)).

**Response:** Same as `POST /jobs`.

---

### POST /admin/jobs/:id/upload

Upload a file to a job (admin-authenticated version of `POST /jobs/:id/files`).

**Auth:** Cognito JWT

**Request/Response:** Same as `POST /jobs/:id/files`.

---

### POST /admin/jobs/:id/process

Start the processing pipeline (admin-authenticated version of `POST /jobs/:id/process`).

**Auth:** Cognito JWT

**Request/Response:** Same as `POST /jobs/:id/process`.

---

### POST /admin/jobs/:id/review

Approve or reject a job that is in `review_required` state.

**Path parameters:** `id` — the job ID.

**Request body:**

```json
{
  "action": "approve",
  "notes": "Verified manually — all documents are legitimate."
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `action` | `"approve" \| "reject"` | Yes | Review decision |
| `notes` | `string` | No | Reviewer notes |

**Response (200):**

```json
{
  "jobId": "job_a1b2c3d4e5f6",
  "status": "approved",
  "reviewedBy": "admin@example.com",
  "reviewedAt": "2026-03-09T11:00:00.000Z"
}
```

**Error responses:**

| Status | Body | Cause |
|---|---|---|
| 400 | `{ "error": "..." }` | Invalid action, job not in review_required state |
| 404 | `{ "error": "Job not found" }` | No job with that ID |

---

### GET /admin/stats

Get aggregate statistics.

**Response (200):**

```json
{
  "jobs": {
    "total": 150,
    "processing": 3,
    "completed": 120,
    "failed": 5,
    "reviewRequired": 2,
    "byStatus": {
      "created": 10,
      "uploading": 5,
      "extracting": 2,
      "validating": 1,
      "completed": 120,
      "failed": 5,
      "review_required": 2
    }
  },
  "ruleSets": {
    "active": 4
  },
  "cost": {
    "totalUsd": 1.2345
  },
  "recentCompleted": [
    {
      "jobId": "job_a1b2c3d4e5f6",
      "ruleSetId": "kyc_india_individual",
      "externalRef": "crm_ref_123",
      "costUsd": 0.0042,
      "fileCount": 3,
      "completedAt": "2026-03-09T10:05:00.000Z"
    }
  ]
}
```

---

## Job Statuses

| Status | Description |
|---|---|
| `created` | Job created, waiting for file uploads |
| `uploading` | Files are being uploaded |
| `processing` | Pipeline has started |
| `extracting` | Claude is extracting data from documents |
| `validating` | Rule engine is running validations |
| `completed` | All checks finished successfully |
| `failed` | Processing encountered an error |
| `review_required` | Completed with anomalies requiring human review |
