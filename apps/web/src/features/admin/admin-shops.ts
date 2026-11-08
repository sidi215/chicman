import { applicationRejectionSchema, internalDecisionSchema, SHOP_ERROR_CODES, type ShopStatus } from "@chicman/shared"

import type { ApiResult } from "@/lib/api-client"

/** Administrator shop decisions (spec 06). */
export type ShopDecisionAction = "approve" | "reject" | "suspend" | "reinstate"
export type ChangeRequestAction = "approve" | "reject"

/** The decisions an administrator can take from a status (others → `409`). */
export function availableDecisions(status: ShopStatus): ShopDecisionAction[] {
  switch (status) {
    case "PENDING":
      return ["approve", "reject"]
    case "APPROVED":
      return ["suspend"]
    case "SUSPENDED":
      return ["reinstate"]
    case "REJECTED":
      // Waiting for the owner to correct and resubmit.
      return []
  }
}

/**
 * Which reason a decision asks for: the application rejection takes the
 * owner-facing `applicantReason` only; every other decision takes the
 * internal `internalReason`.
 */
export function reasonFieldFor(action: ShopDecisionAction): "applicantReason" | "internalReason" {
  return action === "reject" ? "applicantReason" : "internalReason"
}

export type DecisionErrorKey = "reasonLength" | "reasonInvalid" | "noteLength" | "noteInvalid"
export type DecisionBody = { applicantReason: string; internalNote?: string } | { internalReason: string; internalNote?: string }
export type DecisionFormResult = { ok: true; body: DecisionBody } | { ok: false; errors: Partial<Record<"reason" | "internalNote", DecisionErrorKey>> }

/**
 * Builds the decision body with exactly one reason of the right kind (the
 * same schemas as the API). An empty note is left out.
 */
export function buildDecision(action: ShopDecisionAction | "change-request", reason: string, note: string): DecisionFormResult {
  const field = action === "reject" ? "applicantReason" : "internalReason"
  const candidate: Record<string, string> = { [field]: reason }
  if (note.trim() !== "") candidate.internalNote = note
  const result = (field === "applicantReason" ? applicationRejectionSchema : internalDecisionSchema).safeParse(candidate)
  if (result.success) return { ok: true, body: result.data as DecisionBody }
  const errors: Partial<Record<"reason" | "internalNote", DecisionErrorKey>> = {}
  for (const issue of result.error.issues) {
    const isNote = issue.path[0] === "internalNote"
    const key = isNote ? "internalNote" : "reason"
    if (errors[key]) continue
    const length = issue.code === "too_small" || issue.code === "too_big"
    errors[key] = isNote ? (length ? "noteLength" : "noteInvalid") : length ? "reasonLength" : "reasonInvalid"
  }
  return { ok: false, errors }
}

export type AdminOutcome<T> =
  | { state: "ok"; data: T }
  | { state: "forbidden" }
  /** The administrator owns this shop (`403 SHOP_SELF_ADMINISTRATION_FORBIDDEN`). */
  | { state: "own-shop" }
  | { state: "not-found" }
  | { state: "conflict" }
  | { state: "invalid" }
  | { state: "signed-out" }
  | { state: "unavailable" }
  | { state: "error" }

export function interpretAdminResult<T>(result: ApiResult<T>): AdminOutcome<T> {
  switch (result.kind) {
    case "ok":
      return { state: "ok", data: result.data }
    case "unauthorized":
      return { state: "signed-out" }
    case "forbidden":
      return result.code === SHOP_ERROR_CODES.selfAdministrationForbidden ? { state: "own-shop" } : { state: "forbidden" }
    case "auth-unavailable":
    case "network-error":
      return { state: "unavailable" }
    case "error":
      if (result.status === 404) return { state: "not-found" }
      if (result.status === 409) return { state: "conflict" }
      if (result.status === 400) return { state: "invalid" }
      if (result.status === 503) return { state: "unavailable" }
      return { state: "error" }
  }
}
