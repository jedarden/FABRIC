/**
 * AI Session Digest — optional LLM narrative layer.
 *
 * The deterministic session digest (src/sessionDigest.ts) extracts events and
 * formats them as Markdown tables. This module adds the AI-generated narrative
 * the README advertises: a stakeholder-facing summary written by Claude from
 * the deterministic digest's already-extracted data.
 *
 * Layering:
 * - `fabric digest` alone → deterministic digest (unchanged, always available)
 * - `fabric digest --ai`  → deterministic digest + AI narrative section
 *
 * Provider: Anthropic Messages API via the official @anthropic-ai/sdk.
 *
 * Fallback contract: `generateAiDigestNarrative` NEVER throws. Any failure
 * (missing API key, auth error, rate limit, timeout, malformed response,
 * refusal) returns `{ ok: false, reason }` and the caller emits the
 * deterministic digest with a warning on stderr. The command still exits 0 —
 * an AI outage must never lose the deterministic digest.
 *
 * Configuration (environment variables):
 * - FABRIC_DIGEST_AI_API_KEY   API key (preferred); falls back to ANTHROPIC_API_KEY
 * - FABRIC_DIGEST_AI_MODEL     model id (default: claude-opus-5)
 * - FABRIC_DIGEST_AI_MAX_TOKENS  response cap (default: 4096 — digests are short-form)
 * - FABRIC_DIGEST_AI_TIMEOUT_MS  request timeout (default: 60000)
 * - FABRIC_DIGEST_AI_MAX_RETRIES transport retries (default: 1)
 *
 * The API key is never logged, never rendered into output, and never included
 * in the prompt. Errors are reported by property (status, message), not value.
 */

import Anthropic from '@anthropic-ai/sdk';
import { SessionDigest } from './types.js';

/** Default model for digest narratives (overridable via FABRIC_DIGEST_AI_MODEL). */
export const DEFAULT_DIGEST_AI_MODEL = 'claude-opus-5';

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 1;

/** Prompt size bounds — keeps the request small and the cost predictable. */
const MAX_PROMPT_WORKERS = 20;
const MAX_PROMPT_BEADS = 20;
const MAX_PROMPT_FILES = 15;
const MAX_PROMPT_ERRORS = 10;

/**
 * Resolved AI provider configuration.
 * `apiKey` is carried opaquely into the SDK client — never rendered.
 */
export interface DigestAiConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
  timeoutMs: number;
  maxRetries: number;
}

/** Result of an AI narrative request. Discriminated union; never throws. */
export type DigestAiResult =
  | { ok: true; narrative: string; model: string }
  | { ok: false; reason: string };

/**
 * Minimal client surface used by generateAiDigestNarrative, so tests can
 * inject a stub instead of a real Anthropic client.
 */
export interface DigestAiClient {
  messages: {
    create(params: {
      model: string;
      max_tokens: number;
      system: string;
      messages: Array<{ role: 'user'; content: string }>;
    }): Promise<{
      content: Array<{ type: string; text?: string }>;
      stop_reason: string | null;
      model?: string;
    }>;
  };
}

/**
 * Resolve AI configuration from environment variables.
 * Returns null when no API key is configured — callers must fall back.
 */
