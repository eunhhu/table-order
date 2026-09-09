export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function requireValue<T>(
  value: T | null | undefined,
  message = "항목을 찾을 수 없어요.",
): T {
  if (value === null || value === undefined) throw new AppError(404, "NOT_FOUND", message);
  return value;
}
export function assert(
  condition: unknown,
  message: string,
  code = "CONFLICT",
  status = 409,
): asserts condition {
  if (!condition) throw new AppError(status, code, message);
}
