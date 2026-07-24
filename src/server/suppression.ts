import { createServerFn } from '@tanstack/react-start'
import { AwsClient } from 'aws4fetch'
import { env } from 'cloudflare:workers'
import { parseEmails } from '#/lib/emails'

/**
 * Constant-time string comparison to avoid leaking the password length/content
 * through response timing. Returns true only if both strings match exactly.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

/**
 * Server function: check the app password against APP_PASSWORD on the Worker.
 * The password is never compared on the client, so APP_PASSWORD stays server-side.
 */
export const verifyPassword = createServerFn({ method: 'POST' })
  .validator((data: { password: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const expected = env.APP_PASSWORD
    if (!expected) {
      throw new Error('Server misconfigured: APP_PASSWORD is not set.')
    }
    return { ok: safeEqual(data.password ?? '', expected) }
  })

/** Outcome for a single email address. */
export type RemovalStatus = 'removed' | 'not_found' | 'error'

export interface RemovalResult {
  email: string
  status: RemovalStatus
  message?: string
}

export interface RemoveResponse {
  results: RemovalResult[]
  summary: { removed: number; notFound: number; errored: number; total: number }
  /** Addresses that were rejected before hitting AWS (malformed input). */
  invalid: string[]
}

/** Cap per request to stay within Worker subrequest limits and keep runs snappy. */
const MAX_EMAILS_PER_REQUEST = 200
/** Delay between delete calls; SES management API allows ~1 request/sec. */
const THROTTLE_MS = 250
/** Retries when SES throttles us (HTTP 429 / TooManyRequestsException). */
const MAX_RETRIES = 3

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Delete a single suppressed destination via the SES v2 REST API.
 * Returns the per-email status. Retries with backoff on throttling.
 */
async function deleteOne(
  aws: AwsClient,
  region: string,
  email: string,
): Promise<RemovalResult> {
  const url = `https://email.${region}.amazonaws.com/v2/email/suppression/addresses/${encodeURIComponent(
    email,
  )}`

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res: Response
    try {
      res = await aws.fetch(url, { method: 'DELETE' })
    } catch (err) {
      return {
        email,
        status: 'error',
        message: err instanceof Error ? err.message : 'Network error',
      }
    }

    if (res.ok) {
      return { email, status: 'removed' }
    }

    // Address isn't on the suppression list — treat as a benign no-op.
    if (res.status === 404) {
      return { email, status: 'not_found' }
    }

    // Throttled: back off and retry.
    if (res.status === 429 && attempt < MAX_RETRIES) {
      await sleep(THROTTLE_MS * (attempt + 1) * 2)
      continue
    }

    // Other errors: surface AWS's message.
    let message = `AWS returned HTTP ${res.status}`
    try {
      const body = (await res.json()) as { message?: string; Message?: string }
      message = body.message ?? body.Message ?? message
    } catch {
      // response wasn't JSON; keep the generic message
    }
    return { email, status: 'error', message }
  }

  return { email, status: 'error', message: 'Exhausted retries' }
}

/**
 * Server function: verify the app password, then remove each provided email
 * from the SES suppression list sequentially (throttled).
 *
 * Runs only on the Worker, so AWS credentials never reach the client.
 */
export const removeSuppressed = createServerFn({ method: 'POST' })
  .validator((data: { password: string; emails: string }) => data)
  .handler(async ({ data }): Promise<RemoveResponse> => {
    // 1. Auth gate. Reject before doing any AWS work.
    if (!env.APP_PASSWORD || data.password !== env.APP_PASSWORD) {
      throw new Error('Unauthorized: incorrect password.')
    }

    // 2. Parse + validate the address list.
    const { valid, invalid } = parseEmails(data.emails ?? '')

    if (valid.length === 0) {
      return {
        results: [],
        summary: { removed: 0, notFound: 0, errored: 0, total: 0 },
        invalid,
      }
    }

    if (valid.length > MAX_EMAILS_PER_REQUEST) {
      throw new Error(
        `Too many addresses (${valid.length}). Limit is ${MAX_EMAILS_PER_REQUEST} per request.`,
      )
    }

    // 3. Build the signed AWS client.
    const region = env.AWS_REGION
    const aws = new AwsClient({
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      region,
      service: 'ses',
    })

    // 4. Delete each address, throttled to respect SES rate limits.
    const results: RemovalResult[] = []
    for (let i = 0; i < valid.length; i++) {
      results.push(await deleteOne(aws, region, valid[i]))
      if (i < valid.length - 1) {
        await sleep(THROTTLE_MS)
      }
    }

    // 5. Tally.
    const summary = {
      removed: results.filter((r) => r.status === 'removed').length,
      notFound: results.filter((r) => r.status === 'not_found').length,
      errored: results.filter((r) => r.status === 'error').length,
      total: results.length,
    }

    return { results, summary, invalid }
  })
