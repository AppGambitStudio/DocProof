# DocProof — Architecture Document

> AI-Powered Document Validation Engine for Onboarding Workflows
> Open Source · AWS Serverless · SST v3

---

## 1. Problem

Companies with regulated or compliance-heavy onboarding flows (banking, insurance, NBFCs, fintech, enterprise vendors) collect, verify, and validate documents across multiple steps. This process is:

- **Manual**: Line-by-line review of each document against business rules
- **Slow**: Days per onboarding case, scaling linearly with volume
- **Error-prone**: Human reviewers miss cross-document inconsistencies
- **Opaque**: No structured audit trail of what was checked and why

## 2. Solution

DocProof is a configurable, API-first document validation engine. Define your rules. Submit your documents. Get structured validation results — with every check explained.

### Core Loop

```
Define Rules → Submit Job (metadata + files) → Extract → Validate → Review
```

### Key Principles

- **Rules-driven, not code-driven**: Ops teams define validation logic via a visual rule builder — no deployments needed to add a new onboarding type
- **LLM-native extraction**: Claude handles document understanding — no brittle template matching or OCR heuristics
- **Structured output**: Every job produces a machine-readable result with per-document status, per-field validation, cross-document checks, anomaly flags, and confidence scores
- **Human-in-the-loop**: AI triages; humans review anomalies — not every field on every document

## 3. System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Clients                              │
│   CRM / ERP / Internal Tools / Admin Console / Review UI    │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
               ▼                              ▼
┌──────────────────────┐       ┌──────────────────────────────┐
│      Job API         │       │      Admin API               │
│  (API Gateway + λ)   │       │  (API Gateway + λ)           │
│                      │       │                              │
│  POST /jobs          │       │  CRUD /rule-sets             │
│  GET  /jobs/:id      │       │  CRUD /onboarding-types      │
│  GET  /jobs          │       │  CRUD /document-types        │
│  POST /jobs/:id/files│       │  GET  /stats                 │
└──────────┬───────────┘       └──────────────────────────────┘
           │
           ▼
┌────────────────────────────────────────────────────────────────┐
│                  Processing Pipeline                           │
│                  (Single Lambda Orchestrator)                  │
│                                                                │
│  ┌────────────┐   ┌───────────────────┐   ┌────────────────┐   │
│  │  Receive   │──▶│  Extract (N docs) │──▶│   Validate     │   │
│  │  & Store   │   │  Promise.all      │   │  (Rule Engine) │   │
│  │            │   │  (N parallel)     │   │                │   │
│  └────────────┘   └───────────────────┘   └──────┬─────────┘   │
│                                                │               │
│  Processing = N+1 minimum Bedrock calls        │               │
│  (N extractions + 1 validation)     ┌──────────▼───────────┐   │
│  Each extraction may escalate       │   Compile Results    │   │
│  Haiku → Sonnet on low confidence   │   & Notify           │   │
│  Max retries: 3 per attempt         └──────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────┐
│                     Data Layer                               │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐   │
│  │  DynamoDB   │  │     S3      │  │    EventBridge      │   │
│  │             │  │             │  │                     │   │
│  │  Jobs       │  │  Uploads    │  │  Job status events  │   │
│  │  RuleSets   │  │  Extracted  │  │  Webhook delivery   │   │
│  │  Results    │  │  Results    │  │                     │   │
│  └─────────────┘  └─────────────┘  └─────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

## 4. Component Deep Dive

### 4.1 Rule Builder & Rule Engine

Rules are the heart of DocProof. A **RuleSet** defines everything needed to validate one type of onboarding.

#### RuleSet Schema

