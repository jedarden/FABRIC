#!/usr/bin/env node
/**
 * gap-inventory-check.mjs — keep docs/gap-analysis.md honest against the bead store.
 *
 * docs/gap-analysis.md is the documented open-gap inventory for FABRIC. Its prose
 * claims bead statuses; this tool is the repeatable check that those claims still
 * match the live store, plus a `--fix` mode that regenerates the machine-readable
 * inventory block in place.
 *
 * Modes:
 *   --check     (default) compare the doc's generated inventory block against the
 *               bead store in both directions:
 *                 - store-open bead absent from the inventory  → the doc understates
 *                   live gaps (dangerous: work missing from the documented list)
 *                 - inventory bead closed in the store         → the doc overstates
 *                   remaining work (refresh with --fix)
 *               Also lints every `fabric-*` id cited anywhere in the doc against
 *               the store (catches phantom/typo'd ids).
 *   --fix       regenerate the inventory block from the store in place. Citation
 *               problems cannot be auto-fixed, so they still exit 1.
 *   --lint-doc  structural only: block present and parseable, all cited ids exist.
 *               No status comparison — safe to run continuously (vitest uses this).
 *
 * Data source: the bead checkpoint (.beads/checkpoint/current.json → active_root),
 * which bead-rs republishes after every mutation and which is committed at sweeps.
 * If the checkpoint is unreadable, falls back to `bead list --json`.
 *
 * Exit codes: 0 = in sync · 1 = drift or unknown-id citation · 2 = structural
 * error (missing doc/block/store) · 3 = no store source available.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');

const DEFAULT_DOC = join(repoRoot, 'docs', 'gap-analysis.md');
const DEFAULT_CHECKPOINT = join(repoRoot, '.beads', 'checkpoint');

const BEGIN = '<!-- gap-inventory:begin';
const END = 'gap-inventory:end -->';
const ID_RE = /fabric-[0-9a-f]{8}\b/g;

function usage(exitCode = 0) {
  const text = `Usage: node scripts/gap-inventory-check.mjs [--doc <path>] [--objects <dir>] [--check|--fix|--lint-doc]

  --doc <path>       gap-analysis document (default: docs/gap-analysis.md)
  --objects <dir>    checkpoint objects directory (default: .beads/checkpoint)
                     (accepts either the checkpoint dir or its objects/ subdir)
  --check            compare inventory block vs bead store (default)
  --fix              regenerate the inventory block from the store, in place
  --lint-doc         structural checks only, no status comparison
  -h, --help         this text
`;
  process.stdout.write(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const opts = { doc: DEFAULT_DOC, checkpoint: DEFAULT_CHECKPOINT, mode: 'check' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') usage(0);
    else if (a === '--doc') opts.doc = resolve(argv[++i] ?? usage(2));
    else if (a === '--objects') opts.checkpoint = resolve(argv[++i] ?? usage(2));
    else if (a === '--check') opts.mode = 'check';
    else if (a === '--fix') opts.mode = 'fix';
    else if (a === '--lint-doc') opts.mode = 'lint-doc';
    else {
      process.stderr.write(`[gap-inventory] unknown argument: ${a}\n`);
      usage(2);
    }
  }
  return opts;
}

/** Fold the active checkpoint generation into { id: { status, title, priority } }. */
function loadStoreFromCheckpoint(checkpointDir) {
  // Accept either the checkpoint dir or its objects/ subdir.
  let dir = checkpointDir;
  let activeRel;
  const manifestPath = join(dir, 'current.json');
  const parentManifestPath = join(dirname(dir), 'current.json');
  if (existsSync(manifestPath)) {
    try {
      activeRel = JSON.parse(readFileSync(manifestPath, 'utf8'))?.active_root?.path;
    } catch {
      activeRel = undefined;
    }
  } else if (existsSync(parentManifestPath)) {
    dir = dirname(dir);
    try {
      activeRel = JSON.parse(readFileSync(parentManifestPath, 'utf8'))?.active_root?.path;
    } catch {
      activeRel = undefined;
    }
  }

  const objectsDir = existsSync(join(dir, 'objects')) ? join(dir, 'objects') : dir;
  const candidates = existsSync(objectsDir)
    ? readdirSync(objectsDir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => join(objectsDir, f))
        .filter((f) => statSync(f).isFile())
    : [];
  if (candidates.length === 0) return null;

  // active_root.path is relative to the checkpoint dir (e.g. "objects/<sha>.jsonl").
  let activePath = activeRel ? resolve(dir, activeRel) : undefined;
  if (!activePath || !existsSync(activePath)) {
    // Fallback: the active generation is the largest monolithic dump.
    activePath = candidates.reduce((best, f) => {
      const a = readFileSync(f, 'utf8').split('\n').length;
      const b = readFileSync(best, 'utf8').split('\n').length;
      return a > b ? f : best;
    }, candidates[0]);
  }

  const store = new Map();
  for (const line of readFileSync(activePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec;
    try {
      rec = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (rec?.record_type !== 'issue' || !rec.issue?.id) continue;
    const iss = rec.issue;
    store.set(iss.id, {
      id: iss.id,
      status: iss.base_status ?? iss.status ?? 'open',
      title: iss.title ?? '',
      priority: typeof iss.priority === 'number' ? iss.priority : 9,
    });
  }
  return store.size > 0 ? store : null;
}

/** Last-resort store source: the live bead CLI. */
function loadStoreFromCli() {
  try {
    const out = execFileSync('bead', ['list', '--json', '--limit', '999999'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const store = new Map();
    for (const line of out.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const r = JSON.parse(trimmed);
        if (r?.id) {
          store.set(r.id, {
            id: r.id,
            status: r.status ?? 'open',
            title: r.title ?? '',
            priority: typeof r.priority === 'number' ? r.priority : 9,
          });
        }
      } catch {
        /* skip malformed line */
      }
    }
    return store.size > 0 ? store : null;
  } catch {
    return null;
  }
}

function loadStore(checkpointDir) {
  return loadStoreFromCheckpoint(checkpointDir) ?? loadStoreFromCli();
}

/**
 * Locate and parse the inventory block.
 * Returns { startIdx, endIdx, header, rows } or null when absent.
 */
function parseInventoryBlock(doc) {
  const lines = doc.split('\n');
  let startIdx = -1;
  let endIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (startIdx === -1 && lines[i].startsWith(BEGIN)) startIdx = i;
    else if (startIdx !== -1 && lines[i].includes(END)) {
      endIdx = i;
      break;
    }
  }
  if (startIdx === -1 || endIdx === -1) return null;
  const body = lines.slice(startIdx + 1, endIdx);
  const rows = [];
  let header;
  for (const line of body) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const cols = trimmed.split('\t');
    if (!header && (cols[0] === 'bead_id' || cols[0] === 'id')) {
      header = cols;
      continue;
    }
    rows.push({ id: cols[0], status: cols[1] ?? '', priority: cols[2] ?? '', title: cols.slice(3).join('\t') });
  }
  return { startIdx, endIdx, header, rows };
}

function formatInventoryBlock(store) {
  const open = [...store.values()]
    .filter((b) => b.status === 'open' || b.status === 'in_progress')
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const lines = [
    `${BEGIN} (generated by scripts/gap-inventory-check.mjs — do not hand-edit; refresh: node scripts/gap-inventory-check.mjs --fix)`,
    'bead_id\tstatus\tpriority\ttitle',
    ...open.map((b) => [b.id, b.status, String(b.priority), b.title].join('\t')),
    END,
  ];
  return lines;
}

function citedIds(docText) {
  return [...new Set(docText.match(ID_RE) ?? [])];
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!existsSync(opts.doc)) {
    console.error(`[gap-inventory] structural: document not found: ${opts.doc}`);
    process.exit(2);
  }
  const doc = readFileSync(opts.doc, 'utf8');
  const store = loadStore(opts.checkpoint);
  if (!store) {
    console.error('[gap-inventory] no store source available (checkpoint unreadable, bead CLI unavailable)');
    process.exit(3);
  }

  const block = parseInventoryBlock(doc);
  const citations = citedIds(doc);
  const unknownCitations = citations.filter((id) => !store.has(id));

  if (opts.mode === 'lint-doc') {
    if (!block) {
      console.error('[gap-inventory] structural: inventory block missing (expected gap-inventory:begin/end markers)');
      process.exit(2);
    }
    if (block.rows.some((r) => !r.id || !r.status)) {
      console.error('[gap-inventory] structural: malformed inventory row (expected TSV: id, status, priority, title)');
      process.exit(2);
    }
    if (unknownCitations.length > 0) {
      for (const id of unknownCitations) {
        console.error(`[gap-inventory] drift: doc cites ${id}, which does not exist in the bead store`);
      }
      process.exit(1);
    }
    console.log(
      `[gap-inventory] lint OK: ${block.rows.length} inventory rows parse; ${citations.length} distinct cited ids all exist in the store`,
    );
    process.exit(0);
  }

  if (!block) {
    console.error('[gap-inventory] structural: inventory block missing (expected gap-inventory:begin/end markers)');
    process.exit(2);
  }

  const storeOpen = [...store.values()].filter((b) => b.status === 'open' || b.status === 'in_progress');
  const inventoryIds = new Set(block.rows.map((r) => r.id));

  const understated = storeOpen.filter((b) => !inventoryIds.has(b.id));
  const overstated = block.rows.filter((r) => {
    const b = store.get(r.id);
    return !b || (b.status !== 'open' && b.status !== 'in_progress');
  });

  if (opts.mode === 'fix') {
    const regenerated = formatInventoryBlock(store);
    const lines = doc.split('\n');
    const replacement = [...regenerated];
    lines.splice(block.startIdx, block.endIdx - block.startIdx + 1, ...replacement);
    writeFileSync(opts.doc, lines.join('\n'));
    console.log(
      `[gap-inventory] fix: rewrote inventory block with ${storeOpen.length} open/in_progress beads (was ${block.rows.length} rows)`,
    );
    if (unknownCitations.length > 0) {
      for (const id of unknownCitations) {
        console.error(`[gap-inventory] drift (not auto-fixable): doc cites ${id}, which does not exist in the bead store`);
      }
      process.exit(1);
    }
    process.exit(0);
  }

  // --check
  let drift = false;
  for (const b of understated) {
    drift = true;
    console.error(`[gap-inventory] drift (doc understates): ${b.id} is ${b.status} in the store but absent from the inventory — refresh with --fix`);
  }
  for (const r of overstated) {
    const b = store.get(r.id);
    drift = true;
    const why = b ? `is ${b.status} in the store` : 'does not exist in the store';
    console.error(`[gap-inventory] drift (doc overstates): inventory lists ${r.id}, which ${why} — refresh with --fix`);
  }
  for (const id of unknownCitations) {
    drift = true;
    console.error(`[gap-inventory] drift (citation): doc cites ${id}, which does not exist in the bead store`);
  }

  if (drift) {
    console.error(
      `[gap-inventory] NOT in sync: ${understated.length} understated, ${overstated.length} overstated, ${unknownCitations.length} unknown citations`,
    );
    process.exit(1);
  }
  console.log(
    `[gap-inventory] in sync: ${storeOpen.length} open/in_progress beads match the inventory; ${citations.length} distinct cited ids verified`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(`[gap-inventory] unexpected failure: ${err?.stack ?? err}`);
  process.exit(2);
});
