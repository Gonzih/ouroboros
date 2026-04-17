import { spawnSync } from 'node:child_process'
import { dequeue, ack, nack, getDb, log, publish, releaseLock } from '@ouroboros/core'
import type { FeedbackEvent } from '@ouroboros/core'
import { findClaudeBin } from '../claude.js'

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// 7 days in seconds — message stays invisible while we poll for approval
const VISIBILITY_TIMEOUT_SECS = 7 * 24 * 60 * 60

function buildEvolutionPrompt(repoRoot: string, feedback: FeedbackEvent): string {
  const shortTitle = feedback.text.slice(0, 60)
  return [
    `You are operating on the Ouroboros codebase at ${repoRoot}.`,
    '',
    `A user submitted this feedback:`,
    `"${feedback.text}"`,
    '',
    `Implement this as a code change:`,
    `1. git checkout -b feat/feedback-${feedback.id}`,
    `2. Make the change`,
    `3. Run: pnpm build (verify it compiles without errors)`,
    `4. git add -A && git commit -m "feat: ${shortTitle}"`,
    `5. gh pr create --title "feat: ${shortTitle}" --body "${feedback.text}" --base main`,
    '',
    `When PR is opened, respond with exactly: PR_OPENED:{pr_url}`,
    `If build fails, respond with exactly: BUILD_FAILED:{error}`,
  ].join('\n')
}

function runClaude(prompt: string, cwd: string): string {
  const claudeBin = findClaudeBin()
  const result = spawnSync(
    claudeBin,
    ['--print', '--dangerously-skip-permissions', '-p', prompt],
    {
      cwd,
      env: { ...process.env },
      timeout: 5 * 60 * 1000,
      encoding: 'utf8',
    },
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').trim()
    throw new Error(`claude exited with code ${result.status}${stderr ? `: ${stderr}` : ''}`)
  }
  return result.stdout ?? ''
}

export async function pollForApproval(
  feedbackId: string,
  prUrl: string,
  msgId: bigint,
  repoRoot: string,
): Promise<void> {
  const db = getDb()
  const deadline = Date.now() + 7 * 24 * 60 * 60 * 1000

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10_000))

    let status: string
    try {
      const rows = await db<{ status: string }[]>`
        SELECT status FROM ouro_feedback WHERE id = ${feedbackId}
      `
      const row = rows[0]
      if (!row) break
      status = row.status
    } catch (err) {
      await log('meta-agent:evolution', `poll error for feedback ${feedbackId}: ${String(err)}`)
      continue
    }

    if (status === 'approved') {
      try {
        const mergePrompt = `Merge the PR at ${prUrl} by running: gh pr merge --squash ${prUrl}`
        runClaude(mergePrompt, repoRoot)
      } catch (err) {
        await log('meta-agent:evolution', `merge failed for PR ${prUrl}: ${String(err)}`)
        await db`
          UPDATE ouro_feedback
          SET status = 'merge_failed'
          WHERE id = ${feedbackId}
        `
        await ack('ouro_feedback', msgId)
        await publish('ouro_notify', { type: 'evolution_merge_failed', id: feedbackId, prUrl, error: String(err) })
        return
      }

      await db`
        UPDATE ouro_feedback
        SET status = 'applied', resolved_at = NOW()
        WHERE id = ${feedbackId}
      `
      await ack('ouro_feedback', msgId)
      await publish('ouro_notify', { type: 'evolution_applied', id: feedbackId, prUrl })
      await log('meta-agent:evolution', `feedback ${feedbackId} applied (PR merged)`)

      // Rebuild with new code — only restart if build succeeds
      await log('meta-agent:evolution', `Evolution ${feedbackId} applied — rebuilding...`)
      await publish('ouro_notify', { type: 'rebuilding', id: feedbackId })

      const buildResult = spawnSync('pnpm', ['build'], {
        cwd: repoRoot,
        encoding: 'utf8',
      })

      if (buildResult.status !== 0) {
        const stderr = buildResult.stderr ?? 'unknown error'
        await log('meta-agent:evolution', `Rebuild failed: ${stderr}`)
        await publish('ouro_notify', { type: 'rebuild_failed', error: stderr })
        return  // keep running old binary — do not restart
      }

      await log('meta-agent:evolution', 'Rebuild successful — graceful restart')
      await publish('ouro_notify', { type: 'restarting', reason: 'evolution_applied' })
      // Release advisory lock so the new process can acquire it
      await releaseLock('ouro:meta-agent')
      // Give gateway time to broadcast the restart notification
      await sleep(2000)
      process.exit(0)
    }

    if (status === 'rejected') {
      try {
        const closePrompt = `Close the PR at ${prUrl} by running: gh pr close ${prUrl}`
        runClaude(closePrompt, repoRoot)
      } catch (err) {
        await log('meta-agent:evolution', `close PR failed for ${prUrl}: ${String(err)}`)
      }

      await db`
        UPDATE ouro_feedback
        SET status = 'rejected', resolved_at = NOW()
        WHERE id = ${feedbackId}
      `
      await ack('ouro_feedback', msgId)
      await publish('ouro_notify', { type: 'evolution_rejected', id: feedbackId, prUrl })
      await log('meta-agent:evolution', `feedback ${feedbackId} rejected (PR closed)`)
      return
    }
  }

  // Timed out waiting — log and ack so the message doesn't linger forever
  await log('meta-agent:evolution', `feedback ${feedbackId} approval timed out after 7 days`)
  await ack('ouro_feedback', msgId)
}

