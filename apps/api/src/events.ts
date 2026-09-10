import { db, schema as s } from "@table/db";
import { asc, eq, gt } from "drizzle-orm";

type Listener = {
  visitId: string | null;
  tableId: string | null;
  send: (event: string, data: unknown, id?: number) => void;
  close: () => void;
};
const listeners = new Set<Listener>();
let cursor: number | undefined;
let polling = false;
export function eventStream(
  request: Request,
  scope: { visitId?: string; tableId?: string } | null,
  expiresAt = Date.now() + 12 * 3600_000,
) {
  let cleanup = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const encoder = new TextEncoder();
      const listener: Listener = {
        visitId: scope?.visitId ?? null,
        tableId: scope?.tableId ?? null,
        send(event, data, id) {
          if (closed) return;
          try {
            controller.enqueue(
              encoder.encode(
                `${id === undefined ? "" : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
              ),
            );
          } catch {
            cleanup();
          }
        },
        close: () => cleanup(),
      };
      const heartbeat = setInterval(() => {
        if (Date.now() >= expiresAt) {
          cleanup();
          return;
        }
        listener.send("heartbeat", { at: Date.now() });
      }, 15_000);
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        listeners.delete(listener);
        request.signal.removeEventListener("abort", cleanup);
        try {
          controller.close();
        } catch {}
      };
      request.signal.addEventListener("abort", cleanup, { once: true });
      listeners.add(listener);
      // Subscribe BEFORE asking for a snapshot: changes while it is fetched remain visible.
      // Every reconnect (including a new device or expired cursor) backfills canonical state.
      listener.send("sync", { reason: "connected" });
      if (request.signal.aborted) cleanup();
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
}
export function startEventPump() {
  const timer = setInterval(async () => {
    if (polling || !listeners.size) return;
    polling = true;
    try {
      if (cursor === undefined) {
        const [state] = await db
          .select({ revision: s.settings.revision })
          .from(s.settings)
          .where(eq(s.settings.id, 1));
        cursor = state.revision;
        // Existing work comes from the canonical snapshot; old event history need not replay.
        for (const listener of listeners) listener.send("sync", { revision: cursor }, cursor);
        return;
      }
      // Revisions are serialized by the store row lock in operations.ts.
      const events = await db
        .select({
          id: s.events.id,
          visitId: s.events.visitId,
          tableId: s.visits.tableId,
          type: s.events.type,
        })
        .from(s.events)
        .leftJoin(s.visits, eq(s.visits.id, s.events.visitId))
        .where(gt(s.events.id, cursor))
        .orderBy(asc(s.events.id))
        .limit(500);
      if (events.length) {
        cursor = events.at(-1)?.id ?? cursor;
        const global = events.some((e) => !e.visitId);
        const affectedVisits = new Set(events.map((e) => e.visitId));
        const affectedTables = new Set(events.map((e) => e.tableId));
        for (const listener of listeners)
          if (
            global ||
            (listener.visitId === null && listener.tableId === null) ||
            affectedVisits.has(listener.visitId) ||
            affectedTables.has(listener.tableId)
          )
            listener.send("sync", { revision: cursor }, cursor);
      } else {
        const [state] = await db
          .select({ revision: s.settings.revision })
          .from(s.settings)
          .where(eq(s.settings.id, 1));
        if (state.revision > cursor) {
          cursor = state.revision;
          for (const listener of listeners) listener.send("sync", { revision: cursor }, cursor);
        }
      }
    } catch {
      // Stored orders remain in PostgreSQL. Browser HTTP reconciliation is independent.
      for (const listener of listeners) listener.send("retrying", {});
    } finally {
      polling = false;
    }
  }, 750);
  timer.unref();
  return () => {
    clearInterval(timer);
    for (const l of [...listeners]) l.close();
  };
}
