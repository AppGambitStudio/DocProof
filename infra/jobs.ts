import { storage } from "./storage";
import { bus } from "./events";

/**
 * Single Lambda orchestrator for the document processing pipeline.
 *
 * Runs all steps in one execution: Receive → Extract (parallel) → Validate → Compile → Notify
 *
 * This is designed for workloads with up to ~10 documents per job (typically under 10 minutes).
 * For heavier workloads, consider increasing the timeout or switching to Step Functions.
 */
const orchestrator = new sst.aws.Function("PipelineOrchestrator", {
  handler: "packages/functions/src/pipeline/orchestrator.handler",
  link: [storage.table, storage.bucket, bus],
  timeout: "15 minutes",
  memory: "512 MB",
  permissions: [
    {
      actions: ["bedrock:InvokeModel"],
      resources: ["*"],
    },
    {
      actions: ["events:PutEvents"],
      resources: ["*"],
    },
  ],
});

export const pipeline = {
  orchestrator,
};
