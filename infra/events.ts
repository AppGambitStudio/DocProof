import { storage } from "./storage";

export const bus = new sst.aws.Bus("DocProofBus");

bus.subscribe("DocProofWebhook", {
  handler: "packages/functions/src/events/webhook.handler",
  link: [storage.table],
  timeout: "30 seconds",
}, {
  pattern: {
    source: ["docproof.jobs"],
    detailType: [
      "job.completed",
      "job.failed",
      "job.review_required",
      "job.approved",
      "job.rejected",
    ],
  },
});

export const events = { bus };