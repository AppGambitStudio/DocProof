# DocProof — Feature Roadmap (v2)

## Overview

This document outlines the next set of features targeting SME and Enterprise adoption. Every feature has both **API** and **UI** support. All configurations are managed via **Settings UI/API** — no env files or hardcoded values.

---

## 1. Settings API & UI

A new `SETTINGS` record in DynamoDB replaces all hardcoded values. Settings are scoped globally or per-tenant (future).

### Data Model

```
pk: "SETTINGS", sk: "GLOBAL"
```

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `defaultModel` | string | `global.anthropic.claude-haiku-4-5-20251001-v1:0` | Default extraction model |
| `escalationModel` | string | `global.anthropic.claude-sonnet-4-5-20250929-v1:0` | Escalation model for LOW confidence |
| `escalationThreshold` | string | `LOW` | Confidence level that triggers escalation |
| `documentRetentionDays` | number | `90` | Auto-delete documents from S3 after N days |
| `resultRetentionDays` | number | `365` | Auto-delete job results after N days |
| `maxFileSizeMb` | number | `10` | Max upload file size |
| `maxFilesPerJob` | number | `20` | Max files per job |
| `webhookRetryAttempts` | number | `3` | Webhook delivery retry count |
| `webhookTimeoutMs` | number | `10000` | Webhook delivery timeout |
| `defaultTemperature` | number | `0` | Default model temperature |
| `reviewAssignmentMode` | string | `manual` | `manual` or `round_robin` |
| `notificationEmail` | string | `null` | Email for job failure alerts (SES) |
| `slackWebhookUrl` | string | `null` | Slack webhook for alerts |

### API Routes

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/admin/settings` | Cognito | Get all settings |
| `PUT` | `/admin/settings` | Cognito | Update settings (partial merge) |

### UI

New **Settings** page in sidebar (gear icon, bottom of nav above user menu):
- Grouped sections: General, Models, Retention, Webhooks, Notifications
- Save button with validation
- Reset to defaults option

### Implementation

- **DynamoDB:** Single record `pk=SETTINGS, sk=GLOBAL`
- **Handler:** `packages/functions/src/api/admin/settings.ts` — GET (read or return defaults), PUT (merge-update)
- **Core:** `packages/core/src/settings/defaults.ts` — default values + type definition
- **Pipeline reads settings** at runtime instead of hardcoded constants in extractor.ts
- **Infra:** Add routes to `infra/api.ts` with Cognito auth
- **Web:** `packages/web/src/pages/Settings.tsx`

---

## 2. API Key Management

Replace the single SST Secret API key with multiple managed API keys stored in DynamoDB.

### Data Model

```
pk: "APIKEY#<keyHash>", sk: "META"
```

| Field | Type | Description |
|-------|------|-------------|
| `keyId` | string | Short identifier (e.g., `key_abc123`) |
| `keyHash` | string | SHA-256 hash of the actual key (never store plaintext) |
| `keyPrefix` | string | First 8 chars for display (e.g., `dp_sk_ab...`) |
| `name` | string | Human-readable label (e.g., "Production CRM") |
| `createdBy` | string | Admin email who created it |
| `createdAt` | string | ISO timestamp |
| `lastUsedAt` | string | ISO timestamp (updated on each use) |
| `expiresAt` | string | Optional expiry date |
| `status` | string | `active` or `revoked` |
| `scopes` | string[] | Optional: restrict to specific ruleSetIds |
| `rateLimit` | number | Optional: requests per minute |

GSI entry for listing: `gsi1pk: "APIKEYS", gsi1sk: keyId`

### API Routes

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/admin/api-keys` | Cognito | List all API keys (masked) |
| `POST` | `/admin/api-keys` | Cognito | Create new key (returns full key once) |
| `GET` | `/admin/api-keys/{keyId}` | Cognito | Get key details (masked) |
| `PUT` | `/admin/api-keys/{keyId}` | Cognito | Update name, scopes, rate limit |
| `DELETE` | `/admin/api-keys/{keyId}` | Cognito | Revoke key (soft delete — set status=revoked) |

### UI

