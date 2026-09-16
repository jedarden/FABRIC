/**
 * AI Session Digest tests
 *
 * Covers configuration resolution, prompt building, provider call handling
 * (via a stubbed client), and fallback semantics. No network access — the
 * Anthropic client is injected as a stub.
 */

import { describe, test, expect } from 'vitest';
import {
  resolveDigestAiConfig,
  buildDigestAiPrompt,
  generateAiDigestNarrative,
  renderAiNarrativeSection,
  DigestAiClient,
  DigestAiConfig,
} from './digestAi.js';
import { SessionDigest } from './types.js';

const CONFIG: DigestAiConfig = {
  apiKey: 'test-key-not-a-real-credential',
  model: 'claude-opus-5',
  maxTokens: 4096,
  timeoutMs: 60_000,
  maxRetries: 1,
};

function makeDigest(overrides: Partial<SessionDigest> = {}): SessionDigest {
  const now = 1_700_000_000_000;
  return {
    sessionId: 'session-1700000000000',
    startTime: now,
    endTime: now + 3_600_000,
    durationMs: 3_600_000,
    beadsCompleted: [
      { beadId: 'bd-1847', workerId: 'w-alpha', completedAt: now + 1_000_000, durationMs: 1_000_000 },
      { beadId: 'bd-1852', workerId: 'w-bravo', completedAt: now + 2_000_000, durationMs: 2_000_000 },
    ],
    filesModified: [
      { path: 'src/auth/login.ts', modifications: 12, workers: ['w-alpha'], tools: ['Edit'] },
    ],
    errors: [
      { message: 'Rate limit hit', category: 'network', workerId: 'w-bravo', timestamp: now + 500_000 },
    ],
    workers: [
      {
        workerId: 'w-alpha',
        beadsCompleted: 1,
        filesModified: 1,
        errorsEncountered: 0,
        totalEvents: 500,
        activeTimeMs: 3_000_000,
        firstActivity: now,
        lastActivity: now + 3_000_000,
      },
    ],
    cost: {
      totalTokens: 68_000,
      inputTokens: 52_000,
      outputTokens: 16_000,
      estimatedCostUsd: 1.82,
    },
    stats: {
      totalEvents: 500,
      totalWorkers: 1,
      totalBeads: 2,
      totalFiles: 1,
      totalErrors: 1,
      avgEventsPerWorker: 500,
      avgBeadsPerWorker: 2,
    },
    ...overrides,
  };
}

describe('resolveDigestAiConfig', () => {
  test('returns null when no API key is configured', () => {
    expect(resolveDigestAiConfig({})).toBeNull();
  });

  test('prefers FABRIC_DIGEST_AI_API_KEY over ANTHROPIC_API_KEY', () => {
    const config = resolveDigestAiConfig({
      FABRIC_DIGEST_AI_API_KEY: 'fabric-key',
      ANTHROPIC_API_KEY: 'anthropic-key',
    });
    expect(config?.apiKey).toBe('fabric-key');
  });

  test('falls back to ANTHROPIC_API_KEY', () => {
    const config = resolveDigestAiConfig({ ANTHROPIC_API_KEY: 'anthropic-key' });
    expect(config?.apiKey).toBe('anthropic-key');
  });

  test('applies documented defaults', () => {
    const config = resolveDigestAiConfig({ ANTHROPIC_API_KEY: 'k' });
    expect(config).toMatchObject({
      model: 'claude-opus-5',
      maxTokens: 4096,
      timeoutMs: 60_000,
      maxRetries: 1,
    });
  });

  test('honors env overrides', () => {
    const config = resolveDigestAiConfig({
      ANTHROPIC_API_KEY: 'k',
      FABRIC_DIGEST_AI_MODEL: 'claude-haiku-4-5',
      FABRIC_DIGEST_AI_MAX_TOKENS: '1024',
      FABRIC_DIGEST_AI_TIMEOUT_MS: '5000',
      FABRIC_DIGEST_AI_MAX_RETRIES: '0',
    });
    expect(config).toMatchObject({
      model: 'claude-haiku-4-5',
      maxTokens: 1024,
      timeoutMs: 5000,
      maxRetries: 0,
    });
  });

  test('ignores invalid numeric env values', () => {
    const config = resolveDigestAiConfig({
      ANTHROPIC_API_KEY: 'k',
      FABRIC_DIGEST_AI_MAX_TOKENS: 'not-a-number',
      FABRIC_DIGEST_AI_TIMEOUT_MS: '-5',
    });
    expect(config?.maxTokens).toBe(4096);
    expect(config?.timeoutMs).toBe(60_000);
  });

  test('CLI model override wins over env', () => {
    const config = resolveDigestAiConfig(
      { ANTHROPIC_API_KEY: 'k', FABRIC_DIGEST_AI_MODEL: 'claude-haiku-4-5' },
      { model: 'claude-opus-5' },
    );
    expect(config?.model).toBe('claude-opus-5');
  });
});

