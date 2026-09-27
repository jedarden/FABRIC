/**
 * Alert Deduplication — idempotent identity, cooldown, and resolution
 *
 * Repeated NEEDLE observations of the same degraded condition (a worker doing
 * no work, a worker stuck) used to map 1:1 to alert beads: every re-observation
 * spawned a fresh bead, so one ongoing problem produced a pile of duplicates.
 * This module is the policy layer between raw observations and alert beads.
 *
 * Policy (full text: docs/alert-policy.md):
 *
 * 1. Identity — an alert's identity is a pure function of the condition:
 *    `<kind>:<scope>` (e.g. `stuck:w-alpha`). Evidence (reason text, counts,
 *    timestamps) is never part of identity, so a drifting reason cannot fork
 *    the alert.
 * 2. One active instance per identity — repeated observations of an already
 *    active condition fold into the SAME alert instance: occurrence count and
 *    last-seen/reason update, no new instance is created.
 * 3. Cooldown — while an instance is active, re-notifications are suppressed
 *    within the cooldown window. After the window, an ongoing condition may
 *    escalate (re-notify) — but it is still the same instance, never a new one.
 * 4. Resolution — resolving closes the active instance; it becomes immutable
 *    history. Resolution is idempotent: resolving a condition with no active
 *    instance is a no-op.
 * 5. Recurrence — the first observation after a resolution opens a NEW
 *    instance (next epoch, new id) for the same identity. The resolved record
 *    is never mutated or resurrected.
 *
 * Invariants 2 and 5 are the acceptance contract: repeated observations
 * maintain exactly one active alert bead, while a resolved condition can
 * produce a new alert.
 */

/** The alert kinds FABRIC deduplicates. */
export type AlertKind = 'no-work' | 'stuck';

/** Lifecycle status of a single alert instance. */
export type AlertStatus = 'active' | 'resolved';

/**
 * One alert instance ("alert bead"): a single open-or-closed record for an
 * identity. Fields other than identity are evidence, not identity.
 */
export interface AlertRecord {
  /** Instance id — unique per (identity, epoch). */
  readonly id: string;
  /** Idempotent dedup key: `<kind>:<scope>`. Stable across epochs. */
  readonly identity: string;
  readonly kind: AlertKind;
  /** The condition's scope, typically the worker id. */
  readonly scope: string;
  /** 1-based instance number for this identity. */
  readonly epoch: number;
  status: AlertStatus;
  /** When this instance was opened. */
  readonly createdAt: number;
  firstObservedAt: number;
  lastObservedAt: number;
  resolvedAt: number | null;
  /** Total observations folded into this instance (including the first). */
  occurrences: number;
  /** Times this instance surfaced (open + cooldown expiry escalations). */
  notifications: number;
  /** Last time this instance surfaced. */
  lastNotifiedAt: number;
  /** Latest human-readable evidence. Never part of identity. */
  lastReason: string | null;
  /** Note recorded at resolution (e.g. why the condition cleared). */
  resolutionNote: string | null;
}

/** What an observation did. */
export type AlertOutcome =
  /** No prior instance — opened epoch 1. */
  | 'created'
  /** Folded into the active instance within the cooldown window. */
  | 'deduplicated'
  /** Folded into the active instance; cooldown had elapsed so it re-notified. */
  | 'escalated'
  /** Condition recurred after resolution — opened the next epoch. */
  | 'new-epoch';

export interface AlertObservationResult {
  outcome: AlertOutcome;
  /** The instance the observation is folded into (newly created on created/new-epoch). */
  alert: AlertRecord;
  /** The just-resolved prior instance, set only on 'new-epoch'. */
  previous: AlertRecord | null;
}

export interface AlertObserveOptions {
  /** Observation time (ms epoch). Defaults to the manager's clock. */
  at?: number;
  /** Latest evidence text; replaces the record's lastReason. */
  reason?: string;
}

export interface AlertResolveOptions {
  /** Resolution time (ms epoch). Defaults to the manager's clock. */
  at?: number;
  /** Why the condition cleared. */
  note?: string;
}

