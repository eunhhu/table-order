import { createHash } from "node:crypto";

// Test tooling only: mirror the QR-bound public page identifier without importing the DB.
export const guestHash = (qr: string, key: string) =>
  createHash("sha256").update(`${qr}:${key}`).digest("hex");

export function guestRequestPath(path: string, cookie: string) {
  const url = new URL(path, "http://localhost");
  const qr = url.pathname.match(/^\/api\/guest\/([a-f0-9]{32})\//)?.[1];
  if (!qr) return path;
  const prefix = `guest_${qr}=`;
  const key = cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length);
  if (key) url.searchParams.set("page", guestHash(qr, key));
  return `${url.pathname}${url.search}`;
}
