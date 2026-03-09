# Contributing to DocProof

Thanks for your interest in contributing! This guide will help you get started.

## Prerequisites

- **Node.js 20+** (see `.nvmrc`)
- **pnpm 9+** — install via `corepack enable && corepack prepare pnpm@latest --activate`
- **AWS account** with credentials configured (`aws configure`)
- **SST v3** — installed as a dev dependency

## Setup

```bash
git clone https://github.com/AppGambitStudio/docproof.git
cd docproof
pnpm install
```

Set required secrets for your SST stage:

```bash
# API key for authenticating job API requests (choose a strong, random string)
npx sst secret set DocProofApiKey your-api-key-here
```

> **Note:** DocProof uses AWS Bedrock for AI (no Anthropic API key needed). Ensure Bedrock model access is enabled in your AWS account.

Start the local development environment:

```bash
pnpm dev
```

## Project Structure

This is a pnpm monorepo with three packages:

```
packages/
  core/        # Shared types, schemas, and validation logic
  functions/   # Lambda handlers (API routes, event processors)
  web/         # Frontend application
infra/         # SST infrastructure definitions
```

## Adding a New Validator

1. Create a new file in `packages/core/src/validators/`.
2. Export a validator function that accepts a document and returns a validation result.
3. Register the validator in the core package's barrel export.
4. Add tests in a corresponding `.test.ts` file.

## Adding a New API Route

1. Define the route in the appropriate `infra/` resource file.
2. Create a handler in `packages/functions/src/`.
3. Import shared types and logic from `@docproof/core`.

## Pull Request Process

1. **Fork** the repo and create a feature branch from `main`.
2. Make your changes with clear, focused commits.
3. Ensure `pnpm typecheck` and `pnpm test` pass.
4. Open a PR against `main` with a description of what changed and why.
5. A maintainer will review your PR and may request changes.

## Code Style

- **TypeScript strict mode** is enabled — no `any` unless absolutely necessary.
- Run `pnpm lint` before submitting.
- Follow existing patterns in the codebase.
- Write tests for new validators and handlers.

## Questions?

Open an issue on GitHub if anything is unclear.