```typescript
interface RuleSet {
  id: string;
  name: string;                          // e.g., "KYC Onboarding"
  version: number;
  status: "draft" | "active" | "archived";

  // What documents are expected
  documentTypes: DocumentTypeConfig[];

  // Field-level validation rules
  fieldRules: FieldRule[];

  // Cross-document validation rules
  crossDocRules: CrossDocRule[];

  // Metadata validation (job-level)
  metadataRules: MetadataRule[];
}

interface DocumentTypeConfig {
  typeId: string;                         // e.g., "pan_card", "bank_statement"
  label: string;
  required: boolean;
  maxCount: number;                       // some types allow multiple files
  acceptedFormats: string[];              // ["pdf", "jpg", "png"]
  extractionPrompt: string;              // Claude prompt for this doc type
  expectedFields: FieldDefinition[];     // what fields to extract
}

interface FieldRule {
  id: string;
  documentType: string;
  field: string;                          // e.g., "pan_number"
  validations: Validation[];
}

interface CrossDocRule {
  id: string;
  description: string;                    // e.g., "Name on PAN must match name on Aadhaar"
  sourceDoc: string;
  sourceField: string;
  targetDoc: string;
  targetField: string;
  matchType: "exact" | "fuzzy" | "contains" | "semantic";
  threshold?: number;                     // for fuzzy/semantic matching
}

type Validation =
  | { type: "required" }
  | { type: "regex"; pattern: string }
  | { type: "length"; min?: number; max?: number }
  | { type: "enum"; values: string[] }
  | { type: "date_format"; format: string }
  | { type: "date_range"; min?: string; max?: string; relative?: string }
  | { type: "numeric_range"; min?: number; max?: number }
  | { type: "checksum"; algorithm: string }  // e.g., PAN, GSTIN checksum
  | { type: "custom_llm"; prompt: string };  // fallback to Claude for complex checks
```

#### Visual Rule Builder

The Admin Console provides a drag-and-drop interface for constructing RuleSets:

- **Document Type Manager**: Define document types with expected fields, accepted formats, and extraction prompts
- **Field Rule Editor**: Per-field validation with live preview (regex tester, date format picker, enum builder)
- **Cross-Doc Rule Mapper**: Visual connector between fields across document types (draw lines between source → target)
- **RuleSet Versioning**: Draft → Active → Archived lifecycle; active jobs reference a pinned version
- **Test Mode**: Upload sample documents and dry-run against a draft RuleSet before publishing

### 4.2 Job Lifecycle

```
┌──────────┐    ┌────────────┐    ┌────────────┐    ┌─────────────┐    ┌────────────┐    ┌───────────┐
│ CREATED  │───▶│  UPLOADING │───▶│ PROCESSING │───▶│ EXTRACTING  │───▶│ VALIDATING │───▶│ COMPLETED │
└──────────┘    └────────────┘    └────────────┘    └─────────────┘    └────────────┘    └───────────┘
                                        │                                                      │
                                        ▼                                                      ▼
                                  ┌────────────┐                                       ┌─────────────┐
                                  │   FAILED   │                                       │  REVIEW     │
                                  └────────────┘                                       │  REQUIRED   │
                                                                                       └─────────────┘
```

#### Processing Model (N+1)

For a job with **N uploaded documents**, the pipeline runs as a **single Lambda orchestrator** (not Step Functions). All steps execute sequentially within one Lambda invocation:

1. **Receive** — load job + ruleset, prepare N extraction tasks
2. **Extract** (N parallel) — all documents extracted concurrently via `Promise.all`
   - Each extraction first tries **Haiku 4.5** via Bedrock
   - If any extracted document has **LOW** confidence, **escalates to Sonnet**
   - Max retries: **3** per model attempt (with exponential backoff)
3. **Validate** — all extracted data validated against the RuleSet's field rules, cross-document rules, and anomaly detection
4. **Compile** — aggregate token usage, calculate cost, store results
5. **Notify** — publish EventBridge event, trigger webhook delivery

The pipeline is triggered by `POST /jobs/{id}/process`, which invokes the orchestrator Lambda asynchronously (fire-and-forget). The caller receives an immediate 202 response.

> **Lambda timeout:** The orchestrator has a 15-minute timeout. This works well for up to ~10 documents per job (typically under 10 minutes). For heavier workloads, consider switching to Step Functions for per-document orchestration with independent retries.

**Minimum Bedrock API calls:** N+1 (N extractions + 1 validation pass). In practice, calls may be higher due to:
- Confidence-based escalation (Haiku → Sonnet) adds 1 call per escalated document
- Semantic cross-doc matching adds 1 Sonnet call per semantic rule
- Retries on transient failures (up to 3 retries per call)

#### Job API Contract

