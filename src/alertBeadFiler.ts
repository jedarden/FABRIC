/**
 * Alert Bead Filing — dedup-enforcing emission between alerts and beads
 *
 * The AlertManager (src/alertManager.ts) folds repeated NEEDLE observations
 * into one active alert instance per `kind:scope` identity. This module is
 * the emission layer BEHIND it: the step that files the corresponding bead
 * into the open-bead inventory and keeps that inventory conformant to the
 * same policy. Without it, a naive filer — one bead per notification — would
 * rebuild the duplicate pile the registry just folded: every cooldown
 * escalation would file a fresh bead for a condition that already has one
 * open.
 *
 * Policy (docs/alert-policy.md §Bead emission), mirroring the registry's:
 *
 * 1. One open bead per active instance — a bead is keyed on
 *    `AlertRecord.id` (the instance id, `<identity>#<epoch>`), never on the
 *    observation. `created`/`new-epoch` outcomes file; `deduplicated`/
 *    `escalated` outcomes update the SAME bead's evidence. A cooldown
 *    escalation re-surfaces the existing bead; it never files a second one.
 * 2. Resolution closes — the resolved instance's bead is closed with the
 *    resolution note. Repeat resolutions are no-ops.
 * 3. Recurrence files anew — the next epoch's id is a new bead. Closed beads
 *    are immutable history: no emission ever resurrects one.
 * 4. Reconciliation — an inventory written before this policy (or by a
 *    non-deduplicating writer) holds many open beads per identity.
 *    Reconciling against the registry files the active instances' beads,
 *    closes duplicate and orphaned open beads with a documented reason, and
 *    is idempotent.
 *
 * Emissions are idempotent per bead id: replaying an outcome re-delivers the
 * same fold (update), not a second file — so at-least-once delivery anywhere
 * on the path still yields exactly one open bead per active instance.
 *
 * The event store (src/store.ts) owns the filer next to the registry: its
 * `observeAlert`/`resolveAlert` sites emit every lifecycle outcome here, so
 * there is no path to a filed bead that bypasses the policy. The inventory
 * itself is process-local; the web service rebuilds it at boot via
 * `reconcileWithRegistry` against the restored (persisted) registry, and
 * exposes it at GET /api/alerts/beads.
 */

import {
  AlertKind,
  AlertObservationResult,
  AlertRecord,
  alertIdentity,
} from './alertManager.js';

/** Lifecycle status of a filed alert bead. */
export type AlertBeadStatus = 'open' | 'closed';

/**
 * One filed alert bead: the inventory's record of an alert instance. Keyed on
 * the instance id — fields other than identity/epoch are evidence.
 */
export interface AlertBead {
  /** = AlertRecord.id (`<identity>#<epoch>`). The dedup key of the inventory. */
  readonly id: string;
  /** = AlertRecord.identity (`<kind>:<scope>`). Stable across epochs. */
  readonly identity: string;
  readonly kind: AlertKind;
  readonly scope: string;
  /** 1-based instance number for this identity. */
  readonly epoch: number;
  status: AlertBeadStatus;
  /** When the bead was filed. */
  readonly filedAt: number;
  /** Evidence, folded forward from the instance on every emission. */
  occurrences: number;
  notifications: number;
  lastObservedAt: number;
  lastReason: string | null;
  /** Last cooldown-expiry re-notification folded into this bead. */
  lastEscalatedAt: number | null;
  closedAt: number | null;
  /** Why the bead closed (resolution note, or a reconciliation reason). */
  closeNote: string | null;
}

/** Evidence patch folded into an open bead (all fields optional). */
export interface AlertBeadPatch {
  occurrences?: number;
  notifications?: number;
  lastObservedAt?: number;
  lastReason?: string | null;
  lastEscalatedAt?: number | null;
}

/**
 * The bead workspace port. FABRIC ships an in-memory implementation; a bead
 * CLI/adapter implements the same four operations without touching policy.
 */
export interface AlertBeadSink {
  /** Add a bead to the inventory. */
  fileBead(bead: AlertBead): void;
  /** Fold an evidence patch into an existing bead. */
  updateBead(id: string, patch: AlertBeadPatch): void;
  /** Close a bead with a documented reason. */
  closeBead(id: string, note: string | null, at: number): void;
  /** One bead by id, or undefined. */
  getBead(id: string): AlertBead | undefined;
  /** The full inventory (open + closed). */
  listBeads(): AlertBead[];
}

