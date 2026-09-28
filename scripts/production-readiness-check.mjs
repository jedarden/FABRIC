#!/usr/bin/env node

/**
 * Live production-readiness gate for the web-display phase.
 *
 * This is deliberately fail-closed. A healthy process and a passing unit suite
 * are not enough to call the phase production-ready: the gate also checks the
 * OTLP listener, unauthenticated POST rejection, retention policy/recency,
 * pruning timer state, and the open readiness-related bead inventory.
 *
 * No credential is read or emitted. The auth checks intentionally send no
 * Authorization header and expect rejection before any request is ingested.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_CHECKPOINT = join(repoRoot, '.beads', 'checkpoint');
const DEFAULT_BASE_URL = 'http://127.0.0.1:3000';
const DEFAULT_OTLP_HOST = '127.0.0.1';
const DEFAULT_OTLP_PORT = 4318;
const DEFAULT_MAX_PRUNE_AGE_HOURS = 36;
const DEFAULT_IGNORED_IDS = new Set(['fabric-ff926483']);

// These are the status-bearing owners linked from docs/gap-analysis.md. The
// keyword fallback below also catches a newly-created owner before the docs
// are refreshed, while this explicit set keeps split children visible even
// when their titles are narrowly phrased (for example, label escaping).
const READINESS_OWNER_IDS = new Set([
  'fabric-0a4e421b',
  'fabric-37c4b812',
  'fabric-45dc56ba',
  'fabric-86bfc356',
  'fabric-96975906',
  'fabric-f0f1c757',
]);
const READINESS_KEYWORDS = /dashboard|fabric-web|outage|unresponsive|prun|otlp|auth|production|readiness|ingress|self-observability/i;

function usage(exitCode = 0) {
  console.log(`Usage: node scripts/production-readiness-check.mjs [options]

  --base-url <url>              FABRIC HTTP URL (default: ${DEFAULT_BASE_URL})
  --otlp-host <host>            OTLP TCP host (default: ${DEFAULT_OTLP_HOST})
  --otlp-port <port>            OTLP TCP port (default: ${DEFAULT_OTLP_PORT})
  --checkpoint <path>           bead checkpoint directory
  --max-prune-age-hours <n>     freshness limit (default: ${DEFAULT_MAX_PRUNE_AGE_HOURS})
  --ignore-id <id>              readiness owner to ignore; repeatable
  --skip-systemd                skip systemd checks (for isolated test fixtures)
  --json                        emit a machine-readable report
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.FABRIC_READINESS_BASE_URL || DEFAULT_BASE_URL,
    otlpHost: process.env.FABRIC_READINESS_OTLP_HOST || DEFAULT_OTLP_HOST,
    otlpPort: Number(process.env.FABRIC_READINESS_OTLP_PORT || DEFAULT_OTLP_PORT),
    checkpoint: resolve(process.env.FABRIC_READINESS_CHECKPOINT || DEFAULT_CHECKPOINT),
    maxPruneAgeHours: Number(process.env.FABRIC_READINESS_MAX_PRUNE_AGE_HOURS || DEFAULT_MAX_PRUNE_AGE_HOURS),
    ignoredIds: new Set([
      ...DEFAULT_IGNORED_IDS,
      ...(process.env.FABRIC_READINESS_IGNORE_IDS || '').split(',').map((id) => id.trim()).filter(Boolean),
    ]),
    skipSystemd: process.env.FABRIC_READINESS_SKIP_SYSTEMD === '1',
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') usage(0);
    else if (arg === '--base-url') options.baseUrl = argv[++i] ?? usage(2);
    else if (arg === '--otlp-host') options.otlpHost = argv[++i] ?? usage(2);
    else if (arg === '--otlp-port') options.otlpPort = Number(argv[++i] ?? usage(2));
    else if (arg === '--checkpoint') options.checkpoint = resolve(argv[++i] ?? usage(2));
    else if (arg === '--max-prune-age-hours') options.maxPruneAgeHours = Number(argv[++i] ?? usage(2));
    else if (arg === '--ignore-id') options.ignoredIds.add(argv[++i] ?? usage(2));
    else if (arg === '--skip-systemd') options.skipSystemd = true;
    else if (arg === '--json') options.json = true;
    else {
      console.error(`Unknown argument: ${arg}`);
      usage(2);
    }
  }

  if (!Number.isInteger(options.otlpPort) || options.otlpPort < 1 || options.otlpPort > 65535) {
    throw new Error(`Invalid OTLP port: ${options.otlpPort}`);
  }
  if (!Number.isFinite(options.maxPruneAgeHours) || options.maxPruneAgeHours <= 0) {
    throw new Error(`Invalid prune freshness window: ${options.maxPruneAgeHours}`);
  }
  return options;
}

function commandSucceeded(command, args) {
  try {
    execFileSync(command, args, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

function commandOutput(command, args) {
  try {
    return execFileSync(command, args, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function check(name, passed, detail) {
  return { name, passed, detail };
}

async function fetchJson(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}

function checkTcp(host, port) {
  return new Promise((resolveCheck) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (passed) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveCheck(passed);
    };
    socket.setTimeout(2000, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

function parseCheckpoint(checkpointDir) {
  const manifestPath = existsSync(join(checkpointDir, 'current.json'))
    ? join(checkpointDir, 'current.json')
    : join(dirname(checkpointDir), 'current.json');
  if (!existsSync(manifestPath)) return { issues: [], error: `checkpoint manifest not found: ${manifestPath}` };

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return { issues: [], error: `checkpoint manifest unreadable: ${manifestPath}` };
  }

  const baseDir = dirname(manifestPath);
  const activePath = resolve(baseDir, manifest.active_root?.path || '');
  if (!existsSync(activePath)) return { issues: [], error: `active checkpoint not found: ${activePath}` };

  const issues = [];
  for (const line of readFileSync(activePath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const issue = JSON.parse(line).issue;
      if (issue && ['open', 'in_progress'].includes(issue.base_status)) issues.push(issue);
    } catch {
      // A malformed checkpoint line is ignored here; the inventory checker
      // remains responsible for reporting structural corruption.
    }
  }
  return { issues };
}

function findReadinessOwners(checkpoint, ignoredIds) {
  if (checkpoint.error) return { owners: [], error: checkpoint.error };
  const owners = checkpoint.issues
    .filter((issue) => !ignoredIds.has(issue.id))
    .filter((issue) => READINESS_OWNER_IDS.has(issue.id) || READINESS_KEYWORDS.test(issue.title || ''))
    .map((issue) => ({
      id: issue.id,
      status: issue.base_status,
      priority: issue.priority,
      title: issue.title,
    }))
    .sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9) || a.id.localeCompare(b.id));
  return { owners };
}

function parseTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

async function run(options) {
  const checks = [];
  const baseUrl = options.baseUrl.replace(/\/$/, '');

  if (options.skipSystemd) {
    checks.push(check('fabric-web.service', true, 'skipped by --skip-systemd'));
    checks.push(check('fabric-prune.timer', true, 'skipped by --skip-systemd'));
  } else {
    checks.push(check(
      'fabric-web.service',
      commandOutput('systemctl', ['--user', 'is-active', 'fabric-web.service']) === 'active',
      'systemctl --user is-active fabric-web.service',
    ));
    const timerEnabled = commandSucceeded('systemctl', ['--user', 'is-enabled', 'fabric-prune.timer']);
    const timerActive = commandSucceeded('systemctl', ['--user', 'is-active', 'fabric-prune.timer']);
    checks.push(check(
      'fabric-prune.timer',
      timerEnabled && timerActive,
      `enabled=${timerEnabled} active=${timerActive}`,
    ));
  }

  let health;
  try {
    health = await fetchJson(`${baseUrl}/api/health`);
    const passed = health.response.ok && health.body?.status === 'ok' && typeof health.body?.tailer_files_watched === 'number';
    checks.push(check('web health', passed, `HTTP ${health.response.status}; status=${health.body?.status ?? 'invalid'}`));
  } catch (error) {
    checks.push(check('web health', false, error instanceof Error ? error.message : String(error)));
  }

  const otlpListening = await checkTcp(options.otlpHost, options.otlpPort);
  checks.push(check('OTLP listener', otlpListening, `${options.otlpHost}:${options.otlpPort}`));

  try {
    const nativeAuth = await fetchJson(`${baseUrl}/api/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const passed = nativeAuth.response.status === 401 || nativeAuth.response.status === 403;
    checks.push(check('native POST auth', passed, `HTTP ${nativeAuth.response.status}; rejection expected`));
  } catch (error) {
    checks.push(check('native POST auth', false, error instanceof Error ? error.message : String(error)));
  }

  try {
    const otlpAuth = await fetchJson(`http://${options.otlpHost}:${options.otlpPort}/v1/logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const passed = otlpAuth.response.status === 401 || otlpAuth.response.status === 403;
    checks.push(check('OTLP POST auth', passed, `HTTP ${otlpAuth.response.status}; rejection expected`));
  } catch (error) {
    checks.push(check('OTLP POST auth', false, error instanceof Error ? error.message : String(error)));
  }

  try {
    const retention = await fetchJson(`${baseUrl}/api/retention`);
    const policyFields = ['archiveAfterDays', 'maxAgeDays', 'archiveRetentionDays'];
    const policyConfigured = policyFields.every((field) => Number.isFinite(retention.body?.policy?.[field]) && retention.body.policy[field] > 0);
    const lastPruneMs = parseTimestamp(retention.body?.lastPrune?.timestamp);
    const pruneAgeHours = lastPruneMs === undefined ? Infinity : (Date.now() - lastPruneMs) / 3_600_000;
    const passed = retention.response.ok && policyConfigured && pruneAgeHours <= options.maxPruneAgeHours;
    checks.push(check(
      'retention/pruning',
      passed,
      `HTTP ${retention.response.status}; policy_configured=${policyConfigured}; last_prune_age_hours=${Number.isFinite(pruneAgeHours) ? pruneAgeHours.toFixed(1) : 'unknown'}`,
    ));
  } catch (error) {
    checks.push(check('retention/pruning', false, error instanceof Error ? error.message : String(error)));
  }

  const ownerResult = findReadinessOwners(parseCheckpoint(options.checkpoint), options.ignoredIds);
  const ownerDetail = ownerResult.error || (ownerResult.owners.length === 0
    ? 'no open readiness owners'
    : ownerResult.owners.map((owner) => `${owner.id} (${owner.status}, P${owner.priority ?? '?'})`).join(', '));
  checks.push(check('readiness bead inventory', !ownerResult.error && ownerResult.owners.length === 0, ownerDetail));

  return {
    ready: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    checks,
    ignoredOwnerIds: [...options.ignoredIds],
  };
}

const options = parseArgs(process.argv.slice(2));
const report = await run(options);
if (options.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const item of report.checks) console.log(`${item.passed ? 'PASS' : 'FAIL'} ${item.name}: ${item.detail}`);
  console.log(report.ready ? 'READY: production readiness gate passed' : 'BLOCKED: production readiness gate failed');
}
process.exitCode = report.ready ? 0 : 1;
