/**
 * FABRIC Server Metrics
 *
 * Collects and exposes internal metrics for /api/health and /api/metrics endpoints.
 */

import { VERSION } from './index.js';

import type { RetentionState } from './logPruner.js';

export type { RetentionState };

export interface ServerMetricsSnapshot {
  status: string;
  uptime_sec: number;
  version: string;
  event_count: number;
  ingest_rate_per_sec: number;
  ws_clients: number;
  tailer_files_watched: number;
  dedup_dropped: number;
  process_resident_memory_bytes: number;
  retention?: RetentionState;
  prune_last_run_timestamp_seconds?: number;
  prune_last_success_timestamp_seconds?: number;
  logs_dir_bytes?: number;
}

export class ServerMetrics {
  private startTime = Date.now();
  private eventTimestamps: number[] = [];
  private _wsClients = 0;
  private _tailerFilesWatched = 0;
  private _eventCount = 0;
  private _dedupDropped = 0;
  // Track events per host for multi-host aggregation
  private eventsPerHost: Map<string, number> = new Map();
  private eventTimestampsPerHost: Map<string, number[]> = new Map();

  recordEvent(host?: string): void {
    this._eventCount++;
    this.eventTimestamps.push(Date.now());

    // Track per-host metrics
    // If no host provided, try to get local hostname
    const hostKey = host || this.getLocalHostname();
    const currentCount = this.eventsPerHost.get(hostKey) || 0;
    this.eventsPerHost.set(hostKey, currentCount + 1);

    if (!this.eventTimestampsPerHost.has(hostKey)) {
      this.eventTimestampsPerHost.set(hostKey, []);
    }
    this.eventTimestampsPerHost.get(hostKey)!.push(Date.now());
  }

  private getLocalHostname(): string {
    // Try to get hostname from environment or use 'localhost'
    if (typeof process !== 'undefined' && process.env.HOSTNAME) {
      return process.env.HOSTNAME;
    }
    if (typeof process !== 'undefined' && process.env.HOST) {
      return process.env.HOST;
    }
    return 'localhost';
  }

  set wsClients(count: number) {
    this._wsClients = count;
  }

  set tailerFilesWatched(count: number) {
    this._tailerFilesWatched = count;
  }

  set dedupDropped(count: number) {
    this._dedupDropped = count;
  }

  set eventCount(count: number) {
    this._eventCount = count;
  }

  private _retentionState: RetentionState | undefined;

  set retentionState(state: RetentionState | undefined) {
    this._retentionState = state;
  }

  private _pruneLastRunTimestamp = 0;
  private _pruneLastSuccessTimestamp = 0;
  private _logsDirBytes = 0;

  set pruneLastRunTimestamp(timestamp: number) {
    this._pruneLastRunTimestamp = timestamp;
  }

  set pruneLastSuccessTimestamp(timestamp: number) {
    this._pruneLastSuccessTimestamp = timestamp;
  }

  set logsDirBytes(bytes: number) {
    this._logsDirBytes = bytes;
  }

  reset(): void {
    this.startTime = Date.now();
    this.eventTimestamps = [];
    this._wsClients = 0;
    this._tailerFilesWatched = 0;
    this._eventCount = 0;
    this._dedupDropped = 0;
    this._pruneLastRunTimestamp = 0;
    this._pruneLastSuccessTimestamp = 0;
    this._logsDirBytes = 0;
    this.eventsPerHost.clear();
    this.eventTimestampsPerHost.clear();
  }

  private ingestRate(): number {
    const now = Date.now();
    // Keep only last 60s of timestamps
    const cutoff = now - 60_000;
    this.eventTimestamps = this.eventTimestamps.filter(t => t >= cutoff);

    if (this.eventTimestamps.length < 2) return 0;

    const spanSec = (now - this.eventTimestamps[0]) / 1000;
    if (spanSec < 0.001) return 0;

    return this.eventTimestamps.length / spanSec;
  }

