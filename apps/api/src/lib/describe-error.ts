/** Error type, code, and stack frames, without the message. Shared by the API error handler and the worker. */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return "Unhandled non-Error value";
  const code = (err as { code?: unknown }).code;
  const frames = (err.stack ?? "")
    .split("\n")
    .filter((line) => line.trimStart().startsWith("at "))
    .slice(0, 8)
    .join("\n");
  return `Unhandled ${err.name}${typeof code === "string" ? ` (${code})` : ""}${frames ? `\n${frames}` : ""}`;
}
