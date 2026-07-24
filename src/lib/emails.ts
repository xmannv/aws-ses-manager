/**
 * Helpers for turning raw textarea input into a clean, validated email list.
 * Shared between the client (for live preview) and the server (source of truth).
 */

// Pragmatic email shape check. Not RFC-perfect on purpose: it rejects obvious
// garbage while accepting the addresses SES would actually have suppressed.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface ParsedEmails {
  /** Unique, well-formed addresses in first-seen order. */
  valid: string[]
  /** Entries that failed validation (for surfacing back to the user). */
  invalid: string[]
}

/**
 * Split raw text (newline / comma / semicolon / whitespace separated) into
 * a de-duplicated list, classifying each entry as valid or invalid.
 *
 * De-duplication is case-insensitive but preserves the original casing of the
 * first occurrence, since SES stores addresses case-sensitively.
 */
export function parseEmails(raw: string): ParsedEmails {
  const seen = new Set<string>()
  const valid: string[] = []
  const invalid: string[] = []

  for (const token of raw.split(/[\s,;]+/)) {
    const email = token.trim()
    if (email === '') continue

    const key = email.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    if (EMAIL_RE.test(email)) {
      valid.push(email)
    } else {
      invalid.push(email)
    }
  }

  return { valid, invalid }
}

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email)
}
