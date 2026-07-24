import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Heading } from '@astryxdesign/core/Heading'
import { Text } from '@astryxdesign/core/Text'
import { TextArea } from '@astryxdesign/core/TextArea'
import { TextInput } from '@astryxdesign/core/TextInput'
import { VStack } from '@astryxdesign/core/VStack'
import { HStack } from '@astryxdesign/core/HStack'
import {
  removeSuppressed,
  verifyPassword,
  purgeSuppressedBatch,
  type RemoveResponse,
  type SuppressionReason,
} from '#/server/suppression'
import { parseEmails } from '#/lib/emails'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const [unlocked, setUnlocked] = useState(false)
  const [password, setPassword] = useState('')

  if (!unlocked) {
    return (
      <LockScreen
        password={password}
        setPassword={setPassword}
        onUnlocked={() => setUnlocked(true)}
      />
    )
  }

  return <Feature password={password} />
}

/**
 * Lock screen. The password is verified on the server (verifyPassword); we only
 * unlock the UI when the server confirms it. The same password is re-checked on
 * every removal request, so this gate is backed by real server-side auth.
 */
function LockScreen({
  password,
  setPassword,
  onUnlocked,
}: {
  password: string
  setPassword: (v: string) => void
  onUnlocked: () => void
}) {
  const [isVerifying, setIsVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleUnlock() {
    if (password.length === 0) return
    setError(null)
    setIsVerifying(true)
    try {
      const { ok } = await verifyPassword({ data: { password } })
      if (ok) {
        onUnlocked()
      } else {
        setError('Incorrect password.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed.')
    } finally {
      setIsVerifying(false)
    }
  }

  return (
    <div className="lock-viewport">
      <div className="panel lock-card animate-rise">
        <VStack gap={4}>
          <div className="brand">
            <span className="brand-badge" aria-hidden="true">
              <LockIcon />
            </span>
            <VStack gap={0}>
              <Heading level={1} type="display-3">
                <span className="header-accent">SES Remover</span>
              </Heading>
              <Text size="sm" color="secondary">
                Suppression list manager
              </Text>
            </VStack>
          </div>

          <Text size="sm" color="secondary">
            Enter the app password to continue.
          </Text>

          <TextInput
            type="password"
            label="Password"
            value={password}
            placeholder="••••••••"
            hasAutoFocus
            isDisabled={isVerifying}
            onChange={(v) => {
              setPassword(v)
              if (error) setError(null)
            }}
            onEnter={handleUnlock}
          />

          {error && <Banner status="error" container="card" title={error} />}

          <Button
            label={isVerifying ? 'Verifying…' : 'Unlock'}
            variant="primary"
            width="100%"
            isLoading={isVerifying}
            isDisabled={password.length === 0 || isVerifying}
            onClick={handleUnlock}
          />
        </VStack>
      </div>
    </div>
  )
}

/** Main feature panel: paste addresses, remove them, review per-email results. */
function Feature({ password }: { password: string }) {
  const [emails, setEmails] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [response, setResponse] = useState<RemoveResponse | null>(null)

  // Live preview of how many valid/invalid addresses are in the textarea.
  const preview = useMemo(() => parseEmails(emails), [emails])

  async function handleSubmit() {
    setError(null)
    setResponse(null)

    if (preview.valid.length === 0) {
      setError('Enter at least one valid email address.')
      return
    }

    setIsRunning(true)
    try {
      const result = await removeSuppressed({ data: { password, emails } })
      setResponse(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <main className="app-shell">
      <VStack gap={6}>
        {/* Header */}
        <div className="brand animate-rise">
          <span className="brand-badge" aria-hidden="true">
            <MailIcon />
          </span>
          <VStack gap={0}>
            <Heading level={1} type="display-2">
              <span className="header-accent">SES Suppression Remover</span>
            </Heading>
            <Text size="sm" color="secondary">
              Paste email addresses to remove them from your AWS SES
              suppression list.
            </Text>
          </VStack>
        </div>

        {/* Input card */}
        <div className="panel animate-rise">
          <VStack gap={4}>
            <TextArea
              label="Email addresses"
              description="One per line (commas and semicolons also work)."
              value={emails}
              onChange={(v) => setEmails(v)}
              placeholder={'user1@example.com\nuser2@example.com'}
              rows={8}
              isDisabled={isRunning}
              hasSpellCheck={false}
            />

            <HStack gap={3} vAlign="center" justify="between">
              <Text size="sm" color="secondary">
                {preview.valid.length} valid
                {preview.invalid.length > 0
                  ? ` · ${preview.invalid.length} invalid`
                  : ''}
              </Text>
              <Button
                label={isRunning ? 'Removing…' : 'Remove from suppression list'}
                variant="primary"
                isLoading={isRunning}
                isDisabled={isRunning || preview.valid.length === 0}
                onClick={handleSubmit}
              />
            </HStack>

            {preview.invalid.length > 0 && (
              <Banner
                status="warning"
                container="card"
                title={`Skipping ${preview.invalid.length} invalid entr${
                  preview.invalid.length === 1 ? 'y' : 'ies'
                }: ${preview.invalid.slice(0, 5).join(', ')}${
                  preview.invalid.length > 5 ? '…' : ''
                }`}
              />
            )}

            {error && (
              <Banner status="error" container="card" title={error} />
            )}
          </VStack>
        </div>

        {/* Results */}
        {response && <Results response={response} />}

        {/* Danger zone: purge entire list */}
        <DangerZone password={password} />
      </VStack>
    </main>
  )
}

const STATUS_LABEL: Record<string, string> = {
  removed: 'Removed',
  not_found: 'Not on list',
  error: 'Error',
}

function Results({ response }: { response: RemoveResponse }) {
  const { results, summary } = response

  return (
    <div className="panel animate-rise">
      <VStack gap={3}>
        <Heading level={2}>Results</Heading>

        <div className="summary-row">
          <div className="summary-chip">
            <div className="summary-num" style={{ color: '#4ade80' }}>
              {summary.removed}
            </div>
            <div className="summary-label">Removed</div>
          </div>
          <div className="summary-chip">
            <div className="summary-num" style={{ color: '#cbd5e1' }}>
              {summary.notFound}
            </div>
            <div className="summary-label">Not on list</div>
          </div>
          <div className="summary-chip">
            <div className="summary-num" style={{ color: '#f87171' }}>
              {summary.errored}
            </div>
            <div className="summary-label">Errors</div>
          </div>
        </div>

        {results.length > 0 && (
          <div className="result-list">
            {results.map((r) => (
              <div className="result-row" key={r.email}>
                <span className="result-email">{r.email}</span>
                <span className={`status-pill status-${r.status}`}>
                  {r.message ?? STATUS_LABEL[r.status]}
                </span>
              </div>
            ))}
          </div>
        )}
      </VStack>
    </div>
  )
}

/**
 * Danger zone: purge the ENTIRE suppression list (optionally filtered by reason).
 * Requires typing "DELETE ALL". Loops purgeSuppressedBatch until the list is
 * empty, showing live progress. Each batch is bounded server-side to stay within
 * Worker subrequest limits.
 */
const CONFIRM_PHRASE = 'DELETE ALL'
const REASONS: { value: SuppressionReason; label: string }[] = [
  { value: 'ALL', label: 'All reasons' },
  { value: 'BOUNCE', label: 'Bounces only' },
  { value: 'COMPLAINT', label: 'Complaints only' },
]
/** Safety valve so a runaway loop can't hammer AWS indefinitely. */
const MAX_BATCHES = 500

function DangerZone({ password }: { password: string }) {
  const [reason, setReason] = useState<SuppressionReason>('ALL')
  const [confirm, setConfirm] = useState('')
  const [isPurging, setIsPurging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{
    deleted: number
    errored: number
    done: boolean
  } | null>(null)

  const canRun = confirm === CONFIRM_PHRASE && !isPurging

  async function handlePurge() {
    if (!canRun) return
    setError(null)
    setProgress({ deleted: 0, errored: 0, done: false })
    setIsPurging(true)

    let totalDeleted = 0
    let totalErrored = 0
    try {
      for (let batch = 0; batch < MAX_BATCHES; batch++) {
        const res = await purgeSuppressedBatch({
          data: { password, confirm, reason },
        })
        totalDeleted += res.deleted
        totalErrored += res.errored
        setProgress({
          deleted: totalDeleted,
          errored: totalErrored,
          done: !res.hasMore,
        })
        if (!res.hasMore) break
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Purge failed.')
      setProgress((p) => (p ? { ...p, done: true } : p))
    } finally {
      setIsPurging(false)
      setConfirm('')
    }
  }

  return (
    <div className="danger-zone animate-rise">
      <VStack gap={3}>
        <div className="brand">
          <span className="brand-badge danger-badge" aria-hidden="true">
            <WarningIcon />
          </span>
          <VStack gap={0}>
            <Heading level={2}>Danger zone</Heading>
            <Text size="sm" color="secondary">
              Remove every address from the suppression list. This cannot be
              undone.
            </Text>
          </VStack>
        </div>

        <Banner
          status="warning"
          container="card"
          title="Removing suppressed addresses lets SES email them again — including past hard bounces and complaints. This can harm your sender reputation."
        />

        <VStack gap={1}>
          <Text size="sm" color="secondary">
            Scope
          </Text>
          <div className="reason-group">
            {REASONS.map((r) => (
              <button
                key={r.value}
                type="button"
                className={`reason-chip${reason === r.value ? ' is-active' : ''}`}
                disabled={isPurging}
                onClick={() => setReason(r.value)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </VStack>

        <TextInput
          label={`Type "${CONFIRM_PHRASE}" to confirm`}
          value={confirm}
          placeholder={CONFIRM_PHRASE}
          isDisabled={isPurging}
          onChange={(v) => {
            setConfirm(v)
            if (error) setError(null)
          }}
          onEnter={handlePurge}
        />

        <Button
          label={isPurging ? 'Removing all…' : 'Remove entire list'}
          variant="destructive"
          width="100%"
          isLoading={isPurging}
          isDisabled={!canRun}
          onClick={handlePurge}
        />

        {progress && (
          <div className="result-row" style={{ justifyContent: 'flex-start' }}>
            <Text size="sm">
              {progress.done ? 'Done. ' : 'Working… '}
              Removed {progress.deleted}
              {progress.errored > 0 ? ` · ${progress.errored} errors` : ''}
            </Text>
          </div>
        )}

        {error && <Banner status="error" container="card" title={error} />}
      </VStack>
    </div>
  )
}

/* --- Icons (inline SVG, currentColor) --- */

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="4"
        y="10"
        width="16"
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M8 10V7a4 4 0 1 1 8 0v3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="3"
        y="5"
        width="18"
        height="14"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="m4 7 8 6 8-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3.5 21 19H3L12 3.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M12 10v4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="12" cy="16.5" r="0.4" fill="currentColor" stroke="currentColor" />
    </svg>
  )
}