/** Reference sink: an in-memory bead inventory (test seam; standalone use). */
export class InMemoryAlertBeadSink implements AlertBeadSink {
  private readonly beads = new Map<string, AlertBead>();

  fileBead(bead: AlertBead): void {
    // A closed instance is immutable history. A malformed replay or foreign
    // inventory must never resurrect it by filing the same id again.
    const existing = this.beads.get(bead.id);
    if (existing?.status === 'closed') return;
    this.beads.set(bead.id, { ...bead });
  }

  updateBead(id: string, patch: AlertBeadPatch): void {
    const bead = this.beads.get(id);
    if (!bead) return;
    this.beads.set(id, { ...bead, ...patch });
  }

  closeBead(id: string, note: string | null, at: number): void {
    const bead = this.beads.get(id);
    if (!bead || bead.status === 'closed') return;
    this.beads.set(id, { ...bead, status: 'closed', closedAt: at, closeNote: note });
  }

  getBead(id: string): AlertBead | undefined {
    const bead = this.beads.get(id);
    return bead ? { ...bead } : undefined;
  }

  listBeads(): AlertBead[] {
    return [...this.beads.values()].map((bead) => ({ ...bead }));
  }

  /** Drop the whole inventory (the event store's clear() resets this too). */
  clear(): void {
    this.beads.clear();
  }
}

/** What an emission did to the workspace. */
export type AlertBeadEmissionAction =
  /** Filed a new open bead (instance created, or reconciliation catch-up). */
  | 'filed'
  /** Folded evidence into the existing open bead (dedup or escalation). */
  | 'updated'
  /** Closed the bead (resolution or reconciliation). */
  | 'closed'
  /** No-op: nothing to act on, or the action would violate policy. */
  | 'ignored';

export interface AlertBeadEmission {
  action: AlertBeadEmissionAction;
  /** The bead the emission concerned; null only for a bare 'ignored'. */
  bead: AlertBead | null;
}

function beadFromRecord(record: AlertRecord, at: number): AlertBead {
  return {
    id: record.id,
    identity: record.identity,
    kind: record.kind,
    scope: record.scope,
    epoch: record.epoch,
    status: 'open',
    filedAt: at,
    occurrences: record.occurrences,
    notifications: record.notifications,
    lastObservedAt: record.lastObservedAt,
    lastReason: record.lastReason,
    lastEscalatedAt: null,
    closedAt: null,
    closeNote: null,
  };
}

/** Reconciliation report for one bead-inventory alignment pass. */
export interface BeadReconciliation {
  /** Beads in the inventory when the pass ran. */
  readonly beadsAudited: number;
  /** Distinct identities across inventory + registry. */
  readonly identitiesAudited: number;
  /** Open beads filed for active instances that lacked one. */
  readonly filed: number;
  /** Open beads closed whose identity has no active registry instance. */
  readonly orphansClosed: number;
  /** Extra open beads closed for identities that kept a canonical bead. */
  readonly duplicatesClosed: number;
  /** Open beads remaining — one per active instance. */
  readonly openBeadsAfter: number;
  /** Per-identity actions; only identities that had >1 open bead. */
  readonly reconciled: readonly ReconciledBeadIdentity[];
}

/** Result of reconciling one identity that held more than one open bead. */
export interface ReconciledBeadIdentity {
  readonly identity: string;
  readonly kind: AlertKind;
  readonly scope: string;
  readonly canonicalId: string;
  readonly closedIds: readonly string[];
}

export interface ReconcileBeadsOptions {
  /** Reconciliation time (ms epoch) stamped on closed beads. Default Date.now(). */
  at?: number;
}

/**
 * Dedup-enforcing bead filer. Owns every transition between the alert
 * registry's lifecycle outcomes and the bead workspace inventory.
 */
export class AlertBeadFiler {
  private readonly sink: AlertBeadSink;
  /**
   * Registry counts at the last emission/reconciliation. A legacy duplicate
   * fold can make the filed bead's totals larger than AlertManager's record;
   * tracking the registry baseline lets the next observation add only its
   * delta instead of erasing that repaired evidence.
   */
  private readonly registryEvidence = new Map<
    string,
    { occurrences: number; notifications: number }
  >();

  constructor(sink: AlertBeadSink) {
    this.sink = sink;
  }

