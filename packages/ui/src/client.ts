import { createEffect, createSignal, onCleanup } from "solid-js";
import { createStore, reconcile } from "solid-js/store";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  body?: unknown,
  options?: { method?: string; signal?: AbortSignal },
): Promise<T> {
  const response = await fetch(path, {
    method: options?.method ?? (body === undefined ? "GET" : "POST"),
    credentials: "same-origin",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: options?.signal ?? AbortSignal.timeout(12000),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(
      data.error ?? "UNKNOWN",
      data.message ?? "요청을 처리하지 못했어요.",
      response.status,
    );
  return data as T;
}
export type Connection = "loading" | "live" | "reconnecting" | "offline";
export function createLive<T extends { revision: number }>(
  path: () => string,
  stream: () => string | null,
  enabled: () => boolean = () => true,
) {
  const [state, setState] = createStore<{ snapshot: T | undefined }>({ snapshot: undefined });
  const data = () => state.snapshot;
  const [error, setError] = createSignal<Error>();
  const [connection, setConnection] = createSignal<Connection>("loading");
  const [lastSuccess, setLastSuccess] = createSignal<Date>();
  let running = false;
  let refreshAgain = false;
  let generation = 0;
  let failures = 0;
  async function refresh() {
    if (!enabled()) return;
    if (running) {
      refreshAgain = true;
      return;
    }
    running = true;
    const currentGeneration = generation;
    try {
      const next = await api<T>(path());
      if (currentGeneration === generation) {
        // Preserve rows by id so live updates do not replace a button beneath a finger.
        if (!state.snapshot || next.revision >= state.snapshot.revision)
          setState(reconcile({ snapshot: next }, { key: "id" }));
        setError(undefined);
        failures = 0;
        setConnection("live");
        setLastSuccess(new Date());
      }
    } catch (e) {
      if (currentGeneration === generation) {
        setError(e as Error);
        failures++;
        setConnection("offline");
      }
    } finally {
      running = false;
      if (refreshAgain) {
        refreshAgain = false;
        void refresh();
      }
    }
  }
  createEffect(() => {
    generation++;
    if (!enabled()) return;
    const endpoint = stream();
    let queued: ReturnType<typeof setTimeout> | undefined;
    let events: EventSource | undefined;
    const schedule = () => {
      clearTimeout(queued);
      queued = setTimeout(() => void refresh(), 150);
    };
    if (endpoint) {
      events = new EventSource(endpoint);
      events.addEventListener("sync", schedule);
      events.addEventListener("retrying", () => setConnection("reconnecting"));
      events.onerror = () => setConnection("reconnecting");
    }
    void refresh();
    let timer: ReturnType<typeof setTimeout>;
    let disposed = false;
    const poll = () => {
      if (disposed) return;
      timer = setTimeout(
        async () => {
          if (document.visibilityState === "visible") await refresh();
          poll();
        },
        Math.min(30000, 6000 * 2 ** Math.min(failures, 3)) + Math.random() * 1500,
      );
    };
    poll();
    const resume = () => {
      if (document.visibilityState === "visible") schedule();
    };
    window.addEventListener("online", schedule);
    document.addEventListener("visibilitychange", resume);
    onCleanup(() => {
      disposed = true;
      generation++;
      events?.close();
      clearTimeout(timer);
      clearTimeout(queued);
      window.removeEventListener("online", schedule);
      document.removeEventListener("visibilitychange", resume);
    });
  });
  return { data, error, connection, lastSuccess, refresh };
}
export const time = (value: string | Date) =>
  new Date(value).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
export const minutes = (value: string) =>
  Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60000));
export function storeDraft<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
export function readDraft<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
export function createRememberedString(key: string, fallback = "") {
  const stored = readDraft<unknown>(key, fallback);
  const state = createSignal(typeof stored === "string" ? stored : fallback);
  createEffect(() => {
    storeDraft(key, state[0]());
  });
  return state;
}
