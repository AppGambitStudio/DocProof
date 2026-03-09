import { resolve } from "dns/promises";
import type { EventBridgeHandler } from "aws-lambda";

const BLOCKED_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\.0\.0\.0/,
  /^::1$/,
  /^fd[0-9a-f]{2}:/i,
];

function isBlockedIp(ip: string): boolean {
  return BLOCKED_IP_PATTERNS.some((pattern) => pattern.test(ip));
}

async function validateCallbackUrl(urlString: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") {
    return false;
  }

  try {
    const addresses = await resolve(parsed.hostname);
    for (const addr of addresses) {
      if (isBlockedIp(addr)) {
        return false;
      }
    }
  } catch {
    // DNS resolution failed — block the request
    return false;
  }

  return true;
}

/**
 * Deliver webhooks for job status changes.
 */
export const handler: EventBridgeHandler<string, any, void> = async (event) => {
  const { jobId, callbackUrl, status, result } = event.detail;

  if (!callbackUrl) {
    console.log(`No callback URL for job ${jobId}, skipping webhook`);
    return;
  }

  const urlAllowed = await validateCallbackUrl(callbackUrl);
  if (!urlAllowed) {
    console.warn(
      `Blocked webhook for job ${jobId}: callback URL failed validation (${callbackUrl})`
    );
    return;
  }

  try {
    const response = await fetch(callbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "job.status_changed",
        jobId,
        status,
        result: result ?? null,
        timestamp: new Date().toISOString(),
      }),
    });

    console.log(`Webhook delivered for job ${jobId}: ${response.status}`);
  } catch (err) {
    console.error(`Webhook delivery failed for job ${jobId}:`, err);
    throw err;
  }
};