export function resolveDigestAiConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: { model?: string } = {},
): DigestAiConfig | null {
  const apiKey = env.FABRIC_DIGEST_AI_API_KEY || env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  return {
    apiKey,
    model: overrides.model || env.FABRIC_DIGEST_AI_MODEL || DEFAULT_DIGEST_AI_MODEL,
    maxTokens: parsePositiveInt(env.FABRIC_DIGEST_AI_MAX_TOKENS, DEFAULT_MAX_TOKENS),
    timeoutMs: parsePositiveInt(env.FABRIC_DIGEST_AI_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    maxRetries: parseNonNegativeInt(env.FABRIC_DIGEST_AI_MAX_RETRIES, DEFAULT_MAX_RETRIES),
  };
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseNonNegativeInt(raw: string | undefined, fallback: number): number {
  const n = parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const DIGEST_SYSTEM_PROMPT = [
  'You are writing a session digest for engineering stakeholders (leads, PMs, operators).',
  'You are given structured, already-extracted session data from FABRIC, a dashboard for',
  'NEEDLE worker fleets: aggregate statistics, per-worker summaries, completed beads,',
  'modified files, and errors. The data has already been extracted deterministically —',
  'do not invent activity that is not represented in it.',
  '',
  'Write the digest in Markdown with exactly these sections:',
  '## Overview — one short paragraph on what the fleet accomplished overall.',
  '## Highlights — the most significant outcomes as bullets.',
  '## Issues & Observations — notable errors, stuck patterns, or efficiency observations as bullets.',
  '',
  'Rules:',
  '- Reference concrete bead IDs, worker names, and file paths from the data.',
  '- If the session has no completions or no errors, say so plainly rather than padding.',
  '- No preamble, no closing remarks, no restating these instructions.',
].join('\n');

/**
 * Build the user prompt from a deterministic digest.
 * Lists are capped to keep prompt size and cost bounded; the digest's own
 * stats fields already reflect the full (uncapped) dataset.
 */
export function buildDigestAiPrompt(digest: SessionDigest): string {
  const lines: string[] = [];

  lines.push('Session data:');
  lines.push(`- Session: ${digest.sessionId}`);
  lines.push(
    `- Window: ${new Date(digest.startTime).toISOString()} → ${new Date(digest.endTime).toISOString()} (${formatMs(digest.durationMs)})`,
  );
  lines.push(
    `- Events: ${digest.stats.totalEvents} across ${digest.stats.totalWorkers} workers; ` +
      `${digest.stats.totalBeads} beads, ${digest.stats.totalFiles} files, ${digest.stats.totalErrors} errors`,
  );
  if (digest.cost.totalTokens > 0) {
    lines.push(
      `- Token usage: ${digest.cost.totalTokens} total (${digest.cost.inputTokens} in / ${digest.cost.outputTokens} out), estimated $${digest.cost.estimatedCostUsd.toFixed(2)}`,
    );
  }

  const workers = digest.workers.slice(0, MAX_PROMPT_WORKERS);
  if (workers.length > 0) {
    lines.push('', `Per-worker summaries (top ${workers.length} by activity):`);
    for (const w of workers) {
      lines.push(
        `- ${w.workerId}: ${w.totalEvents} events, ${w.beadsCompleted} beads, ` +
          `${w.filesModified} files, ${w.errorsEncountered} errors, active ${formatMs(w.activeTimeMs)}`,
      );
    }
    if (digest.workers.length > workers.length) {
      lines.push(`- … and ${digest.workers.length - workers.length} more workers`);
    }
  }

  const beads = digest.beadsCompleted.slice(0, MAX_PROMPT_BEADS);
  if (beads.length > 0) {
    lines.push('', `Beads completed (${digest.beadsCompleted.length} total):`);
    for (const b of beads) {
      lines.push(`- ${b.beadId} by ${b.workerId}${b.durationMs ? ` in ${formatMs(b.durationMs)}` : ''}`);
    }
    if (digest.beadsCompleted.length > beads.length) {
      lines.push(`- … and ${digest.beadsCompleted.length - beads.length} more beads`);
    }
  }

  const files = digest.filesModified.slice(0, MAX_PROMPT_FILES);
  if (files.length > 0) {
    lines.push('', `Most-modified files (top ${files.length} of ${digest.filesModified.length}):`);
    for (const f of files) {
      lines.push(`- ${f.path}: ${f.modifications} modifications by ${f.workers.join(', ')} (${f.tools.join(', ')})`);
    }
  }

  const errors = digest.errors.slice(0, MAX_PROMPT_ERRORS);
  if (errors.length > 0) {
    lines.push('', `Recent errors (${digest.errors.length} total):`);
    for (const e of errors) {
      lines.push(`- [${e.category}] ${e.workerId}: ${oneLine(e.message)}`);
    }
  }

  lines.push('', 'Write the stakeholder digest now.');
  return lines.join('\n');
}

/**
 * Request the AI narrative. Never throws — every failure path returns
 * `{ ok: false, reason }` so the caller can fall back to the deterministic
 * digest. A null config (no API key resolved) is itself a failure result,
 * so callers cannot fall out of the contract by skipping their own check.
 */
export async function generateAiDigestNarrative(
  digest: SessionDigest,
  config: DigestAiConfig | null,
  client?: DigestAiClient,
): Promise<DigestAiResult> {
  if (!config) {
    return {
      ok: false,
      reason: 'no API key configured (set FABRIC_DIGEST_AI_API_KEY or ANTHROPIC_API_KEY)',
    };
  }

  const effectiveClient: DigestAiClient =
    client ??
    new Anthropic({
      apiKey: config.apiKey,
      timeout: config.timeoutMs,
      maxRetries: config.maxRetries,
    });

  let response;
  try {
    response = await effectiveClient.messages.create({
      model: config.model,
      max_tokens: config.maxTokens,
      system: DIGEST_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildDigestAiPrompt(digest) }],
    });
  } catch (err) {
    // SDK errors carry a status and message; the API key is never part of them.
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `provider request failed: ${message}` };
  }

  if (response.stop_reason === 'refusal') {
    return { ok: false, reason: 'model declined the request (stop_reason=refusal)' };
  }

  const narrative = response.content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text!.trim())
    .filter((t) => t.length > 0)
    .join('\n\n')
    .trim();

  if (!narrative) {
    return { ok: false, reason: 'response contained no text content' };
  }

  return { ok: true, narrative, model: response.model ?? config.model };
}

/**
 * Render the AI narrative as a Markdown section appended after the
 * deterministic digest.
 */
export function renderAiNarrativeSection(result: Extract<DigestAiResult, { ok: true }>): string {
  return [
    '',
    '## AI Narrative',
    '',
    `*Generated by ${result.model} from the deterministic digest above.*`,
    '',
    result.narrative,
    '',
  ].join('\n');
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