New **API Keys** page under Settings or standalone nav item:
- Table: name, prefix, status, created, last used, scopes
- "Create Key" button → modal shows full key once with copy button + warning
- Revoke button with confirmation
- Edit name/scopes inline

### Implementation

- **Authorizer update:** `api-key-authorizer.ts` — hash incoming key with SHA-256, query DynamoDB `pk=APIKEY#<hash>`, check status=active and expiry, update lastUsedAt
- **Backward compat:** Keep SST Secret as fallback during migration, remove later
- **Key format:** `dp_sk_<random32chars>` (prefix makes it identifiable in logs)
- **Handler:** `packages/functions/src/api/admin/api-keys.ts`
- **Web:** `packages/web/src/pages/ApiKeys.tsx`

---

## 3. Reporting & Analytics

### 3a. Enhanced Dashboard

Replace current basic stats with a comprehensive dashboard.

**Current stats.ts returns:** job counts by status, recent completions, total cost, active ruleset count.

**Enhanced dashboard data:**

| Metric | Source | Description |
|--------|--------|-------------|
| Jobs by status | GSI scan | Count per status (existing) |
| Jobs over time | New: daily aggregation | Jobs created per day (last 30d) |
| Pass/fail/review rate | Job results | Percentage breakdown |
| Avg processing time | `completedAt - createdAt` | P50, P95, P99 |
| Cost per day | Job records | Daily Bedrock spend |
| Cost per ruleset | Job records grouped | Which rulesets cost most |
| Top failure reasons | Field validation results | Most common validation failures |
| Model usage split | Token usage entries | Haiku vs Sonnet call ratio |
| Avg confidence | Extraction results | HIGH/MEDIUM/LOW distribution |

### Data Model — Daily Aggregates

```
pk: "STATS#DAILY", sk: "2026-03-12"
```

| Field | Type |
|-------|------|
| `date` | string |
| `jobsCreated` | number |
| `jobsCompleted` | number |
| `jobsFailed` | number |
| `jobsReviewRequired` | number |
| `totalCostUsd` | number |
| `totalInputTokens` | number |
| `totalOutputTokens` | number |
| `haikuCalls` | number |
| `sonnetCalls` | number |
| `avgProcessingMs` | number |
| `byRuleSet` | Record<string, { jobs, cost, pass, fail }> |

**Aggregation strategy:** Update daily stats atomically in `compile.ts` using DynamoDB `ADD` operations when each job completes. No separate aggregation Lambda needed.

### API Routes

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/admin/stats` | Cognito | Enhanced: includes daily trends, per-ruleset breakdown |
| `GET` | `/admin/stats/daily` | Cognito | Daily aggregates for date range (`?from=&to=`) |
| `GET` | `/admin/stats/rulesets/{id}` | Cognito | Per-ruleset analytics |
| `GET` | `/admin/stats/export` | Cognito | CSV export of stats for date range |

### UI — Dashboard Page

Redesigned dashboard with:
- **Summary cards** — total jobs, pass rate, avg cost, avg time (top row)
- **Jobs over time chart** — bar/line chart (last 30 days), filterable by ruleset
- **Pass/Fail/Review donut** — overall and per-ruleset
- **Cost trend** — daily cost line chart
- **Recent jobs table** — last 10 with status badges (existing, keep)
- **Top failures** — table of most common validation failures
- **Model usage** — Haiku vs Sonnet pie chart

Chart library: **Recharts** (lightweight, React-native, already tree-shakeable).

### 3b. Cost Reporting

- Per-job cost already tracked (`costUsd` on job record)
- Add **monthly rollup view** in dashboard
- **Export as CSV** — date, jobId, ruleSetId, model, inputTokens, outputTokens, cost
- Filter by date range, ruleset, status

### 3c. SLA Tracking

- Calculate processing time: `completedAt - createdAt` (already stored)
- Show P50/P95/P99 on dashboard
- **Settings:** configurable SLA threshold (e.g., 60s) — alert when exceeded
- Visual indicator on job list for jobs exceeding SLA

---

## 4. Human Review Queue & Assignments

### Current State

- `review.ts` exists — handles approve/reject with reviewer email from JWT
- Job status: `review_required → approved | rejected`
- No assignment system, no dedicated queue UI

### Data Model — Review Assignments

Extend job record with:

| Field | Type | Description |
|-------|------|-------------|
| `assignedTo` | string | Reviewer email |
| `assignedAt` | string | ISO timestamp |
| `assignedBy` | string | Email of assigner (or "system" for auto) |
| `priority` | string | `low`, `normal`, `high`, `urgent` |
| `reviewNotes` | string | Internal notes (already exists) |
| `reviewHistory` | array | `[{ action, by, at, notes }]` — audit trail |

New GSI pattern for reviewer queue:
```
gsi1pk: "REVIEWER#email", gsi1sk: "createdAt"
```

This requires a second GSI or creative use of the existing one. **Recommended:** Add a `gsi2` (reviewer + priority) to the table:
```
gsi2pk: "REVIEWER#<email>", gsi2sk: "<priority>#<createdAt>"
```

### API Routes

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/admin/review-queue` | Cognito | List review_required jobs, filter by assignee/priority |
| `POST` | `/admin/jobs/{id}/assign` | Cognito | Assign job to reviewer |
| `POST` | `/admin/jobs/{id}/review` | Cognito | Approve/reject (existing, enhanced) |
| `GET` | `/admin/reviewers` | Cognito | List Cognito users available as reviewers |

