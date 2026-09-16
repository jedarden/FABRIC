/**
 * Tests for the heap snapshot / memory analysis API endpoints.
 *
 * Covers the endpoints documented in docs/heap-snapshot-retention.md —
 * POST /api/memory/heap-snapshot, GET /api/memory/snapshots,
 * GET /api/memory/diff-analysis, GET /api/memory/trend,
 * GET /api/memory/trend.md, POST /api/memory/trend/save — including
 * their authentication and invalid-input behavior.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { createWebServer, WebServer } from './server.js';
import { InMemoryEventStore } from '../store.js';
import { resetCrossReferenceManager } from '../crossReferenceManager.js';
import { getMemoryProfiler } from '../memoryProfiler.js';

// Isolate from the live service's snapshot directory BEFORE the server (and
// its memoryProfiler/heapDiff imports) resolves it — same pattern as
// memoryProfiler.test.ts. The endpoint tests below write real heap snapshots
// and must not touch ~/.needle/snapshots, nor have the running fabric-web
// process's own writes break exact-count assertions here.
const { SNAPSHOT_DIR } = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? '/tmp'}/fabric-heap-api-test-${process.pid}-${Date.now()}`;
  process.env.FABRIC_SNAPSHOT_DIR = dir;
  return { SNAPSHOT_DIR: dir };
});

/** Placeholder .heapsnapshot with controlled size and mtime — the analysis
 *  endpoints only stat these files, never parse them. */
function writeFakeSnapshot(filename: string, sizeBytes: number, ageMs: number): string {
  const filepath = path.join(SNAPSHOT_DIR, filename);
  fs.writeFileSync(filepath, '');
  fs.truncateSync(filepath, sizeBytes); // sparse: stat.size reports sizeBytes
  const mtime = new Date(Date.now() - ageMs);
  fs.utimesSync(filepath, mtime, mtime);
  return filepath;
}

