import type { Role } from "./roles.js";

/** `GET /api/v1/auth/session` response for a bootstrapped user. */
export interface AuthSessionResponse {
  userId: string;
  roles: Role[];
}
