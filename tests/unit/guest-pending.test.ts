import { expect, test } from "bun:test";
import { mayRetryPending, PENDING_RETRY_WINDOW_MS } from "../../apps/customer/src/pending";

test("pending retries have a bounded window and reject invalid or future timestamps", () => {
  const now = Date.parse("2026-09-10T02:00:00Z");
  const at = (offset: number) => new Date(now + offset).toISOString();
  expect(mayRetryPending(at(0), now)).toBe(true);
  expect(mayRetryPending(at(-PENDING_RETRY_WINDOW_MS), now)).toBe(true);
  expect(mayRetryPending(at(-PENDING_RETRY_WINDOW_MS - 1), now)).toBe(false);
  expect(mayRetryPending(at(1), now)).toBe(false);
  expect(mayRetryPending("invalid", now)).toBe(false);
});
