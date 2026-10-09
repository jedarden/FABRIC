import { LogEvent } from '../../types.js';

/** The event emitted by NEEDLE's worker heartbeat probe. */
export const HEARTBEAT_EVENT = 'heartbeat.emitted';

/** A worker is stale after missing six of the normal five-second heartbeats. */
export const HEARTBEAT_STALE_AFTER_MS = 30_000;

export type HeartbeatLivenessState = 'alive' | 'stale' | 'unknown';

export interface HeartbeatLiveness {
  state: HeartbeatLivenessState;
  ageMs?: number;
}

/** Return true only for the heartbeat event, not similarly named events. */
export function isHeartbeatEvent(event: LogEvent): boolean {
  return event.msg === HEARTBEAT_EVENT;
}

/**
 * Derive a worker's liveness from its most recent heartbeat.
 *
 * `now` and `staleAfterMs` are injectable so the threshold behavior stays
 * deterministic in unit tests and callers can use a different policy later.
 */
export function getHeartbeatLiveness(
  lastHeartbeat: number | undefined,
  now = Date.now(),
  staleAfterMs = HEARTBEAT_STALE_AFTER_MS,
): HeartbeatLiveness {
  if (lastHeartbeat === undefined) {
    return { state: 'unknown' };
  }

  const ageMs = Math.max(0, now - lastHeartbeat);
  return {
    state: ageMs >= staleAfterMs ? 'stale' : 'alive',
    ageMs,
  };
}

/** Format the compact age shown beside a worker in the TUI. */
export function formatHeartbeatAge(ageMs: number | undefined): string {
  if (ageMs === undefined) return 'NO HB';
  if (ageMs < 1000) return '<1s';
  if (ageMs < 60_000) return `${Math.floor(ageMs / 1000)}s`;
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}m`;
  return `${Math.floor(ageMs / 3_600_000)}h`;
}
