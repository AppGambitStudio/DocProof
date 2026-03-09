# Deployment Guide

## Prerequisites

- **Node.js** >= 20
- **pnpm** >= 9
- **AWS CLI** configured with credentials (`aws configure`)
- **AWS account** with permissions for Lambda, API Gateway, DynamoDB, S3, EventBridge, Cognito, and IAM
- **AWS Bedrock access** enabled for Anthropic Claude models in your region (default: `ap-south-1`)

## Setting Secrets

DocProof uses SST secrets to manage sensitive configuration. Set these before your first deploy:

```bash
# API key for authenticating job API requests
npx sst secret set DocProofApiKey your-api-key-here
```

> **Note:** DocProof uses AWS Bedrock for Claude model access (Haiku 4.5 and Sonnet). No Anthropic API key is needed — Bedrock uses IAM-based authentication. Ensure Bedrock model access is enabled in your AWS account for the Anthropic Claude models.

Choose a strong, random string for `DocProofApiKey`. This is the value callers must pass in the `X-Api-Key` header when calling job endpoints.

Secrets are stored in AWS SSM Parameter Store as SecureString values. They are stage-scoped, so you need to set them separately for each stage (dev, production, etc.).

## Local Development

```bash
# Install dependencies
pnpm install

# Start local dev (deploys real AWS resources with live Lambda)
npx sst dev
```

`sst dev` will output your API Gateway URL. Use this URL for all API calls during development.

## Deploy to Production

```bash
npx sst deploy --stage production
```

Before deploying to production, make sure to set secrets for the production stage:

```bash
npx sst secret set DocProofApiKey your-production-api-key --stage production
```

## Cognito User Pool Setup

Admin endpoints (`/admin/*`) are protected by Cognito JWT authentication. After deployment, you need to create at least one admin user.

### Create an admin user via AWS CLI

```bash
# Get the User Pool ID from your SST outputs or AWS Console
USER_POOL_ID=ap-south-1_xxxxxxxx

# Create a user
aws cognito-idp admin-create-user \
  --user-pool-id $USER_POOL_ID \
  --username admin@example.com \
  --user-attributes Name=email,Value=admin@example.com Name=email_verified,Value=true \
  --temporary-password TempPass123!

# Set a permanent password
aws cognito-idp admin-set-user-password \
  --user-pool-id $USER_POOL_ID \
  --username admin@example.com \
  --password YourSecurePassword123! \
  --permanent
```

### Get a token for API calls

Use the Cognito hosted UI or the AWS SDK to authenticate and obtain a JWT token. Pass it as `Authorization: Bearer <token>` on admin endpoints.

## Custom Domain

To configure a custom domain for your API, add domain configuration in `infra/api.ts` using SST's domain support. Refer to the [SST docs on custom domains](https://sst.dev/docs/component/aws/apigatewayv2#custom-domains) for details.

## Monitoring

- **CloudWatch Logs**: Every Lambda function logs to CloudWatch. Filter by function name (e.g., `DocProofApi-POST-jobs`) to trace requests.
- **Lambda Logs**: The pipeline orchestrator Lambda logs each step (receive, extract, validate, compile, notify) with timing and token usage. Filter by function name `PipelineOrchestrator` to trace full job executions.
- **EventBridge**: Job status change events are published to EventBridge. You can add rules to route these to SNS, SQS, or other targets for alerting.

## Cost Considerations

DocProof runs on a serverless stack, so you pay only for what you use:

- **Lambda**: Billed per invocation and duration. Most handlers complete in under 1 second.
- **DynamoDB**: On-demand pricing by default. For predictable workloads, switch to provisioned capacity.
- **S3**: Storage costs for uploaded documents and extraction results. Consider lifecycle policies for cleanup.
- **Lambda (Pipeline)**: The orchestrator Lambda runs for the full duration of a job (typically 1-10 minutes). Billed per 1ms of execution. This replaces Step Functions, saving the per-transition cost.
- **AWS Bedrock**: The largest variable cost. Each document extraction is one Bedrock Converse API call (Haiku 4.5 default, Sonnet 4.5 on escalation). Cross-document semantic matching adds additional Sonnet calls. Monitor usage in the **AWS Billing Console** and **CloudWatch** — Bedrock uses IAM auth, not Anthropic API keys.

## Removing a Deployment

```bash
# Remove dev stage
npx sst remove

# Remove production stage
npx sst remove --stage production
```

This deletes all AWS resources created by SST. S3 buckets with data and DynamoDB tables may be retained depending on your removal policy.