```typescript
// Create a new validation job
POST /jobs
{
  ruleSetId: string;
  ruleSetVersion?: number;          // defaults to latest active
  externalRef?: string;             // caller's reference ID
  metadata: Record<string, any>;    // job-level metadata (applicant name, etc.)
  callbackUrl?: string;             // webhook for status updates
  files?: FileUpload[];             // inline upload (small files)
}

// Response
{
  jobId: string;
  status: "created";
  uploadUrls?: Record<string, string>;  // presigned S3 URLs for large files
}

// Upload files to a job (alternative to inline)
POST /jobs/:id/files
Content-Type: multipart/form-data

// Get job status and results
GET /jobs/:id
{
  jobId: string;
  status: "completed";
  ruleSetId: string;
  ruleSetVersion: number;
  summary: {
    totalDocuments: number;
    valid: number;
    invalid: number;
    anomalies: number;
    overallStatus: "pass" | "fail" | "review_required";
  };
  documents: DocumentResult[];
  crossDocResults: CrossDocResult[];
  metadata: Record<string, any>;
  timestamps: {
    created: string;
    processingStarted: string;
    completed: string;
  };
}
```

### 4.3 Extraction Pipeline (Claude via Bedrock)

Each document goes through a confidence-based extraction with automatic model escalation:

#### Phase 1: Document Extraction (Haiku 4.5)

Every document is first processed by **Claude Haiku 4.5** via the AWS Bedrock **Converse API** for fast, cost-effective extraction. Raw document bytes are passed directly (no base64 encoding). A single file may contain multiple distinct documents:

```typescript
// Bedrock Converse API with Haiku 4.5 + prompt caching
const command = new ConverseCommand({
  modelId: "global.anthropic.claude-haiku-4-5-20251001-v1:0",
  system: [
    { text: systemPrompt },
    { cachePoint: { type: "default" } },
  ],
  messages: [{
    role: "user",
    content: buildContentBlocks(docBuffer, mimeType), // raw Uint8Array bytes
  }],
  inferenceConfig: { maxTokens: 4000 },
});

const response = await withRetry(
  () => bedrock.send(command),
  { maxRetries: 3, baseDelayMs: 1000, isRetryable: isRetryableBedrockError },
);
```

#### Phase 2: Confidence Check & Escalation (Sonnet 4.5)

After Haiku extraction, each document analysis includes a string confidence level (`HIGH`, `MEDIUM`, or `LOW`):

- **No LOW confidence**: Accept Haiku result → return
- **Any LOW confidence**: Re-extract the **entire file** with **Claude Sonnet 4.5** (`global.anthropic.claude-sonnet-4-5-20250929-v1:0`)

Both Haiku and Sonnet token usage are tracked. Retries use `withRetry` with exponential backoff (max **3** retries).

#### Phase 3: Cross-Document Semantic Validation (Sonnet 4.5)

For `semantic` cross-doc rules, a separate Sonnet call evaluates consistency across documents:

```typescript
// Semantic matching always uses Sonnet 4.5 for accuracy
const result = await semanticMatch(config, rule.description, sourceDoc, targetDoc);
// Returns: { match, confidence, reasoning, tokenUsage }
```

#### Token Tracking & Cost Calculation

Every Bedrock call records `{ modelId, inputTokens, outputTokens, totalTokens, cost }`. At the Compile step, all token usage is aggregated:

| Model | Input (per 1K tokens) | Output (per 1K tokens) |
|-------|----------------------|------------------------|
| Haiku 4.5 | $0.0008 | $0.004 |
| Sonnet 4.5 | $0.003 | $0.015 |

The final `JobResult` includes `tokenUsage` breakdown (extraction vs validation) and total `costUsd`.

#### Cost Optimization

- **Haiku-first strategy**: All extractions start with Haiku 4.5 (4-20x cheaper than Sonnet); only escalates when confidence is insufficient
- **String-based confidence**: LOW confidence triggers escalation; MEDIUM and HIGH stay on Haiku
- **Short-circuit**: Skip LLM validation if all deterministic rules already failed
- **Parallel extraction**: N documents extracted concurrently via `Promise.all` in the orchestrator Lambda

### 4.4 Output Schema

