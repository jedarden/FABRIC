import { describe, expect, it } from 'vitest';
import {
  HEARTBEAT_EVENT,
  HEARTBEAT_STALE_AFTER_MS,
  formatHeartbeatAge,
  getHeartbeatLiveness,
  isHeartbeatEvent,
} from './heartbeatLiveness.js';
import { LogEvent } from '../../types.js';

const event = (msg: string): LogEvent => ({
  ts: 1_000,
  worker: 'worker-a',
  level: 'info',
  msg,
});

describe('heartbeat liveness', () => {
  it('recognizes only heartbeat.emitted events', () => {
    expect(isHeartbeatEvent(event(HEARTBEAT_EVENT))).toBe(true);
    expect(isHeartbeatEvent(event('worker.heartbeat'))).toBe(false);
  });

  it('reports an unknown worker that has not sent a heartbeat', () => {
    expect(getHeartbeatLiveness(undefined, 10_000)).toEqual({ state: 'unknown' });
  });

  it('reports a heartbeat as alive until the stale threshold', () => {
    const now = 100_000;
    expect(getHeartbeatLiveness(now - HEARTBEAT_STALE_AFTER_MS + 1, now)).toEqual({
      state: 'alive',
      ageMs: HEARTBEAT_STALE_AFTER_MS - 1,
    });
  });

  it('reports a heartbeat as stale at the threshold', () => {
    const now = 100_000;
    expect(getHeartbeatLiveness(now - HEARTBEAT_STALE_AFTER_MS, now)).toEqual({
      state: 'stale',
      ageMs: HEARTBEAT_STALE_AFTER_MS,
    });
  });

  it('formats heartbeat ages for the worker grid', () => {
    expect(formatHeartbeatAge(undefined)).toBe('NO HB');
    expect(formatHeartbeatAge(500)).toBe('<1s');
    expect(formatHeartbeatAge(5_000)).toBe('5s');
    expect(formatHeartbeatAge(120_000)).toBe('2m');
  });
});
