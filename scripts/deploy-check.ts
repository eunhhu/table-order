import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import type { Action, AdminSnapshot, CommandResult, GuestSnapshot } from "@table/contracts";
import { guestRequestPath } from "./guest-client";

if (process.env.CHECK_ISOLATED !== "yes" || process.env.PUBLIC_ORIGIN !== "https://ongi.localhost")
  throw new Error("Only the isolated ongi.localhost deployment is supported.");
const base = "https://ongi.localhost";
let staffCookie = "";
let httpErrors = 0;
const raw = (path: string, options: RequestInit = {}) =>
  fetch(`${base}${path}`, {
    ...options,
    tls: { rejectUnauthorized: false }, // The isolated Caddy uses a private test CA.
    signal: options.signal ?? AbortSignal.timeout(12000),
  });
async function request<T>(path: string, body?: unknown, cookie = staffCookie): Promise<T> {
  const response = await raw(guestRequestPath(path, cookie), {
    method: body === undefined ? "GET" : "POST",
    headers: { cookie, origin: base, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status >= 500) httpErrors++;
  assert.equal(response.status, 200, `HTTP ${response.status} ${path}`);
  if (path === "/api/login") staffCookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
  return (await response.json()) as T;
}
const act = (action: Action) =>
  request<CommandResult>("/api/admin/actions", { requestId: crypto.randomUUID(), action });
await request("/api/login", {
  login: process.env.ADMIN_LOGIN ?? "owner",
  password: process.env.ADMIN_PASSWORD,
});
const tableName = `전환-${Date.now()}`;
await act({ type: "table.save", name: tableName, zoneId: null, sort: 0 });
let snapshot = await request<AdminSnapshot>("/api/admin/snapshot");
const table = snapshot.tables.find((t) => t.name === tableName),
  menu = snapshot.menus.find((m) => m.visible && m.available);
assert(table && menu);
const entered = await raw(`/api/guest/${table.qrToken}/enter`, { redirect: "manual" });
assert.equal(entered.status, 303);
const guestCookie = entered.headers.get("set-cookie")?.split(";")[0] ?? "";
assert(guestCookie);
const html = await (await raw("/admin/")).text();
const oldAssets = [...html.matchAll(/(?:src|href)="(\/admin\/assets\/[^"]+)"/g)].map((m) => m[1]);
assert(oldAssets.length >= 2);
const controller = new AbortController();
let streamConnections = 0,
  syncMessages = 0,
  active = true;
const streams = (async () => {
  while (active) {
    try {
      const response = await raw("/api/admin/events", {
        headers: { cookie: staffCookie },
        signal: controller.signal,
      });
      assert.equal(response.status, 200);
      streamConnections++;
      const reader = response.body?.getReader();
      assert(reader);
      while (active) {
        const chunk = await reader.read();
        if (chunk.done) break;
        syncMessages += new TextDecoder().decode(chunk.value).split("event: sync").length - 1;
      }
    } catch {
      if (active) await Bun.sleep(200);
    }
  }
})();
let accepted = 0,
  failed = 0,
  healthFailures = 0,
  healthChecks = 0;
const ids = new Set<string>();
const started = performance.now();
console.log("READY: Caddy guest writes and live stream running for 120 seconds.");
while (performance.now() - started < 120000) {
  const body = {
    requestId: crypto.randomUUID(),
    lines: [{ menuId: menu.id, quantity: 1, expectedPrice: menu.price, note: "" }],
    note: "배포 전환 검증",
  };
  let confirmed = false;
  for (let attempt = 0; attempt < 3 && !confirmed; attempt++) {
    try {
      const result: CommandResult = await request<CommandResult>(
        `/api/guest/${table.qrToken}/orders`,
        body,
        guestCookie,
      );
      const orderId: string = (result.data as { orderId: string }).orderId;
      assert(!ids.has(orderId));
      ids.add(orderId);
      accepted++;
      confirmed = true;
    } catch {
      if (attempt === 2) failed++;
      else await Bun.sleep(250);
    }
  }
  for (let i = 0; i < 5; i++) {
    healthChecks++;
    try {
      assert.equal((await raw("/api/health/ready")).status, 200);
    } catch {
      healthFailures++;
    }
    await Bun.sleep(180);
  }
}
active = false;
controller.abort();
await streams;
snapshot = await request<AdminSnapshot>("/api/admin/snapshot");
const visit = snapshot.visits.find((v) => v.tableId === table.id);
assert(visit);
const orders = snapshot.orders.filter((o) => o.visitId === visit.id);
assert.equal(orders.length, accepted);
assert.equal(visit.total, accepted * menu.price);
const guest = await request<GuestSnapshot>(
  `/api/guest/${table.qrToken}/snapshot`,
  undefined,
  guestCookie,
);
assert.equal(guest.orders.length, accepted);
for (const asset of oldAssets) assert.equal((await raw(asset)).status, 200);
await mkdir("output/deployment", { recursive: true });
const report = {
  at: new Date().toISOString(),
  accepted,
  failed,
  httpErrors,
  healthChecks,
  healthFailures,
  streamConnections,
  syncMessages,
  oldAssetsPreserved: oldAssets.length,
  amount: visit.total,
  databaseAndGuestMatch: true,
};
await Bun.write("output/deployment/blue-green.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (failed || httpErrors || healthFailures) process.exitCode = 1;