  /**
   * Emit one registry observation result to the workspace.
   *
   * - `created` / `new-epoch` → the instance's bead is filed (new-epoch ids
   *   are new beads; the prior epoch's closed bead is never touched).
   * - `deduplicated` / `escalated` → the SAME open bead's evidence folds
   *   forward; an escalation also stamps `lastEscalatedAt`. No second bead.
   *   A fold naming an id the inventory does not hold (a catch-up emission
   *   after a restore, where beads are process-local) files it — exactly the
   *   filing the missing emission would have done.
   * - An observation naming an id the inventory holds as closed is ignored —
   *   out-of-order delivery must not resurrect closed history.
   */
  emitObservation(result: AlertObservationResult, at: number = Date.now()): AlertBeadEmission {
    const record = result.alert;
    const existing = this.sink.getBead(record.id);

    if (existing && existing.status === 'closed') {
      return { action: 'ignored', bead: existing };
    }

    if (!existing) {
      const bead = beadFromRecord(record, at);
      this.sink.fileBead(bead);
      this.rememberRegistryEvidence(record);
      return { action: 'filed', bead };
    }

    const escalated = result.outcome === 'escalated';
    const evidence = this.foldRegistryEvidence(record, existing);
    const patch: AlertBeadPatch = {
      occurrences: evidence.occurrences,
      notifications: evidence.notifications,
      lastObservedAt: record.lastObservedAt,
      lastReason: record.lastReason,
    };
    if (escalated) {
      patch.lastEscalatedAt = record.lastNotifiedAt;
    }
    this.sink.updateBead(record.id, patch);
    return { action: 'updated', bead: { ...existing, ...patch } };
  }

  private rememberRegistryEvidence(record: AlertRecord): void {
    this.registryEvidence.set(record.id, {
      occurrences: record.occurrences,
      notifications: record.notifications,
    });
  }

  private foldRegistryEvidence(
    record: AlertRecord,
    existing: AlertBead
  ): { occurrences: number; notifications: number } {
    const previous = this.registryEvidence.get(record.id);
    if (!previous) {
      // A foreign/pre-policy bead may already contain folded evidence. Keep
      // it, while establishing the registry's baseline for future deltas.
      this.rememberRegistryEvidence(record);
      return {
        occurrences: Math.max(existing.occurrences, record.occurrences),
        notifications: Math.max(existing.notifications, record.notifications),
      };
    }

    const occurrences =
      existing.occurrences + Math.max(0, record.occurrences - previous.occurrences);
    const notifications =
      existing.notifications + Math.max(0, record.notifications - previous.notifications);
    this.rememberRegistryEvidence(record);
    return { occurrences, notifications };
  }

  /**
   * Emit a registry resolution to the workspace. Closes the instance's open
   * bead with the resolution note. Idempotent: a null record (nothing was
   * active), an unfiled instance, or an already-closed bead are all no-ops.
   */
  emitResolution(record: AlertRecord | null, at: number = Date.now()): AlertBeadEmission {
    if (!record) {
      return { action: 'ignored', bead: null };
    }
    const bead = this.sink.getBead(record.id);
    if (!bead || bead.status === 'closed') {
      return { action: 'ignored', bead: bead ?? null };
    }
    this.sink.closeBead(record.id, record.resolutionNote, record.resolvedAt ?? at);
    return { action: 'closed', bead: this.sink.getBead(record.id) ?? null };
  }