describe('Memory & Heap Snapshot API', () => {
  let store: InMemoryEventStore;
  let server: WebServer;
  let port: number;
  const AUTH_TOKEN = 'test-heap-secret-token-67890';

  beforeEach(async () => {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    // Reset disk state: snapshots from prior tests and any saved reports.
    for (const file of fs.readdirSync(SNAPSHOT_DIR)) {
      fs.rmSync(path.join(SNAPSHOT_DIR, file), { recursive: true, force: true });
    }

    store = new InMemoryEventStore();
    resetCrossReferenceManager();

    server = createWebServer({
      port: 0, // OS-assigned; see server.test.ts
      logPath: '/tmp/test-logs',
      store,
      authToken: AUTH_TOKEN,
    });

    await new Promise<void>((resolve) => {
      server.on('start', () => resolve());
      server.start();
    });
    port = server.getPort();
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.on('stop', () => resolve());
      server.stop();
    });
    store.clear();
    resetCrossReferenceManager();
  });

  afterAll(() => {
    fs.rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
  });

  const fetchApi = async (p: string, options?: RequestInit) => {
    return fetch(`http://localhost:${port}${p}`, options);
  };

  const authJson = (body?: unknown, token: string = AUTH_TOKEN): RequestInit => ({
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  describe('POST /api/memory/heap-snapshot', () => {
    it('should reject without Authorization header with 401', async () => {
      const response = await fetchApi('/api/memory/heap-snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger: 'manual' }),
      });

      expect(response.status).toBe(401);
      const data = await response.json() as any;
      expect(data.error).toBe('Missing authorization');
      // Rejected before the handler: no snapshot was written.
      expect(fs.readdirSync(SNAPSHOT_DIR).filter(f => f.endsWith('.heapsnapshot'))).toHaveLength(0);
    });

    it('should reject a wrong token with 403', async () => {
      const response = await fetchApi('/api/memory/heap-snapshot', authJson({ trigger: 'manual' }, 'wrong-token'));

      expect(response.status).toBe(403);
      const data = await response.json() as any;
      expect(data.error).toBe('Forbidden');
      expect(fs.readdirSync(SNAPSHOT_DIR).filter(f => f.endsWith('.heapsnapshot'))).toHaveLength(0);
    });

    it('should default the trigger to manual when no body is sent', { timeout: 60_000 }, async () => {
      const response = await fetchApi('/api/memory/heap-snapshot', authJson());

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(data.success).toBe(true);
      expect(data.trigger).toBe('manual');
      // Written inside the isolated snapshot directory, named for the trigger.
      expect(data.filepath).toContain(SNAPSHOT_DIR);
      expect(data.filepath).toMatch(/heap-\d+-manual\.heapsnapshot$/);
      expect(fs.existsSync(data.filepath)).toBe(true);
    });

    it('should honor an explicit documented trigger', { timeout: 60_000 }, async () => {
      const response = await fetchApi('/api/memory/heap-snapshot', authJson({ trigger: 'oom-risk' }));

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(data.success).toBe(true);
      expect(data.trigger).toBe('oom-risk');
      expect(data.filepath).toMatch(/heap-\d+-oom-risk\.heapsnapshot$/);
      expect(data.message).toContain(data.filepath);
      expect(fs.existsSync(data.filepath)).toBe(true);
    });

    it('should reject an undocumented trigger value with 400', async () => {
      // The trigger becomes part of the on-disk filename, so arbitrary values
      // (including path fragments) must not reach the write path.
      const response = await fetchApi('/api/memory/heap-snapshot', authJson({ trigger: '../../evil' }));

      expect(response.status).toBe(400);
      const data = await response.json() as any;
      expect(data.error).toBe('Invalid trigger');
      expect(data.message).toContain('manual');
      expect(fs.readdirSync(SNAPSHOT_DIR).filter(f => f.endsWith('.heapsnapshot'))).toHaveLength(0);
    });

    it('should reject a non-string trigger with 400', async () => {
      const response = await fetchApi('/api/memory/heap-snapshot', authJson({ trigger: 123 }));

      expect(response.status).toBe(400);
      expect(fs.readdirSync(SNAPSHOT_DIR).filter(f => f.endsWith('.heapsnapshot'))).toHaveLength(0);
    });

    it('should reject an empty trigger string with 400', async () => {
      const response = await fetchApi('/api/memory/heap-snapshot', authJson({ trigger: '' }));

      expect(response.status).toBe(400);
    });

    it('should reject malformed JSON body with 400', async () => {
      const response = await fetchApi('/api/memory/heap-snapshot', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AUTH_TOKEN}`,
        },
        body: 'not valid json',
      });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/memory/snapshots (in-memory)', () => {
    it('should return at most the last 10 snapshots by default', async () => {
      const profiler = getMemoryProfiler();
      for (let i = 0; i < 12; i++) {
        profiler.capture();
      }

      const response = await fetchApi('/api/memory/snapshots');
      expect(response.status).toBe(200);

      const data = await response.json() as any;
      expect(data.count).toBe(10);
      expect(data.snapshots).toHaveLength(10);
      for (const snapshot of data.snapshots) {
        expect(snapshot.timestamp).toBeGreaterThan(0);
        expect(snapshot.rss).toBeGreaterThan(0);
        expect(snapshot.heapUsed).toBeGreaterThan(0);
        expect(snapshot.heapTotal).toBeGreaterThan(0);
      }
    });

    it('should honor a numeric count parameter', async () => {
      const profiler = getMemoryProfiler();
      for (let i = 0; i < 5; i++) {
        profiler.capture();
      }

      const response = await fetchApi('/api/memory/snapshots?count=3');
      const data = await response.json() as any;

      expect(response.status).toBe(200);
      expect(data.count).toBe(3);
      expect(data.snapshots).toHaveLength(3);
    });

    it('should fall back to 10 for a non-numeric count parameter', async () => {
      const response = await fetchApi('/api/memory/snapshots?count=abc');
      const data = await response.json() as any;

      expect(response.status).toBe(200);
      // parseInt('abc') is NaN, so the endpoint serves its default of 10
      // (fewer only if fewer than 10 exist in memory).
      expect(data.count).toBeLessThanOrEqual(10);
      expect(data.snapshots).toHaveLength(data.count);
    });
  });

  describe('GET /api/memory/diff-analysis', () => {
    it('should return 404 with fewer than two snapshots on disk', async () => {
      writeFakeSnapshot('heap-7000000-manual.heapsnapshot', 1024, 60_000);

      const response = await fetchApi('/api/memory/diff-analysis');

      expect(response.status).toBe(404);
      const data = await response.json() as any;
      expect(data.error).toBe('Insufficient snapshots for diff analysis');
    });

    it('should return a diff of the recent snapshots', async () => {
      writeFakeSnapshot('heap-7000001-manual.heapsnapshot', 1024, 30 * 60_000);
      writeFakeSnapshot('heap-7000002-periodic.heapsnapshot', 3 * 1024, 60_000);

      const response = await fetchApi('/api/memory/diff-analysis');

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(data.baseline.filename).toBe('heap-7000001-manual.heapsnapshot');
      expect(data.current.filename).toBe('heap-7000002-periodic.heapsnapshot');
      expect(data.durationMs).toBeGreaterThan(0);
      expect(data.sizeGrowthBytes).toBe(2 * 1024);
      // 1024B -> 3KB over ~30 minutes: +200%, slow rate => "growing"
      expect(['stable', 'growing', 'leaking', 'unknown']).toContain(data.assessment);
      expect(Array.isArray(data.recommendations)).toBe(true);
    });
  });

  describe('GET /api/memory/trend', () => {
    it('should report insufficient-data (still 200) with fewer than two snapshots', async () => {
      const response = await fetchApi('/api/memory/trend');

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(data.overallAssessment).toBe('insufficient-data');
      expect(data.snapshots).toEqual([]);
      expect(data.diffs).toEqual([]);
      expect(data.avgGrowthRateMbPerHour).toBe(0);
      expect(data.projectedGrowth24hMb).toBe(0);
    });

    it('should analyze consecutive snapshots when at least two exist', async () => {
      writeFakeSnapshot('heap-7000003-manual.heapsnapshot', 1024, 30 * 60_000);
      writeFakeSnapshot('heap-7000004-periodic.heapsnapshot', 3 * 1024, 60_000);

      const response = await fetchApi('/api/memory/trend');

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(data.snapshots).toHaveLength(2);
      expect(data.diffs).toHaveLength(1);
      expect(data.overallAssessment).toBe('growing');
      expect(typeof data.avgGrowthRateMbPerHour).toBe('number');
      expect(typeof data.projectedGrowth24hMb).toBe('number');
    });
  });

  describe('GET /api/memory/trend.md', () => {
    it('should return 404 with insufficient data', async () => {
      const response = await fetchApi('/api/memory/trend.md');

      expect(response.status).toBe(404);
      const data = await response.json() as any;
      expect(data.error).toBe('Insufficient snapshots for trend analysis');
    });

    it('should return a markdown report with sufficient data', async () => {
      writeFakeSnapshot('heap-7000005-manual.heapsnapshot', 1024, 30 * 60_000);
      writeFakeSnapshot('heap-7000006-periodic.heapsnapshot', 3 * 1024, 60_000);

      const response = await fetchApi('/api/memory/trend.md');

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/markdown');
      const text = await response.text();
      expect(text).toContain('# Heap Trend Analysis');
      expect(text).toContain('GROWING');
    });
  });

  describe('POST /api/memory/trend/save', () => {
    it('should reject without Authorization header with 401', async () => {
      const response = await fetchApi('/api/memory/trend/save', { method: 'POST' });

      expect(response.status).toBe(401);
      const data = await response.json() as any;
      expect(data.error).toBe('Missing authorization');
    });

    it('should reject a wrong token with 403', async () => {
      const response = await fetchApi('/api/memory/trend/save', authJson(undefined, 'wrong-token'));

      expect(response.status).toBe(403);
    });

    it('should return 404 with insufficient data', async () => {
      const response = await fetchApi('/api/memory/trend/save', authJson());

      expect(response.status).toBe(404);
      const data = await response.json() as any;
      expect(data.error).toBe('Insufficient snapshots for trend report');
      // No report directory was created for the failed save.
      expect(fs.existsSync(path.join(SNAPSHOT_DIR, 'reports'))).toBe(false);
    });

    it('should save a markdown report into the snapshots reports directory', async () => {
      writeFakeSnapshot('heap-7000007-manual.heapsnapshot', 1024, 30 * 60_000);
      writeFakeSnapshot('heap-7000008-periodic.heapsnapshot', 3 * 1024, 60_000);

      const response = await fetchApi('/api/memory/trend/save', authJson());

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(data.success).toBe(true);
      expect(data.filepath).toContain(path.join(SNAPSHOT_DIR, 'reports'));
      expect(data.filepath).toMatch(/trend-report-\d+\.md$/);
      expect(data.message).toContain(data.filepath);

      const report = fs.readFileSync(data.filepath, 'utf-8');
      expect(report).toContain('# Heap Trend Analysis');
    });
  });

  describe('GET endpoints are read-only and unaffected by auth', () => {
    it('should allow the analysis GETs without a token', async () => {
      writeFakeSnapshot('heap-7000009-manual.heapsnapshot', 1024, 30 * 60_000);
      writeFakeSnapshot('heap-7000010-periodic.heapsnapshot', 3 * 1024, 60_000);

      for (const endpoint of ['/api/memory/snapshots', '/api/memory/diff-analysis', '/api/memory/trend', '/api/memory/trend.md']) {
        const response = await fetchApi(endpoint);
        expect(response.status).toBe(200);
      }
    });
  });
});
