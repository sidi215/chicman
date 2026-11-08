import type { z } from "zod";

import { badRequest } from "./http-error.js";

/**
 * Parses a request body with a strict schema. Unknown or protected fields
 * and invalid values → `400`; the caller only ever sees the validated
 * object, so writes are never built from the raw body.
 */
export function parseOrBadRequest<Schema extends z.ZodType>(schema: Schema, value: unknown): z.output<Schema> {
  const result = schema.safeParse(value);
  if (!result.success) throw badRequest();
  return result.data;
}