  /**
   * Reconcile the workspace against the alert registry — the ingest step for
   * an inventory written before this policy (or by a non-deduplicating
   * writer), and the boot-time catch-up after the registry restores.
   *
   * - Active registry instances are the authority: each gets exactly one open
   *   bead, keyed on its instance id — filed when the inventory lacked it.
   * - Extra open beads for an identity that has its instance bead are closed
   *   as duplicates — their evidence folds into the canonical bead first
   *   (occurrence/notification totals summed, lastObservedAt max, lastReason
   *   from the most recent), so closing a duplicate loses no audit signal.
   *   Open beads for identities with NO active instance are closed as
   *   orphans. Every close carries a documented reason naming the bead (or
   *   identity) it duplicated.
   * - Closed beads are history — never touched, never resurrected.
   * - A non-conformant registry snapshot (multiple actives for one identity)
   *   is tolerated: the earliest-created active drives filing, matching
   *   `reconcileLegacyAlerts`' canonical choice.
   *
   * Idempotent: reconciling a conforming inventory files and closes nothing.
   */
  reconcileWithRegistry(
    records: readonly AlertRecord[],
    options: ReconcileBeadsOptions = {}
  ): BeadReconciliation {
    const at = options.at ?? Date.now();

    // Canonical active instance per identity (registry is expected to hold at
    // most one — earliest-created wins if a foreign snapshot holds more).
    const activeByIdentity = new Map<string, AlertRecord>();
    for (const record of records) {
      if (record.status !== 'active') continue;
      const incumbent = activeByIdentity.get(record.identity);
      if (!incumbent || record.createdAt < incumbent.createdAt) {
        activeByIdentity.set(record.identity, record);
      }
    }

    const beads = this.sink.listBeads();
    const open = beads.filter((bead) => bead.status === 'open');

    // Group open beads by identity for the audit.
    const openByIdentity = new Map<string, AlertBead[]>();
    for (const bead of open) {
      const list = openByIdentity.get(bead.identity) ?? [];
      list.push(bead);
      openByIdentity.set(bead.identity, list);
    }

    let filed = 0;
    let orphansClosed = 0;
    let duplicatesClosed = 0;
    const reconciled: ReconciledBeadIdentity[] = [];

    // 1. Identities with an active instance: keep the instance's bead (filing
    //    it if absent), fold + close every other open bead of the identity.
    for (const identity of [...activeByIdentity.keys()].sort()) {
      const instance = activeByIdentity.get(identity)!;
      const held = openByIdentity.get(identity) ?? [];
      const canonical =
        held.find((bead) => bead.id === instance.id) ??
        (() => {
          const bead = beadFromRecord(instance, at);
          this.sink.fileBead(bead);
          this.rememberRegistryEvidence(instance);
          filed++;
          return bead;
        })();

      const dups = held.filter((bead) => bead.id !== canonical.id);
      if (dups.length > 0) {
        // Fold duplicate evidence into the canonical bead so the audit
        // signal survives the fold; identity fields stay canonical's.
        const mostRecent = [...dups, canonical].sort(
          (a, b) => a.lastObservedAt - b.lastObservedAt
        ).pop()!;
        let occurrences = canonical.occurrences;
        let notifications = canonical.notifications;
        let lastObservedAt = canonical.lastObservedAt;
        let lastEscalatedAt = canonical.lastEscalatedAt;
        for (const dup of dups) {
          occurrences += dup.occurrences;
          notifications += dup.notifications;
          lastObservedAt = Math.max(lastObservedAt, dup.lastObservedAt);
          if (
            dup.lastEscalatedAt !== null &&
            (lastEscalatedAt === null || dup.lastEscalatedAt > lastEscalatedAt)
          ) {
            lastEscalatedAt = dup.lastEscalatedAt;
          }
        }
        this.sink.updateBead(canonical.id, {
          occurrences,
          notifications,
          lastObservedAt,
          lastReason: mostRecent.lastReason,
          lastEscalatedAt,
        });

        const closedIds: string[] = [];
        for (const dup of dups) {
          this.sink.closeBead(
            dup.id,
            `duplicate of ${canonical.id} — closed by bead-inventory reconciliation ` +
              `(one open bead per active alert instance; docs/alert-policy.md §Bead emission)`,
            at
          );
          closedIds.push(dup.id);
        }
        duplicatesClosed += dups.length;
        reconciled.push({
          identity,
          kind: instance.kind,
          scope: instance.scope,
          canonicalId: canonical.id,
          closedIds,
        });
      }
      // The canonical bead may include evidence folded from legacy duplicate
      // rows. Keep the registry's counts as the baseline so the next live
      // observation adds its delta to the repaired total.
      this.rememberRegistryEvidence(instance);
    }

    // 2. Identities with open beads but no active instance: orphaned history.
    for (const identity of [...openByIdentity.keys()].sort()) {
      if (activeByIdentity.has(identity)) continue;
      for (const bead of openByIdentity.get(identity)!) {
        this.sink.closeBead(
          bead.id,
          `no active alert instance for ${identity} — closed by bead-inventory ` +
            `reconciliation (docs/alert-policy.md §Bead emission)`,
          at
        );
        this.registryEvidence.delete(bead.id);
        orphansClosed++;
      }
    }

    const openBeadsAfter = this.sink.listBeads().filter((bead) => bead.status === 'open').length;
    const identities = new Set<string>([...activeByIdentity.keys(), ...openByIdentity.keys()]);
    return {
      beadsAudited: beads.length,
      identitiesAudited: identities.size,
      filed,
      orphansClosed,
      duplicatesClosed,
      openBeadsAfter,
      reconciled,
    };
  }
}

// `alertIdentity` is re-exported so a bead-workspace adapter can derive the
// dedup key from raw (kind, scope) without importing the registry module.
export { alertIdentity };