export interface AlertManagerOptions {
  /** Minimum ms between notifications of one active instance. Default 30 min. */
  cooldownMs?: number;
  /** Time source; inject a fixed clock in tests. Default Date.now. */
  now?: () => number;
}

/** Default cooldown: an active alert re-notifies at most every 30 minutes. */
export const DEFAULT_ALERT_COOLDOWN_MS = 30 * 60 * 1000;

/**
 * Idempotent alert identity for a condition. Pure function of (kind, scope) —
 * the same condition always maps to the same identity, and evidence never
 * changes it.
 */
export function alertIdentity(kind: AlertKind, scope: string): string {
  return `${kind}:${scope}`;
}

/**
 * Deduplicating alert registry. See the module header for the policy.
 */
export class AlertManager {
  private readonly instances = new Map<string, AlertRecord[]>();
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(options: AlertManagerOptions = {}) {
    this.cooldownMs = options.cooldownMs ?? DEFAULT_ALERT_COOLDOWN_MS;
    this.now = options.now ?? Date.now;
  }

  /**
   * Record an observation of a condition. Folds into the active instance when
   * one exists (dedup/escalate); opens a new instance otherwise (create or
   * new epoch after resolution).
   */
  observe(
    kind: AlertKind,
    scope: string,
    options: AlertObserveOptions = {}
  ): AlertObservationResult {
    const at = options.at ?? this.now();
    const identity = alertIdentity(kind, scope);
    const epochs = this.instances.get(identity) ?? [];
    const current = epochs[epochs.length - 1];

    if (current && current.status === 'active') {
      current.occurrences++;
      current.lastObservedAt = Math.max(current.lastObservedAt, at);
      if (options.reason !== undefined) {
        current.lastReason = options.reason;
      }
      if (at - current.lastNotifiedAt >= this.cooldownMs) {
        current.notifications++;
        current.lastNotifiedAt = at;
        return { outcome: 'escalated', alert: current, previous: null };
      }
      return { outcome: 'deduplicated', alert: current, previous: null };
    }

    const epoch = epochs.length + 1;
    const record: AlertRecord = {
      id: `${identity}#${epoch}`,
      identity,
      kind,
      scope,
      epoch,
      status: 'active',
      createdAt: at,
      firstObservedAt: at,
      lastObservedAt: at,
      resolvedAt: null,
      occurrences: 1,
      notifications: 1,
      lastNotifiedAt: at,
      lastReason: options.reason ?? null,
      resolutionNote: null,
    };
    epochs.push(record);
    this.instances.set(identity, epochs);
    return {
      outcome: epoch === 1 ? 'created' : 'new-epoch',
      alert: record,
      previous: epoch === 1 ? null : epochs[epochs.length - 2],
    };
  }

  /**
   * Resolve the active instance for a condition, if any. Idempotent: returns
   * null when the condition has no active instance.
   */
  resolve(
    kind: AlertKind,
    scope: string,
    options: AlertResolveOptions = {}
  ): AlertRecord | null {
    const current = this.active(kind, scope);
    if (!current) {
      return null;
    }
    current.status = 'resolved';
    current.resolvedAt = options.at ?? this.now();
    current.resolutionNote = options.note ?? null;
    return current;
  }

  /** The active instance for a condition, or null. */
  active(kind: AlertKind, scope: string): AlertRecord | null {
    const epochs = this.instances.get(alertIdentity(kind, scope));
    const current = epochs?.[epochs.length - 1];
    return current && current.status === 'active' ? current : null;
  }

  /** All active instances across all identities. */
  activeAlerts(): AlertRecord[] {
    const active: AlertRecord[] = [];
    for (const epochs of this.instances.values()) {
      const current = epochs[epochs.length - 1];
      if (current.status === 'active') {
        active.push(current);
      }
    }
    return active;
  }

  /** Full instance history (active + resolved), oldest epoch first per identity. */
  history(): AlertRecord[] {
    const all: AlertRecord[] = [];
    for (const epochs of this.instances.values()) {
      all.push(...epochs);
    }
    return all;
  }

  /** Drop all state (used by the event store's clear()). */
  clear(): void {
    this.instances.clear();
  }
}
