/**
 * Documentation check: the TUI view model vs its documentation.
 *
 * src/tui/app.ts is the source of truth for the TUI's view machine (the
 * `viewMode` union plus one `screen.key` binding per overlay view). This
 * test locks the two documentation surfaces that describe it to that
 * source, so adding, removing, or rebinding a view without updating the
 * docs fails here:
 *
 *   - docs/FileHeatmap-Integration.md, § "View Management" (the full
 *     13-state table: `default` + twelve overlays, entry keys, exit keys)
 *   - docs/cli.md, § "Views — entry and exit" (per-view header + enter key)
 *
 * When this test fails after a view change, update both tables in the same
 * commit. The parsers below intentionally read the source rather than
 * importing it: the app cannot be instantiated headlessly, and the docs are
 * plain text.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP_TS = 'src/tui/app.ts';
const HEATMAP_DOC = 'docs/FileHeatmap-Integration.md';
const CLI_DOC = 'docs/cli.md';

function readRepo(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

/** The `viewMode` union in app.ts is the authoritative view list. */
function parseViewModes(appSource: string): string[] {
  const decl = appSource.match(/private viewMode:([^=]+)=/);
  expect(decl, 'viewMode union declaration exists in app.ts').toBeTruthy();
  return [...decl![1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
}

interface ViewBinding {
  mode: string;
  keys: string[];
}

/**
 * Screen-level view bindings look like:
 *   this.screen.key(['H', 'h'], () => {
 *     (optional comment lines)
 *     this.toggleHeatmapView();
 *   });
 * toggleXView() names map to viewMode ids by lowercasing the first letter.
 */
function parseViewKeyBindings(appSource: string): ViewBinding[] {
  const re =
    /this\.screen\.key\(\[([^\]]*)\],\s*\(\)\s*=>\s*\{[^}]*?this\.(toggle\w+View)\(\);/g;
  const bindings: ViewBinding[] = [];
  for (const m of appSource.matchAll(re)) {
    const keys = m[1]
      .split(',')
      .map((k) => k.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
    const camel = m[2].replace(/^toggle/, '').replace(/View$/, '');
    bindings.push({ mode: camel.charAt(0).toLowerCase() + camel.slice(1), keys });
  }
  return bindings;
}

/**
 * Header titles per overlay mode, from the setViewMode() branches: each
 * `mode === 'X'` marker is followed by headerBox.setContent(' FABRIC - Y').
 * The default view builds its header in getHeaderContent().
 */
function parseViewHeaders(appSource: string): Map<string, string> {
  const markers = [...appSource.matchAll(/\bmode === '(\w+)'/g)].map((m) => ({
    index: m.index!,
    mode: m[1],
  }));
  const headers = [...appSource.matchAll(/headerBox\.setContent\(' FABRIC - ([^']+)'\);/g)].map(
    (m) => ({ index: m.index!, title: m[1] })
  );
  const map = new Map<string, string>();
  for (const h of headers) {
    const owner = markers.filter((mk) => mk.index < h.index).at(-1);
    if (owner) map.set(owner.mode, h.title);
  }
  return map;
}

/** Markdown table rows (as pipe-split cells) under a header row containing `headerCell`. */
function parseTableRows(markdown: string, headerCell: string): string[][] {
  const lines = markdown.split('\n');
  const headerIdx = lines.findIndex((l) => l.includes(headerCell));
  expect(headerIdx, `table with header containing "${headerCell}" exists`).toBeGreaterThanOrEqual(0);
  const rows: string[][] = [];
  for (let i = headerIdx + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith('|')) break;
    rows.push(line.split('|').map((c) => c.trim()));
  }
  return rows;
}

/** Backticked tokens that are exactly one character — i.e. key names. */
function singleCharKeys(cell: string): string[] {
  return [...cell.matchAll(/`([^`]+)`/g)]
    .map((m) => m[1])
    .filter((t) => t.length === 1);
}

function formatDiff(missing: string[], extra: string[]): string {
  const parts: string[] = [];
  if (missing.length) parts.push(`missing from doc: ${missing.join(', ')}`);
  if (extra.length) parts.push(`documented but not in source: ${extra.join(', ')}`);
  return parts.join('; ');
}

const appSource = readRepo(APP_TS);
const viewModes = parseViewModes(appSource);
const bindings = parseViewKeyBindings(appSource);
const headers = parseViewHeaders(appSource);
const overlayModes = viewModes.filter((m) => m !== 'default');

describe('TUI view model documentation check', () => {
  it('source parses into a coherent view model (parser sanity)', () => {
    expect(viewModes.length).toBeGreaterThanOrEqual(2);
    expect(viewModes).toContain('default');
    expect(new Set(viewModes).size).toBe(viewModes.length);

    const boundModes = bindings.map((b) => b.mode);
    expect(new Set(boundModes).size, 'one toggle binding per view').toBe(boundModes.length);
    expect(
      [...boundModes].sort(),
      'every non-default viewMode has exactly one screen.key toggle binding — if the binding shape changed, update the parser in this test'
    ).toEqual([...overlayModes].sort());
    for (const b of bindings) {
      expect(b.keys.length, `view '${b.mode}' binds at least one key`).toBeGreaterThan(0);
      expect(headers.get(b.mode), `view '${b.mode}' sets an "FABRIC - ..." header`).toBeTruthy();
    }
  });

  it('FileHeatmap-Integration.md view table lists every view with the right entry keys', () => {
    const rows = parseTableRows(readRepo(HEATMAP_DOC), '| View mode |');
    // cells: ['', mode, overlay, enterWith, exit, '']
    const docModes = rows.map((r) => (r[1] ?? '').replace(/`/g, ''));
    const docKeys = new Map(rows.map((r) => [(r[1] ?? '').replace(/`/g, ''), singleCharKeys(r[3] ?? '')]));

    expect(docModes).toEqual(viewModes); // same list, same order

    for (const b of bindings) {
      expect(docKeys.get(b.mode)).toEqual(b.keys);
    }
  });

  it('FileHeatmap-Integration.md documents Escape and same-key toggle exits for every overlay', () => {
    const rows = parseTableRows(readRepo(HEATMAP_DOC), '| View mode |');
    for (const row of rows) {
      const mode = (row[1] ?? '').replace(/`/g, '');
      if (mode === 'default') continue;
      expect(row[4] ?? '', `exit column for '${mode}'`).toMatch(/`Escape`/);
      expect((row[4] ?? '').toLowerCase(), `exit column for '${mode}' mentions the toggle key`).toContain(
        'same key'
      );
    }
  });

  it('cli.md "Views — entry and exit" table covers every overlay and enter key', () => {
    const rows = parseTableRows(readRepo(CLI_DOC), '| View | Header | Enter with |');
    // cells: ['', viewName, headerTitle, enterWith, '']
    const byHeader = new Map(rows.map((r) => [(r[2] ?? '').replace(/`/g, ''), r]));
    const missing = overlayModes.filter((mode) => !byHeader.has(`FABRIC - ${headers.get(mode)}`));
    expect(missing, formatDiff(missing, [])).toEqual([]);

    for (const b of bindings) {
      const row = byHeader.get(`FABRIC - ${headers.get(b.mode)}`)!;
      const documented = singleCharKeys(row[3] ?? '');
      const notListed = b.keys.filter((k) => !documented.includes(k));
      expect(notListed, `enter keys for '${b.mode}' in cli.md`).toEqual([]);
    }
  });

  it('heatmap documents the H versus h pairing', () => {
    const heatmap = bindings.find((b) => b.mode === 'heatmap');
    expect(heatmap?.keys, 'heatmap binds both cases in app.ts').toEqual(['H', 'h']);

    const doc = readRepo(HEATMAP_DOC);
    const hSection = doc.match(/### H versus h[\s\S]*?(?=\n## |\n### )/);
    expect(hSection, 'an "### H versus h" section exists').toBeTruthy();
    expect(hSection![0]).toContain('`H`');
    expect(hSection![0]).toContain('`h`');
    // The lowercase key is shadowed inside worker analytics (comparison navigation).
    expect(hSection![0].toLowerCase()).toContain('analytics');
  });

  it('the in-app help overlay lists the heatmap view keys', () => {
    const helpBlock = appSource.match(/Heatmap View:\n[\s\S]*?(?=\n\n?\w)/);
    expect(helpBlock, 'Heatmap View help block exists in app.ts').toBeTruthy();
    const block = helpBlock![0];
    for (const key of ['s', 'c', 'a', 'Esc']) {
      expect(block, `help block mentions '${key}'`).toMatch(new RegExp(`^  ${key} +-`, 'm'));
    }
  });
});
