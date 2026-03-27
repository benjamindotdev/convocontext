import { ParsedMessage } from "@/lib/types";
import { Logger, errorMeta } from "@/lib/logger";

export function formatMessagesForPrompt(messages: ParsedMessage[]): string {
  return messages
    .map((message) => {
      const time = message.timestamp ? ` (${message.timestamp})` : "";
      return `L${message.line} | ${message.speaker}${time}: ${message.text}`;
    })
    .join("\n");
}

export function trimPrompt(input: string, maxChars = 120_000): string {
  if (input.length <= maxChars) {
    return input;
  }

  return `${input.slice(0, maxChars)}\n\n[TRUNCATED DUE TO LENGTH]`;
}

type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  operationName: string;
  logger: Logger;
  inputMeta?: Record<string, unknown>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isOverloadedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();
  return (
    lowered.includes("overloaded") ||
    lowered.includes("rate limit") ||
    lowered.includes("429") ||
    lowered.includes("timeout")
  );
}

export async function runWithRetry<T>(
  operation: () => Promise<T>,
  {
    maxAttempts = 3,
    baseDelayMs = 500,
    operationName,
    logger,
    inputMeta = {},
  }: RetryOptions,
): Promise<T> {
  const started = Date.now();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      logger.info("operation_attempt", {
        operationName,
        attempt,
        maxAttempts,
        ...inputMeta,
      });

      const result = await operation();

      logger.info("operation_success", {
        operationName,
        attempt,
        elapsedMs: Date.now() - started,
        ...inputMeta,
      });

      return result;
    } catch (error) {
      const retryable = isOverloadedError(error) && attempt < maxAttempts;

      logger[retryable ? "warn" : "error"]("operation_failure", {
        operationName,
        attempt,
        maxAttempts,
        retryable,
        elapsedMs: Date.now() - started,
        ...inputMeta,
        ...errorMeta(error),
      });

      if (!retryable) {
        throw error;
      }

      const backoff = baseDelayMs * Math.pow(2, attempt - 1);
      await sleep(backoff);
    }
  }

  throw new Error(`Retry loop exited unexpectedly for ${operationName}`);
}
