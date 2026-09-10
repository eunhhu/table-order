export const PENDING_RETRY_WINDOW_MS = 15 * 60_000;

export function mayRetryPending(submittedAt: string, now = Date.now()) {
  const age = now - Date.parse(submittedAt);
  return Number.isFinite(age) && age >= 0 && age <= PENDING_RETRY_WINDOW_MS;
}
