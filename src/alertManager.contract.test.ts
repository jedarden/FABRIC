/**
 * Dedicated contract tests for docs/alert-policy.md.
 *
 * The broader alert tests exercise implementation details and legacy restore
 * behavior. This matrix keeps the public AlertManager outcomes visible in one
 * place so a policy change cannot accidentally drop one of the lifecycle
 * guarantees.
 */

import { describe, expect, it } from 'vitest';
import {
  alertIdentity,
  AlertManager,
  DEFAULT_ALERT_COOLDOWN_MS,
} from './alertManager.js';

const BASE = 1_900_000_000_000;

describe('AlertManager contract', () => {
  it('folds evidence by stable identity, independent of reason text', () => {
    const manager = new AlertManager({ cooldownMs: DEFAULT_ALERT_COOLDOWN_MS });

    const first = manager.observe('stuck', 'w-alpha', {
      at: BASE,
      reason: 'No activity for 3m',
    });
    const folded = manager.observe('stuck', 'w-alpha', {
      at: BASE + 1_000,
      reason: 'Repeated Read calls on src/auth.ts',
    });

    expect(alertIdentity('stuck', 'w-alpha')).toBe('stuck:w-alpha');
    expect(first.outcome).toBe('created');
    expect(folded.outcome).toBe('deduplicated');
    expect(folded.alert.id).toBe(first.alert.id);
    expect(folded.alert.identity).toBe('stuck:w-alpha');
    expect(folded.alert.occurrences).toBe(2);
    expect(folded.alert.lastReason).toBe('Repeated Read calls on src/auth.ts');
  });

  it('covers every lifecycle outcome without creating duplicate active instances', () => {
    const manager = new AlertManager({ cooldownMs: DEFAULT_ALERT_COOLDOWN_MS });

    const created = manager.observe('no-work', 'w-alpha', { at: BASE });
    const deduplicated = manager.observe('no-work', 'w-alpha', {
      at: BASE + DEFAULT_ALERT_COOLDOWN_MS - 1,
    });
    const escalated = manager.observe('no-work', 'w-alpha', {
      at: BASE + DEFAULT_ALERT_COOLDOWN_MS,
    });

    expect(created.outcome).toBe('created');
    expect(deduplicated.outcome).toBe('deduplicated');
    expect(escalated.outcome).toBe('escalated');
    expect(escalated.alert.id).toBe(created.alert.id);
    expect(escalated.alert.occurrences).toBe(3);
    expect(escalated.alert.notifications).toBe(2);
    expect(manager.activeAlerts()).toHaveLength(1);

    const resolved = manager.resolve('no-work', 'w-alpha', {
      at: BASE + DEFAULT_ALERT_COOLDOWN_MS + 1_000,
      note: 'worker claimed a bead',
    });
    expect(resolved?.status).toBe('resolved');
    expect(resolved?.resolutionNote).toBe('worker claimed a bead');
    expect(manager.resolve('no-work', 'w-alpha', {
      at: BASE + DEFAULT_ALERT_COOLDOWN_MS + 2_000,
    })).toBeNull();

    const newEpoch = manager.observe('no-work', 'w-alpha', {
      at: BASE + DEFAULT_ALERT_COOLDOWN_MS + 3_000,
      reason: 'worker.exhausted',
    });
    expect(newEpoch.outcome).toBe('new-epoch');
    expect(newEpoch.alert.id).not.toBe(created.alert.id);
    expect(newEpoch.alert.epoch).toBe(2);
    expect(newEpoch.alert.occurrences).toBe(1);
    expect(newEpoch.previous?.id).toBe(created.alert.id);
    expect(manager.activeAlerts()).toEqual([newEpoch.alert]);
    expect(manager.history()).toHaveLength(2);
    expect(manager.history()[0].status).toBe('resolved');
    expect(manager.history()[0].occurrences).toBe(3);
  });

  it('keeps alert kinds and worker scopes isolated', () => {
    const manager = new AlertManager();

    const noWork = manager.observe('no-work', 'w-alpha', { at: BASE });
    const stuck = manager.observe('stuck', 'w-alpha', { at: BASE });
    const otherWorker = manager.observe('no-work', 'w-bravo', { at: BASE });

    expect(new Set([noWork.alert.id, stuck.alert.id, otherWorker.alert.id]).size).toBe(3);
    expect(manager.activeAlerts().map((alert) => alert.identity).sort()).toEqual([
      'no-work:w-alpha',
      'no-work:w-bravo',
      'stuck:w-alpha',
    ]);
  });
});