describe('buildDigestAiPrompt', () => {
  test('includes session stats, workers, beads, files, and errors', () => {
    const prompt = buildDigestAiPrompt(makeDigest());

    expect(prompt).toContain('session-1700000000000');
    expect(prompt).toContain('Events: 500 across 1 workers');
    expect(prompt).toContain('w-alpha: 500 events');
    expect(prompt).toContain('bd-1847 by w-alpha');
    expect(prompt).toContain('src/auth/login.ts: 12 modifications');
    expect(prompt).toContain('[network] w-bravo: Rate limit hit');
    expect(prompt).toContain('estimated $1.82');
  });

  test('never includes the API key', () => {
    const prompt = buildDigestAiPrompt(makeDigest());
    expect(prompt).not.toContain(CONFIG.apiKey);
  });

  test('caps long lists at the documented prompt bounds', () => {
    const now = 1_700_000_000_000;
    const digest = makeDigest({
      workers: Array.from({ length: 30 }, (_, i) => ({
        workerId: `w-${i}`,
        beadsCompleted: 0,
        filesModified: 0,
        errorsEncountered: 0,
        totalEvents: i,
        activeTimeMs: 0,
        firstActivity: now,
        lastActivity: now,
      })),
      beadsCompleted: Array.from({ length: 40 }, (_, i) => ({
        beadId: `bd-${i}`,
        workerId: 'w-0',
        completedAt: now,
        durationMs: 0,
      })),
    });

    const prompt = buildDigestAiPrompt(digest);
    expect(prompt).toContain('top 20 by activity');
    expect(prompt).toContain('… and 10 more workers');
    expect(prompt).toContain('… and 20 more beads');
    expect(prompt).not.toContain('bd-39');
  });

  test('handles an empty session without padding', () => {
    const prompt = buildDigestAiPrompt(
      makeDigest({
        workers: [],
        beadsCompleted: [],
        filesModified: [],
        errors: [],
        cost: { totalTokens: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
      }),
    );
    expect(prompt).not.toContain('Per-worker summaries');
    expect(prompt).not.toContain('Beads completed');
    expect(prompt).not.toContain('Token usage');
    expect(prompt).toContain('Write the stakeholder digest now.');
  });
});

describe('generateAiDigestNarrative', () => {
  function stubClient(response: unknown, capture?: (params: unknown) => void): DigestAiClient {
    return {
      messages: {
        create: (async (params: unknown) => {
          capture?.(params);
          return response;
        }) as DigestAiClient['messages']['create'],
      },
    };
  }

  test('returns the narrative and model on success', async () => {
    const result = await generateAiDigestNarrative(
      makeDigest(),
      CONFIG,
      stubClient({
        content: [{ type: 'text', text: '## Overview\n\nThe fleet completed 2 beads.' }],
        stop_reason: 'end_turn',
        model: 'claude-opus-5',
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      narrative: '## Overview\n\nThe fleet completed 2 beads.',
      model: 'claude-opus-5',
    });
  });

  test('sends a bounded request shaped for the Messages API', async () => {
    let captured: any;
    await generateAiDigestNarrative(
      makeDigest(),
      CONFIG,
      stubClient({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }, (p) => {
        captured = p;
      }),
    );

    expect(captured.model).toBe('claude-opus-5');
    expect(captured.max_tokens).toBe(4096);
    expect(captured.messages).toHaveLength(1);
    expect(captured.messages[0].role).toBe('user');
    expect(captured.system).toContain('stakeholders');
    expect(JSON.stringify(captured)).not.toContain(CONFIG.apiKey);
  });

  test('falls back on refusal stop_reason', async () => {
    const result = await generateAiDigestNarrative(
      makeDigest(),
      CONFIG,
      stubClient({ content: [], stop_reason: 'refusal' }),
    );
    expect(result).toMatchObject({ ok: false });
    expect((result as { ok: false; reason: string }).reason).toContain('refusal');
  });

  test('falls back when the response has no text content', async () => {
    const result = await generateAiDigestNarrative(
      makeDigest(),
      CONFIG,
      stubClient({ content: [{ type: 'thinking' }], stop_reason: 'end_turn' }),
    );
    expect(result).toMatchObject({ ok: false, reason: 'response contained no text content' });
  });

  test('falls back when the provider call throws', async () => {
    const failing: DigestAiClient = {
      messages: {
        create: async () => {
          throw new Error('401 - invalid x-api-key');
        },
      },
    };
    const result = await generateAiDigestNarrative(makeDigest(), CONFIG, failing);
    expect(result).toMatchObject({ ok: false });
    expect((result as { ok: false; reason: string }).reason).toContain('401');
  });

  test('joins multiple text blocks', async () => {
    const result = await generateAiDigestNarrative(
      makeDigest(),
      CONFIG,
      stubClient({
        content: [
          { type: 'text', text: 'Part one.' },
          { type: 'text', text: 'Part two.' },
        ],
        stop_reason: 'end_turn',
      }),
    );
    expect(result).toMatchObject({ ok: true, narrative: 'Part one.\n\nPart two.' });
  });
});

describe('renderAiNarrativeSection', () => {
  test('renders a labeled section with the model attribution', () => {
    const section = renderAiNarrativeSection({
      ok: true,
      narrative: 'The fleet shipped auth.',
      model: 'claude-opus-5',
    });
    expect(section).toContain('## AI Narrative');
    expect(section).toContain('Generated by claude-opus-5');
    expect(section).toContain('The fleet shipped auth.');
  });
});