  /** Get ingest rate for a specific host */
  private ingestRateForHost(host: string): number {
    const now = Date.now();
    const cutoff = now - 60_000;
    const timestamps = this.eventTimestampsPerHost.get(host);
    if (!timestamps) return 0;

    // Filter to last 60s
    const recentTimestamps = timestamps.filter(t => t >= cutoff);

    if (recentTimestamps.length < 2) return 0;

    const spanSec = (now - recentTimestamps[0]) / 1000;
    if (spanSec < 0.001) return 0;

    return recentTimestamps.length / spanSec;
  }

  snapshot(): ServerMetricsSnapshot {
    const rss = process.memoryUsage().rss;
    return {
      status: 'ok',
      uptime_sec: Math.round((Date.now() - this.startTime) / 1000),
      version: VERSION,
      event_count: this._eventCount,
      ingest_rate_per_sec: Math.round(this.ingestRate() * 100) / 100,
      ws_clients: this._wsClients,
      tailer_files_watched: this._tailerFilesWatched,
      dedup_dropped: this._dedupDropped,
      process_resident_memory_bytes: rss,
      retention: this._retentionState,
      prune_last_run_timestamp_seconds: this._pruneLastRunTimestamp || undefined,
      prune_last_success_timestamp_seconds: this._pruneLastSuccessTimestamp || undefined,
      logs_dir_bytes: this._logsDirBytes || undefined,
    };
  }

  /** Format snapshot as Prometheus text exposition format. */
  toPrometheus(snap: ServerMetricsSnapshot): string {
    const lines: string[] = [];
    const metric = (name: string, type: string, help: string, value: number | string, labels?: string) => {
      lines.push(`# HELP fabric_${name} ${help}`);
      lines.push(`# TYPE fabric_${name} ${type}`);
      if (labels) {
        lines.push(`fabric_${name}{${labels}} ${value}`);
      } else {
        lines.push(`fabric_${name} ${value}`);
      }
    };

    metric('status', 'gauge', 'Server status (1=ok)', snap.status === 'ok' ? 1 : 0);
    metric('uptime_seconds', 'gauge', 'Server uptime in seconds', snap.uptime_sec);
    metric('info', 'gauge', 'Build info', 1, `version="${snap.version}"`);
    metric('event_count', 'gauge', 'Total events in store', snap.event_count);
    metric('ingest_rate_per_second', 'gauge', 'Events ingested per second (60s window)', snap.ingest_rate_per_sec);
    metric('websocket_clients', 'gauge', 'Connected WebSocket clients', snap.ws_clients);
    metric('tailer_files_watched', 'gauge', 'Log files being watched', snap.tailer_files_watched);
    metric('dedup_dropped_total', 'counter', 'Total duplicate events dropped', snap.dedup_dropped);
    metric('process_resident_memory_bytes', 'gauge', 'Process RSS in bytes', snap.process_resident_memory_bytes);

    // Per-host metrics for multi-host aggregation
    for (const [host, count] of this.eventsPerHost) {
      const hostLabel = host ? `host="${host}"` : 'host="unknown"';
      const ingestRate = this.ingestRateForHost(host);
      metric('event_count', 'gauge', 'Total events in store by host', count, hostLabel);
      metric('ingest_rate_per_second', 'gauge', 'Events ingested per second by host (60s window)', ingestRate, hostLabel);
    }

    // Log retention metrics
    if (snap.prune_last_run_timestamp_seconds !== undefined) {
      metric('prune_last_run_timestamp_seconds', 'gauge', 'Last prune run attempt (Unix timestamp)', snap.prune_last_run_timestamp_seconds);
    }
    if (snap.prune_last_success_timestamp_seconds !== undefined) {
      metric('prune_last_success_timestamp_seconds', 'gauge', 'Last successful prune run (Unix timestamp)', snap.prune_last_success_timestamp_seconds);
    }
    if (snap.logs_dir_bytes !== undefined) {
      metric('logs_dir_bytes', 'gauge', 'Size of watched logs directory in bytes', snap.logs_dir_bytes);
    }

    return lines.join('\n') + '\n';
  }
}
