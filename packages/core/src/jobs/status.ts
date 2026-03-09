import type { JobStatus } from "../rules/types";

const validTransitions: Record<JobStatus, JobStatus[]> = {
  created: ["uploading", "processing", "failed"],
  uploading: ["processing", "failed"],
  processing: ["extracting", "failed"],
  extracting: ["validating", "failed"],
  validating: ["completed", "review_required", "failed"],
  completed: [],
  failed: [],
  review_required: ["completed"],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return validTransitions[from]?.includes(to) ?? false;
}

export function assertTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `Invalid job status transition: ${from} → ${to}`
    );
  }
}

export function isTerminal(status: JobStatus): boolean {
  return status === "completed" || status === "failed";
}