```typescript
interface JobResult {
  jobId: string;
  overallStatus: "pass" | "fail" | "review_required";

  documents: {
    fileId: string;
    fileName: string;
    documentType: string;
    status: "valid" | "invalid" | "anomaly";
    extraction: {
      fields: Record<string, {
        value: any;
        confidence: number;
        source: string;           // region/page reference
      }>;
      quality: "good" | "fair" | "poor";
    };
    fieldResults: {
      field: string;
      rule: string;
      status: "pass" | "fail" | "warn";
      expected?: string;
      actual?: string;
      message: string;
    }[];
  }[];

  crossDocResults: {
    ruleId: string;
    description: string;
    status: "pass" | "fail" | "warn";
    confidence: number;
    sourceValue: string;
    targetValue: string;
    reasoning?: string;
  }[];

  anomalies: {
    type: "missing_doc" | "duplicate_doc" | "quality_issue"
        | "data_inconsistency" | "suspicious_pattern";
    severity: "low" | "medium" | "high";
    message: string;
    relatedDocuments: string[];
  }[];
}
```

## 5. Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| IaC / Framework | SST v3 (Ion) | TypeScript-native, fast deploys, great DX for serverless |
| Compute | AWS Lambda | Per-job scaling, zero idle cost |
| Orchestration | Single Lambda | Sequential pipeline in one execution, simple debugging, 15-min timeout |
| API | API Gateway v2 (HTTP) | Low latency, JWT auth built-in |
| Storage | S3 | Document files, extraction results |
| Database | DynamoDB | Jobs, RuleSets, Results — single-table design |
| Events | EventBridge | Job status changes, webhook delivery, async notifications |
| AI / Extraction | Claude via AWS Bedrock | Haiku 4.5 default, escalates to Sonnet on low confidence |
| Frontend — Admin | React + Vite | Rule Builder, RuleSet management |
| Frontend — Review | React + Vite | Job results viewer, anomaly review |
| Auth | Cognito / API Keys | Admin auth via Cognito, API auth via keys |

## 6. Folder Structure

```
docproof/
├── sst.config.ts                    # SST v3 app configuration
├── sst-env.d.ts
├── package.json
├── tsconfig.json
│
├── infra/                           # Infrastructure definitions
│   ├── storage.ts                   # S3 buckets, DynamoDB tables
│   ├── api.ts                      # API Gateway routes
│   ├── jobs.ts                     # Pipeline orchestrator Lambda
│   ├── events.ts                   # EventBridge rules
│   └── web.ts                      # Frontend deployments
│
├── packages/
│   ├── core/                        # Shared business logic
│   │   ├── src/
│   │   │   ├── rules/
│   │   │   │   ├── engine.ts        # Rule evaluation engine
│   │   │   │   ├── validators.ts    # Built-in validation functions
│   │   │   │   └── types.ts         # RuleSet, Rule, Validation types
│   │   │   ├── extraction/
│   │   │   │   └── extractor.ts     # Claude extraction logic
│   │   │   ├── jobs/
│   │   │   │   └── status.ts        # Status transitions
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── functions/                   # Lambda handlers
│   │   ├── src/
│   │   │   ├── api/
│   │   │   │   ├── jobs/
│   │   │   │   │   ├── create.ts    # POST /jobs
│   │   │   │   │   ├── get.ts       # GET /jobs/:id
│   │   │   │   │   ├── list.ts      # GET /jobs
│   │   │   │   │   └── upload.ts    # POST /jobs/:id/files
│   │   │   │   ├── admin/
│   │   │   │   │   ├── rulesets.ts   # CRUD /rule-sets
│   │   │   │   │   └── stats.ts     # GET /stats
│   │   │   │   └── auth/
│   │   │   │       └── api-key-authorizer.ts  # Lambda authorizer for API key
│   │   │   ├── pipeline/
│   │   │   │   ├── receive.ts       # Step 1: Receive & validate input
│   │   │   │   ├── extract.ts       # Step 2: Claude extraction
│   │   │   │   ├── validate.ts      # Step 3: Rule engine
│   │   │   │   ├── compile.ts       # Step 4: Compile results
│   │   │   │   └── notify.ts        # Step 5: Webhooks & events
│   │   │   └── events/
│   │   │       └── webhook.ts       # EventBridge → webhook delivery
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web/                         # Frontend (Admin Console + Review UI)
│       ├── src/
│       │   ├── pages/
│       │   │   ├── admin/
│       │   │   │   ├── RuleSetList.tsx
│       │   │   │   ├── RuleSetEditor.tsx
│       │   │   │   ├── DocumentTypeEditor.tsx
│       │   │   │   ├── CrossDocRuleMapper.tsx
│       │   │   │   └── TestRunner.tsx
│       │   │   ├── review/
│       │   │   │   ├── JobList.tsx
│       │   │   │   ├── JobDetail.tsx
│       │   │   │   └── AnomalyReview.tsx
│       │   │   └── dashboard/
│       │   │       └── Dashboard.tsx
│       │   ├── components/
│       │   │   ├── rule-builder/
│       │   │   │   ├── FieldRuleEditor.tsx
│       │   │   │   ├── ValidationPicker.tsx
│       │   │   │   ├── RegexTester.tsx
│       │   │   │   └── ConnectionLine.tsx
│       │   │   └── shared/
│       │   ├── lib/
│       │   │   └── api.ts
│       │   └── App.tsx
│       ├── package.json
│       └── vite.config.ts
│
├── docs/
│   ├── ARCHITECTURE.md              # This file
│   ├── API.md                       # API reference
│   ├── RULES.md                     # Rule authoring guide
│   └── DEPLOYMENT.md                # Deployment guide
│
└── examples/
    └── kyc-india/                    # Example: Indian KYC onboarding
        └── ruleset.json
```

