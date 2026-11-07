import { API_ERROR_CODES, AUTH_ERROR_CODES } from "@chicman/shared";

/** An error with an HTTP status and a stable error code for the response body. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = "HttpError";
  }
}

/** Authenticated but not permitted. */
export const forbidden = (): HttpError => new HttpError(403, AUTH_ERROR_CODES.forbidden);

/** Not found, or not disclosed (for example another seller's resource). */
export const notFound = (code: string = API_ERROR_CODES.notFound): HttpError => new HttpError(404, code);

/** Invalid request body or value. */
export const badRequest = (code: string = API_ERROR_CODES.badRequest): HttpError => new HttpError(400, code);

/** Temporary failure; the client retries later. */
export const serviceUnavailable = (): HttpError => new HttpError(503, API_ERROR_CODES.serviceUnavailable);
