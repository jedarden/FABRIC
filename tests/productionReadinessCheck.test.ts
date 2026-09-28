import { describe, expect, it, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const script = join(repoRoot, 'scripts', 'production-readiness-check.mjs');
const tempDirs: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolveClose) => server.close(() => resolveClose()))));
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function checkpointFixture(issueLines: object[] = []): string {
  const dir = mkdtempSync(join(repoRoot, 'tmp', 'readiness-check-'));
  tempDirs.push(dir);
  const objects = join(dir, 'objects');
  mkdirSync(objects);
  const objectName = `${'a'.repeat(64)}.jsonl`;
  writeFileSync(join(objects, objectName), `${issueLines.map((issue) => JSON.stringify({ record_type: 'issue', issue })).join('\n')}\n`);
  writeFileSync(join(dir, 'current.json'), JSON.stringify({ active_root: { path: `objects/${objectName}` } }));
  return dir;
}

async function listen(server: Server): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', () => resolveListen()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not expose a TCP address');
  return address.port;
}

async function runGate(args: string[]) {
  try {
    const result = await execFileAsync('node', [script, ...args], { cwd: repoRoot, encoding: 'utf8' });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

function readinessApi(retention: object) {
  return createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/api/health') {
      response.end(JSON.stringify({ status: 'ok', tailer_files_watched: 1 }));
      return;
    }
    if (request.url === '/api/retention') {
      response.end(JSON.stringify(retention));
      return;
    }
    if (request.url === '/api/events' && request.method === 'POST') {
      response.statusCode = 401;
      response.end(JSON.stringify({ error: 'Missing authorization' }));
      return;
    }
    response.statusCode = 404;
    response.end('{}');
  });
}

function otlpAuthApi() {
  return createServer((request, response) => {
    if (request.url === '/v1/logs' && request.method === 'POST') {
      response.statusCode = 401;
      response.end(JSON.stringify({ error: 'Missing authorization' }));
      return;
    }
    response.statusCode = 404;
    response.end();
  });
}

describe('production-readiness-check', () => {
  it('is wired as an executable opt-in npm command', () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.['readiness:check']).toBe('node scripts/production-readiness-check.mjs');
    expect(existsSync(script)).toBe(true);
    expect(statSync(script).mode & 0o111).toBeGreaterThan(0);
  });

  it('passes only when live endpoints, auth, retention, and inventory are ready', async () => {
    const now = new Date().toISOString();
    const apiPort = await listen(readinessApi({
      policy: { archiveAfterDays: 3, maxAgeDays: 7, archiveRetentionDays: 30 },
      lastPrune: { timestamp: now },
    }));
    const otlpPort = await listen(otlpAuthApi());
    const checkpoint = checkpointFixture();

    const result = await runGate([
      '--base-url', `http://127.0.0.1:${apiPort}`,
      '--otlp-port', String(otlpPort),
      '--checkpoint', checkpoint,
      '--skip-systemd',
      '--json',
    ]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).ready).toBe(true);
  });

  it('blocks an open readiness owner and missing prune evidence', async () => {
    const apiPort = await listen(readinessApi({
      policy: { archiveAfterDays: null, maxAgeDays: null, archiveRetentionDays: null },
      lastPrune: null,
    }));
    const otlpPort = await listen(otlpAuthApi());
    const checkpoint = checkpointFixture([{
      id: 'fabric-0a4e421b',
      base_status: 'open',
      priority: 1,
      title: 'Audit retention pruning tests',
    }]);

    const result = await runGate([
      '--base-url', `http://127.0.0.1:${apiPort}`,
      '--otlp-port', String(otlpPort),
      '--checkpoint', checkpoint,
      '--skip-systemd',
      '--json',
    ]);

    expect(result.code).toBe(1);
    const report = JSON.parse(result.stdout) as { ready: boolean; checks: Array<{ name: string; passed: boolean; detail: string }> };
    expect(report.ready).toBe(false);
    expect(report.checks.find((item) => item.name === 'retention/pruning')?.passed).toBe(false);
    expect(report.checks.find((item) => item.name === 'readiness bead inventory')?.detail).toContain('fabric-0a4e421b');
  });
});
