import { z } from "zod"

/**
 * Runs in the browser before the application. Without this, Zod probes for
 * `eval` support with `Function("")`, and the site's CSP (which never allows
 * `unsafe-eval`) reports that probe as a violation on every page, even though
 * Zod catches the error. Browser validation works the same without it.
 */
z.config({ jitless: true })
