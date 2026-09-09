const started = Date.now();
let requests = 0;
let serverErrors = 0;
let slowRequests = 0;
let totalMs = 0;
const timings = new WeakMap<Request, { started: number; id: string }>();

export function beginRequest(request: Request) {
  const id = crypto.randomUUID();
  timings.set(request, { id, started: performance.now() });
  return id;
}
export function requestId(request: Request) {
  return timings.get(request)?.id;
}
export function finishRequest(request: Request, status: number) {
  const entry = timings.get(request);
  if (!entry) return;
  timings.delete(request);
  // Stream lifetimes are not normal HTTP request latency.
  const path = new URL(request.url).pathname;
  if (path.endsWith("/events")) return;
  const durationMs = Math.round((performance.now() - entry.started) * 100) / 100;
  requests++;
  if (status >= 500) serverErrors++;
  if (durationMs > 1000) slowRequests++;
  totalMs += durationMs;
  if (request.method !== "GET" || status >= 500 || durationMs > 1000) {
    console.log(
      JSON.stringify({
        level: status >= 500 ? "error" : durationMs > 1000 ? "warn" : "info",
        at: new Date().toISOString(),
        requestId: entry.id,
        method: request.method,
        // Do not log table access tokens, cookies, passwords, request bodies, or query values.
        path: path.replace(/\/guest\/[a-f0-9]{32}/, "/guest/:qr"),
        status,
        durationMs,
      }),
    );
  }
}
export function processDiagnostics() {
  return {
    uptimeSeconds: Math.round((Date.now() - started) / 1000),
    requests,
    serverErrors,
    slowRequests,
    averageMs: requests ? Math.round((totalMs / requests) * 100) / 100 : 0,
    rssMB: Math.round(process.memoryUsage.rss() / 1048576),
  };
}