### UI — Review Queue Page

New **Review Queue** page in sidebar (between Jobs and API Reference):
- **Tabs:** My Queue / All / Unassigned
- **Filters:** priority, ruleset, date range
- **Bulk actions:** assign selected, approve selected
- **Job card in queue:** shows anomaly summary, key field failures, document thumbnails
- **Assign dropdown:** list of admin users from Cognito
- **Priority badges:** color-coded (urgent=red, high=orange, normal=blue, low=gray)

### Auto-Assignment (Settings-driven)

When `reviewAssignmentMode = "round_robin"` in Settings:
- On job entering `review_required`, auto-assign to next reviewer in rotation
- Reviewer list managed in Settings → Reviewers section

---

## 5. Job Reprocessing

Allow re-running extraction or validation on an existing job without re-uploading files.

### API Routes

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/jobs/{id}/reprocess` | API Key | Re-run full pipeline (extract + validate) |
| `POST` | `/admin/jobs/{id}/reprocess` | Cognito | Same, admin auth |

### Implementation

- Validate job exists and has files uploaded
- Reset status to `processing`, clear previous result
- Store previous result as `sk: "RESULT#<version>"` for audit trail
- Re-invoke orchestrator with same files + current ruleset version
- Track reprocess count on job record (`reprocessCount: number`)

### UI

- **Reprocess button** on JobDetail page (visible for completed/failed/approved/rejected jobs)
- Confirmation modal: "This will re-extract and re-validate all documents using the current ruleset. Previous results will be preserved in history."
- **Result history tab** on JobDetail — show previous results with timestamps

---

## 6. Partial Submission

Allow creating a job and uploading documents incrementally, processing only when ready.

### Current Flow
```
POST /jobs (with documentTypes) → returns presigned URLs → upload all → POST /jobs/{id}/process
```

### Enhanced Flow
```
POST /jobs (no documentTypes required) → returns jobId
POST /jobs/{id}/files (one at a time, with documentType) → returns presigned URL
... repeat ...
GET /jobs/{id} → shows uploaded files + missing required docs
POST /jobs/{id}/process → validates all required docs present, then processes
```

### Changes

1. **Create job** — `documentTypes` becomes optional. If omitted, job is created in `created` status with no files.
2. **Upload** — each upload specifies `documentType` and `fileName`. Multiple uploads allowed.
3. **Status tracking** — new `GET /jobs/{id}/readiness` endpoint returns:
   ```json
   {
     "ready": false,
     "uploaded": ["pan_card", "aadhaar_card"],
     "missing": ["address_proof"],
     "optional": ["photograph"]
   }
   ```
4. **Process** — validates required documents are present before starting. Returns 400 with missing list if not ready.
5. **File removal** — `DELETE /jobs/{id}/files/{fileId}` to remove an uploaded file before processing.

### API Routes

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/jobs/{id}/readiness` | API Key | Check if all required docs are uploaded |
| `DELETE` | `/jobs/{id}/files/{fileId}` | API Key | Remove uploaded file |
| `GET` | `/admin/jobs/{id}/readiness` | Cognito | Same, admin auth |
| `DELETE` | `/admin/jobs/{id}/files/{fileId}` | Cognito | Same, admin auth |

