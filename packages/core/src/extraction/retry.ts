/**
 * Retry utility for Bedrock API calls with exponential backoff.
 * Mirrors the production `withRetry` / `isRetryableBedrockError` pattern.
 */

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  isRetryable: (err: unknown) => boolean;
}

/**
 * Execute an async function with retry logic and exponential backoff.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { maxRetries, baseDelayMs, isRetryable } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries && isRetryable(err)) {
        const delay = baseDelayMs * 2 ** attempt;
        console.warn(
          `Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms:`,
          err instanceof Error ? err.message : "Unknown error"
        );
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }

  throw lastError;
}

/**
 * Determine if a Bedrock error is retryable (throttling, transient failures).
 */
export function isRetryableBedrockError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const name = (err as { name?: string }).name ?? "";
  const message = err.message.toLowerCase();

  // Throttling errors
  if (
    name === "ThrottlingException" ||
    name === "TooManyRequestsException" ||
    name === "ServiceQuotaExceededException" ||
    message.includes("throttl") ||
    message.includes("rate exceeded") ||
    message.includes("too many requests")
  ) {
    return true;
  }

  // Transient service errors
  if (
    name === "ServiceUnavailableException" ||
    name === "InternalServerException" ||
    message.includes("service unavailable") ||
    message.includes("internal server error") ||
    message.includes("connection reset") ||
    message.includes("socket hang up") ||
    message.includes("econnreset") ||
    message.includes("timeout")
  ) {
    return true;
  }

  return false;
}