export async function processOneFeedback(): Promise<void> {
  const repoRoot = process.env['OURO_REPO_ROOT']
  if (!repoRoot) {
    await log('meta-agent:evolution', 'OURO_REPO_ROOT not set — skipping evolution tick')
    return
  }

  const item = await dequeue<FeedbackEvent>('ouro_feedback', VISIBILITY_TIMEOUT_SECS)
  if (!item) return

  const { msgId, message: feedback } = item

  if (!feedback.id || !feedback.text) {
    await log('meta-agent:evolution', `invalid feedback shape, nacking: ${JSON.stringify(feedback)}`)
    await nack('ouro_feedback', msgId)
    return
  }

  await log('meta-agent:evolution', `processing feedback ${feedback.id}: "${feedback.text.slice(0, 80)}"`)

  const prompt = buildEvolutionPrompt(repoRoot, feedback)

  let output: string
  try {
    output = runClaude(prompt, repoRoot)
  } catch (err) {
    await log('meta-agent:evolution', `claude subprocess failed for feedback ${feedback.id}: ${String(err)}`)
    await nack('ouro_feedback', msgId)
    return
  }

  const prMatch = /PR_OPENED:(\S+)/.exec(output)
  const buildFailMatch = /BUILD_FAILED:(.+)/.exec(output)

  if (prMatch) {
    const prUrl = prMatch[1] ?? ''
    const db = getDb()

    await db`
      UPDATE ouro_feedback
      SET status = 'pr_open', pr_url = ${prUrl}
      WHERE id = ${feedback.id}
    `

    await publish('ouro_notify', {
      type: 'evolution_proposed',
      id: feedback.id,
      prUrl,
      diff: '(see PR)',
    })

    await log('meta-agent:evolution', `PR opened for feedback ${feedback.id}: ${prUrl}`)

    // Poll for approval in background — does not block the main evolution loop
    void pollForApproval(feedback.id, prUrl, msgId, repoRoot)
  } else if (buildFailMatch) {
    const error = buildFailMatch[1] ?? 'unknown build error'
    await log('meta-agent:evolution', `build failed for feedback ${feedback.id}: ${error}`)
    await nack('ouro_feedback', msgId)
  } else {
    await log('meta-agent:evolution', `no marker found in claude output for feedback ${feedback.id} — nacking`)
    await nack('ouro_feedback', msgId)
  }
}

export async function startEvolution(): Promise<void> {
  const run = (): void => {
    void processOneFeedback()
      .catch((err) =>
        log('meta-agent:evolution', `unhandled error in evolution loop: ${String(err)}`),
      )
      .finally(() => {
        setTimeout(run, 5000)
      })
  }

  run()
  await new Promise<never>(() => undefined)
}