## 7. DynamoDB Single-Table Design

```
PK                          SK                          Type        Data
─────────────────────────────────────────────────────────────────────────
RULESET#rs_001              META                        RuleSet     name, version, status, ...
RULESET#rs_001              DOCTYPE#pan_card            DocType     label, fields, prompt, ...
RULESET#rs_001              DOCTYPE#aadhaar             DocType     ...
RULESET#rs_001              FIELDRULE#fr_001            FieldRule   field, validations, ...
RULESET#rs_001              CROSSDOC#cd_001             CrossDoc    source, target, matchType, ...
RULESET#rs_001              VERSION#3                   Version     snapshot of full ruleset

JOB#job_001                 META                        Job         ruleSetId, status, metadata, ...
JOB#job_001                 FILE#file_001               File        fileName, s3Key, docType, ...
JOB#job_001                 RESULT                      Result      summary, documents, crossDoc, ...

GSI1PK                      GSI1SK
─────────────────────────────────────────────────────────────────────────
STATUS#processing           2025-03-09T10:00:00Z        Job         (query jobs by status)
RULESET#active              rs_001                      RuleSet     (query active rulesets)
EXTERNAL#crm_ref_123        JOB#job_001                 Job         (lookup by external ref)
```

## 8. Security

- **API Authentication**: API key-based auth for machine-to-machine; Cognito JWT for admin/review UI
- **API Key Auth for Job Routes**: Job endpoints (`/jobs/*`) are protected by a Lambda authorizer that validates the `X-Api-Key` header against the `DocProofApiKey` secret using timing-safe comparison
- **File Security**: S3 presigned URLs for upload/download; server-side encryption (SSE-S3); bucket policy restricts access to Lambda execution roles only
- **Data Isolation**: All resources scoped to a single AWS account; tenant isolation via RuleSet ownership if multi-tenant is needed later
- **Secrets**: DocProof API key stored in SSM Parameter Store (SecureString) via SST Secret; Claude model access via AWS Bedrock (IAM-based, no API key needed)
- **Audit**: Every job status change published to EventBridge; CloudWatch logs on all Lambda invocations

## 9. Deployment

```bash
# Install dependencies
pnpm install

# Set secrets
npx sst secret set DocProofApiKey your-api-key-here

# Deploy to dev
npx sst dev

# Deploy to production
npx sst deploy --stage production
```

## 10. Future Roadmap

- **Plugin system**: Custom extraction adapters (Textract, Google Doc AI) via a plugin interface
- **Batch jobs**: Bulk onboarding via CSV upload + parallel job creation
- **Analytics dashboard**: Pass/fail rates by RuleSet, common failure reasons, processing time trends
- **Template marketplace**: Community-contributed RuleSets (KYC India, GDPR, SOC2 vendor checks)
- **Multi-tenant mode**: Tenant isolation, per-tenant billing, shared infrastructure
- **Self-hosted LLM option**: Run extraction on local models for air-gapped environments

---

*DocProof is an open-source project by [AppGambitStudio](https://github.com/AppGambitStudio) — part of the [Antigravity Apps](https://antigravityapps.dev) portfolio.*
