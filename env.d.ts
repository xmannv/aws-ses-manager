/**
 * Type declarations for Cloudflare Worker environment variables / secrets.
 *
 * These values are provided at runtime via:
 *  - local dev: a `.dev.vars` file (see `.dev.vars.example`)
 *  - production: Cloudflare dashboard "Variables and Secrets" (or `wrangler secret put`)
 *
 * Accessed in server code through `import { env } from "cloudflare:workers"`.
 */
declare module 'cloudflare:workers' {
  export const env: {
    /** AWS IAM access key id with `ses:DeleteSuppressedDestination` permission. */
    AWS_ACCESS_KEY_ID: string
    /** AWS IAM secret access key. */
    AWS_SECRET_ACCESS_KEY: string
    /** AWS region where the SES suppression list lives, e.g. `us-east-1`. */
    AWS_REGION: string
    /** Shared password that unlocks the app UI. */
    APP_PASSWORD: string
  }
}
