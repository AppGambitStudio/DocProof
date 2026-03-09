# DocProof

**AI-Powered Document Validation Engine for Onboarding Workflows**

[![Open Source](https://img.shields.io/badge/Open%20Source-MIT-green.svg)](LICENSE)
[![Built with SST](https://img.shields.io/badge/Built%20with-SST%20v3-orange.svg)](https://sst.dev)
[![Powered by Claude](https://img.shields.io/badge/Powered%20by-Claude-blueviolet.svg)](https://anthropic.com)

---

DocProof automates document collection, extraction, and validation for onboarding workflows. Define your rules. Submit your documents. Get structured results — with every check explained.

> **From days to minutes.** Replace line-by-line manual document review with AI-powered extraction and rule-based validation. Humans review anomalies, not every field.

## How It Works

```
Define Rules → Submit Job (metadata + N files) → Process → Extract (N parallel) → Validate (1 pass) → Review Anomalies
```

1. **Admin defines a RuleSet** — what documents are needed, what fields to extract, what validations to run, and how documents relate to each other
2. **System submits a Job** — via API with metadata and document files (from CRM, ERP, or internal tools)
3. **Claude extracts (N steps)** — each document is extracted in parallel using [Haiku 4.5 via Bedrock](https://aws.amazon.com/bedrock/pricing/); automatically escalates to Sonnet if confidence is LOW
4. **Rule Engine validates (1 step)** — all extracted data validated together: field-level checks (format, range, checksum), cross-document consistency (name matching, date alignment), and anomaly detection
5. **Results returned** — per-document status, per-field validation, cross-doc checks, anomaly flags, confidence scores, token usage, and job cost in USD

## Use Cases

- **KYC Onboarding** — PAN + Aadhaar + address proof validation for Indian financial services
- **Vendor Onboarding** — GST certificate + incorporation docs + bank details verification
- **Insurance Claims** — Policy document + claim form + supporting evidence validation
- **HR Onboarding** — Education certificates + employment letters + identity verification
- **Loan Processing** — Income proof + property documents + identity validation

## Architecture

| Layer | Technology |
|-------|-----------|
| Framework | SST v3 (Ion) — TypeScript-native serverless |
| Compute | AWS Lambda |
| Orchestration | Single Lambda (sequential pipeline) |
| API | API Gateway v2 |
| Storage | S3 + DynamoDB (single-table) |
| Events | EventBridge |
| AI | Claude via AWS Bedrock (Haiku 4.5 + Sonnet) |
| Frontend | React + Vite |

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full system design.

### Why Serverless?

DocProof is built entirely on AWS serverless services. This is a deliberate architectural choice:

- **Cost** — Zero idle cost. You pay only when jobs are processing. A typical KYC job (3 documents) costs under $0.01 in infrastructure — the Bedrock API calls are the primary expense. No servers running 24/7 waiting for work.
- **Security** — No long-lived servers to patch or harden. Each Lambda execution is an isolated micro-VM. S3 and DynamoDB encrypt at rest by default. Cognito handles auth — no password storage in your application. API keys are stored in SSM SecureString.
- **Scalability** — Handles 1 job or 1,000 concurrent jobs with no configuration changes. Lambda scales automatically per-request. DynamoDB on-demand scales with traffic. No capacity planning needed.
- **Operational simplicity** — No Docker, no Kubernetes, no EC2 instances, no load balancers. Deploy with `npx sst deploy`. Monitor with CloudWatch. The entire infrastructure is defined in ~200 lines of TypeScript.

## Quick Start

### Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9
- AWS account with credentials configured (Bedrock access enabled in ap-south-1)

### Setup

```bash
# Clone
git clone https://github.com/AppGambitStudio/docproof.git
cd docproof

# Install
pnpm install

# Set your API key (used to authenticate job API requests)
npx sst secret set DocProofApiKey your-api-key-here

# Start local dev
npx sst dev
```

### Create an Admin User

Admin endpoints (`/admin/*`) are protected by Cognito. After `sst dev` starts, create your first admin user using the seed script:

```bash
# The User Pool ID is printed in sst dev output
./scripts/seed-admin.sh <user-pool-id> admin@example.com YourSecurePass123!
```

Then get a JWT token for API calls:

```bash
aws cognito-idp admin-initiate-auth \
  --user-pool-id <user-pool-id> \
  --client-id <client-id> \
  --auth-flow ADMIN_USER_PASSWORD_AUTH \
  --auth-parameters USERNAME=admin@example.com,PASSWORD=YourSecurePass123!
```

Use the `IdToken` from the response as `Authorization: Bearer <token>` on admin endpoints.

### Create Your First Job

```bash
# 1. Create a ruleset (or use the KYC India example)
# Note: <your-api-url> is provided by `sst dev` output
curl -X POST <your-api-url>/admin/rule-sets \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <cognito-token>" \
  -d @examples/kyc-india/ruleset.json

# 2. Submit a validation job
curl -X POST <your-api-url>/jobs \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: your-api-key" \
  -d '{
    "ruleSetId": "kyc_india_individual",
    "metadata": { "applicantName": "Rahul Sharma" },
    "documentTypes": ["pan_card", "aadhaar_card", "address_proof"]
  }'

# 3. Upload documents to the presigned URLs returned

# 4. Start processing
curl -X POST <your-api-url>/jobs/{jobId}/process \
  -H "X-Api-Key: your-api-key"

# 5. Check results (poll until status is "completed")
curl <your-api-url>/jobs/{jobId} \
  -H "X-Api-Key: your-api-key"
```

## Project Structure

```
docproof/
├── sst.config.ts          # SST v3 configuration
├── infra/                 # Infrastructure (S3, DynamoDB, API, Lambda pipeline)
├── packages/
│   ├── core/              # Business logic (rule engine, extraction, types)
│   ├── functions/         # Lambda handlers (API + pipeline steps)
│   └── web/               # Admin Console + Review UI
├── examples/              # Example rulesets (KYC India)
└── docs/                  # Architecture, API reference, deployment guide
```

## Lambda Timeout Note

The processing pipeline runs as a single Lambda function (15-minute timeout). This works well for workloads with up to **~10 documents per job**, which typically complete in under 10 minutes. Each document extraction takes 5-30 seconds depending on complexity and model escalation.

For heavier workloads (large document sets, complex rulesets with many semantic cross-doc rules), consider:
- Increasing the Lambda timeout (max 15 min)
- Switching to **AWS Step Functions** for per-document orchestration with independent retries and longer execution times

## Key Features

- **Visual Rule Builder (planned)** — drag-and-drop interface — under development
- **Claude-Powered Extraction** — LLM-native document understanding, not template-based OCR
- **Cross-Document Validation** — verify consistency across related documents (name matching, date alignment, address correlation)
- **Anomaly Detection** — missing docs, duplicates, quality issues, suspicious patterns
- **API-First** — integrate with any CRM, ERP, or internal system
- **Cost Optimized** — configurable model selection per document type
- **Audit Trail** — every check documented with reasoning and confidence scores

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT — see [LICENSE](LICENSE) for details.

---

*Part of the [Antigravity Apps](https://antigravityapps.dev) portfolio by [AppGambitStudio](https://github.com/AppGambitStudio)*
