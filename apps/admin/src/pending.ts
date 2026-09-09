import { commandSchema } from "@table/contracts";

const key = "table-admin-pending";
export function readPending() {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const command = commandSchema.safeParse(parsed);
    if (
      !command.success ||
      typeof parsed !== "object" ||
      !parsed ||
      !("staffId" in parsed) ||
      typeof parsed.staffId !== "string"
    ) {
      sessionStorage.removeItem(key);
      return null;
    }
    return { ...command.data, staffId: parsed.staffId };
  } catch {
    return null;
  }
}
export function savePending(value: NonNullable<ReturnType<typeof readPending>>) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
export function clearPending() {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* Browser storage may be disabled. */
  }
}