### UI — Enhanced CreateJob Page

- Step 1: Select ruleset + enter metadata
- Step 2: Upload files one-by-one with document type selector
- Readiness indicator: checklist of required docs with green/red status
- "Process" button enabled only when all required docs present
- Allow saving draft (job in `created` status) and returning later

---

## 7. OpenAPI Spec

Auto-generated OpenAPI 3.0 specification for the Job API.

### Approach

- **Static spec file:** `packages/functions/src/openapi.ts` — exports the spec as a TypeScript object
- **Served at:** `GET /openapi.json` (no auth — public)
- **Covers:** All `/jobs/*` routes (the public API). Admin routes documented separately.
- **Types derived from** core types (RuleSet, Job, JobResult, etc.)

### Implementation

1. Write `openapi.ts` with full path/schema definitions matching existing handlers
2. Add route in `infra/api.ts`: `GET /openapi.json` → handler returns spec
3. Update **API Reference** page in web UI to render from the spec (using Swagger UI or Redoc component)
4. Keep spec in sync manually (or add a CI check that validates spec against handler signatures)

### Spec Structure

```yaml
openapi: 3.0.3
info:
  title: DocProof Job API
  version: 1.0.0
paths:
  /jobs:
    post: # Create job
    get:  # List jobs
  /jobs/{id}:
    get:  # Get job
  /jobs/{id}/files:
    post:   # Upload file
    delete: # Remove file (new)
  /jobs/{id}/process:
    post: # Start processing
  /jobs/{id}/reprocess:
    post: # Reprocess (new)
  /jobs/{id}/readiness:
    get: # Check readiness (new)
security:
  - ApiKeyAuth: []
components:
  securitySchemes:
    ApiKeyAuth:
      type: apiKey
      in: header
      name: X-Api-Key
  schemas:
    Job, JobResult, CreateJobRequest, etc.
```

---

## 8. SDK / Client Library

TypeScript SDK published as `@docproof/sdk` in the monorepo.

### Package Structure

```
packages/sdk/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts          # Main exports
│   ├── client.ts         # DocProofClient class
│   ├── types.ts          # Request/response types (subset of core types)
│   └── errors.ts         # Typed error classes
└── README.md
```

### API Surface

```typescript
import { DocProofClient } from "@docproof/sdk";

const client = new DocProofClient({
  baseUrl: "https://api.example.com",
  apiKey: "dp_sk_...",
});

// Create job
const job = await client.createJob({
  ruleSetId: "kyc_india_individual",
  metadata: { applicantName: "Rahul Sharma" },
  documentTypes: ["pan_card", "aadhaar_card"],
});

// Upload files
await client.uploadFile(job.jobId, {
  fileId: job.files[0].fileId,
  filePath: "./pan-card.pdf", // Node.js: reads from disk
  // or: file: File              // Browser: File object
});

// Process
await client.processJob(job.jobId);

// Poll until complete
const result = await client.waitForCompletion(job.jobId, {
  pollIntervalMs: 2000,
  timeoutMs: 120000,
});

// Check readiness (partial submission)
const readiness = await client.checkReadiness(job.jobId);

// Reprocess
await client.reprocessJob(job.jobId);
```

### Features

- Zero dependencies (uses native `fetch`)
- Works in Node.js and browser
- `waitForCompletion()` with configurable polling
- Typed responses from shared types
- Error classes: `DocProofError`, `AuthError`, `NotFoundError`, `ValidationError`
- Automatic retry on 429/5xx with exponential backoff

### Publishing

