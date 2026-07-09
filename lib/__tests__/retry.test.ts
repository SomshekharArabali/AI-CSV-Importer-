import { describe, expect, it, vi } from "vitest";
import { MAX_BATCH_ATTEMPTS, retryDelayMs, withRetry } from "@/lib/import-helpers";

/** Test-only sleep that resolves immediately but still records calls. */
function fakeSleep(calls: number[]) {
  return async (ms: number) => {
    calls.push(ms);
  };
}

describe("retryDelayMs", () => {
  it("doubles the delay for each subsequent attempt", () => {
    expect(retryDelayMs(1)).toBe(500);
    expect(retryDelayMs(2)).toBe(1000);
    expect(retryDelayMs(3)).toBe(2000);
  });
});

describe("withRetry", () => {
  it("returns the result immediately on first success without retrying", async () => {
    const sleeps: number[] = [];
    const fn = vi.fn().mockResolvedValue("ok");

    const result = await withRetry(fn, { maxAttempts: 3, sleep: fakeSleep(sleeps) });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it("retries on failure and eventually succeeds", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls < 3) {
        throw new Error(`fail #${calls}`);
      }
      return "recovered";
    });

    const onRetry = vi.fn();

    const result = await withRetry(fn, { maxAttempts: 3, onRetry, sleep: fakeSleep(sleeps) });

    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
    // Retried after attempt 1 and attempt 2, not after the final (successful) attempt.
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry.mock.calls[0][0]).toBe(1);
    expect(onRetry.mock.calls[1][0]).toBe(2);
    expect(sleeps).toEqual([500, 1000]);
  });

  it("throws the last error once all attempts are exhausted", async () => {
    const sleeps: number[] = [];
    const fn = vi.fn().mockRejectedValue(new Error("still broken"));
    const onRetry = vi.fn();

    await expect(
      withRetry(fn, { maxAttempts: MAX_BATCH_ATTEMPTS, onRetry, sleep: fakeSleep(sleeps) })
    ).rejects.toThrow("still broken");

    expect(fn).toHaveBeenCalledTimes(MAX_BATCH_ATTEMPTS);
    // No retry notice after the final failed attempt — nothing left to retry into.
    expect(onRetry).toHaveBeenCalledTimes(MAX_BATCH_ATTEMPTS - 1);
  });

  it("does not call sleep after the last attempt fails", async () => {
    const sleeps: number[] = [];
    const fn = vi.fn().mockRejectedValue(new Error("nope"));

    await expect(
      withRetry(fn, { maxAttempts: 2, sleep: fakeSleep(sleeps) })
    ).rejects.toThrow("nope");

    expect(sleeps).toEqual([500]);
  });
});
