/**
 * FABRIC Server Metrics
 *
 * Collects and exposes internal metrics for /api/health and /api/metrics endpoints.
 */

import { VERSION } from './index.js';

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
}

export class ServerMetrics {
  private startTime = Date.now();
  private eventTimestamps: number[] = [];
  private _wsClients = 0;
  private _tailerFilesWatched = 0;
  private _eventCount = 0;
  private _dedupDropped = 0;

  recordEvent(): void {
    this._eventCount++;
    this.eventTimestamps.push(Date.now());
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

  reset(): void {
    this.startTime = Date.now();
    this.eventTimestamps = [];
    this._wsClients = 0;
    this._tailerFilesWatched = 0;
    this._eventCount = 0;
    this._dedupDropped = 0;
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

    return lines.join('\n') + '\n';
  }
}