- Part of pnpm workspace
- Published to npm as `@docproof/sdk`
- Version synced with main project

---

## 9. Implementation Order

### Phase 1: Foundation (Settings + API Keys)
1. Settings API + UI
2. API Key Management (API + UI + authorizer migration)
3. OpenAPI spec + updated API Reference page

### Phase 2: Job Operations (Review + Reprocess + Partial)
4. Enhanced Review Queue + Assignments (API + UI)
5. Job Reprocessing (API + UI)
6. Partial Submission (API + UI)

### Phase 3: Analytics & Reporting
7. Daily aggregation in compile.ts
8. Enhanced Dashboard with charts
9. Per-ruleset analytics
10. CSV export

### Phase 4: SDK
11. `@docproof/sdk` package
12. SDK documentation + examples

---

## DynamoDB Schema Changes Summary

| Record | PK | SK | New? |
|--------|----|----|------|
| Settings | `SETTINGS` | `GLOBAL` | New |
| API Key | `APIKEY#<hash>` | `META` | New |
| API Key listing | gsi1pk: `APIKEYS` | gsi1sk: `keyId` | New |
| Daily Stats | `STATS#DAILY` | `<date>` | New |
| Job (extended) | `JOB#<id>` | `META` | Extended: assignedTo, priority, reprocessCount |
| Result History | `JOB#<id>` | `RESULT#<version>` | New (versioned results) |
| Reviewer Queue | gsi2pk: `REVIEWER#<email>` | gsi2sk: `<priority>#<createdAt>` | New GSI |

### New GSI Required

**gsi2:** For reviewer assignment queue
- `gsi2pk` (string) — `REVIEWER#<email>` or `REVIEWER#UNASSIGNED`
- `gsi2sk` (string) — `<priority>#<createdAt>` for priority-sorted queue

---

## New Routes Summary

| Method | Route | Auth | Feature |
|--------|-------|------|---------|
| `GET` | `/admin/settings` | Cognito | Settings |
| `PUT` | `/admin/settings` | Cognito | Settings |
| `GET` | `/admin/api-keys` | Cognito | API Keys |
| `POST` | `/admin/api-keys` | Cognito | API Keys |
| `GET` | `/admin/api-keys/{id}` | Cognito | API Keys |
| `PUT` | `/admin/api-keys/{id}` | Cognito | API Keys |
| `DELETE` | `/admin/api-keys/{id}` | Cognito | API Keys |
| `GET` | `/admin/review-queue` | Cognito | Review |
| `POST` | `/admin/jobs/{id}/assign` | Cognito | Review |
| `GET` | `/admin/reviewers` | Cognito | Review |
| `GET` | `/admin/stats/daily` | Cognito | Analytics |
| `GET` | `/admin/stats/rulesets/{id}` | Cognito | Analytics |
| `GET` | `/admin/stats/export` | Cognito | Analytics |
| `POST` | `/jobs/{id}/reprocess` | API Key | Reprocess |
| `POST` | `/admin/jobs/{id}/reprocess` | Cognito | Reprocess |
| `GET` | `/jobs/{id}/readiness` | API Key | Partial |
| `DELETE` | `/jobs/{id}/files/{fileId}` | API Key | Partial |
| `GET` | `/admin/jobs/{id}/readiness` | Cognito | Partial |
| `DELETE` | `/admin/jobs/{id}/files/{fileId}` | Cognito | Partial |
| `GET` | `/openapi.json` | None | OpenAPI |

---

## New Web Pages Summary

| Page | Route | Nav Position | Feature |
|------|-------|-------------|---------|
| Settings | `/settings` | Sidebar bottom (gear icon) | Settings |
| API Keys | `/settings/api-keys` | Settings sub-page | API Keys |
| Review Queue | `/review` | Sidebar (between Jobs and API Ref) | Review |
| Dashboard (enhanced) | `/` | Existing (redesigned) | Analytics |

**Enhanced existing pages:**
- **JobDetail** — Reprocess button, result history tab, readiness indicator
- **CreateJob** — Step-by-step with incremental upload and readiness check
- **API Reference** — Rendered from OpenAPI spec
