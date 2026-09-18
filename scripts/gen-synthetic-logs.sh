#!/usr/bin/env bash
# Generate a synthetic NEEDLE-style JSONL log directory for reproducing the
# `fabric tui --source <dir>` directory-source busy-loop.
#
# See docs/notes/tui-directory-source-busy-loop.md for the diagnosis this
# script was written to reproduce (bead fabric-0386d35e).
#
# Usage:
#   scripts/gen-synthetic-logs.sh [--count N] [--events-per-file N] [--dir PATH]
#
#   --count N            Number of *.jsonl files to create   (default: 120)
#   --events-per-file N  Events per file                    (default: 400)
#   --dir PATH           Target directory (created if missing).
#                        Default: a fresh mktemp -d under ${TMPDIR:-/tmp}
#
# The generated directory path is printed on the LAST line of stdout, so:
#   REPRO_DIR=$(scripts/gen-synthetic-logs.sh --count 120 | tail -1)
#   node dist/cli.js tui --source "$REPRO_DIR"
#
# The directory is NEVER placed under ~/.needle/logs. Remove it with
# `rm -rf` once you are done (the script prints the reminder).
#
# Line shape mirrors docs/plan.md's NEEDLE JSONL contract:
#   {"ts":<ms>,"worker":"<agent>-<hex>","level":"info","msg":"...","tool":"...","bead":"<id>"}
set -euo pipefail

COUNT=120
EVENTS_PER_FILE=400
TARGET_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --count) COUNT="$2"; shift 2 ;;
    --events-per-file) EVENTS_PER_FILE="$2"; shift 2 ;;
    --dir) TARGET_DIR="$2"; shift 2 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | tail -n +2
      exit 0
      ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 1 ;;
  esac
done

if [[ -z "$TARGET_DIR" ]]; then
  TARGET_DIR="$(mktemp -d "${TMPDIR:-/tmp}/fabric-repro-logs.XXXXXX")"
fi

mkdir -p "$TARGET_DIR"

# Generation runs in node: 48k JSON lines via bash string ops would take
# seconds and offer no benefit; node does it in well under a second.
COUNT="$COUNT" EVENTS_PER_FILE="$EVENTS_PER_FILE" TARGET_DIR="$TARGET_DIR" node - <<'EOF'
const fs = require('fs');
const path = require('path');

const count = parseInt(process.env.COUNT, 10);
const eventsPerFile = parseInt(process.env.EVENTS_PER_FILE, 10);
const dir = process.env.TARGET_DIR;

const names = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel',
  'india', 'juliet', 'kilo', 'lima', 'mike', 'november', 'oscar', 'papa'];
const levels = ['debug', 'info', 'info', 'info', 'warn', 'error'];
const tools = ['Read', 'Edit', 'Bash', 'Grep', 'Glob', 'Write'];
const msgs = [
  'Tool call', 'Reading file', 'Starting task', 'Task complete', 'Analyzing dependencies',
  'Committing changes', 'Running tests', 'Retry attempt', 'Claim succeeded', 'Heartbeat',
];
const now = Date.now();

for (let f = 0; f < count; f++) {
  const name = names[f % names.length];
  const hex = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  const worker = `claude-code-glm-5.3-${name}-${hex}`;
  const file = path.join(dir, `${name}-${hex}.jsonl`);
  // Newest file gets the newest events; spread each file's events over ~1 h.
  const base = now - f * 30_000 - eventsPerFile * 900;

  const chunks = [];
  for (let i = 0; i < eventsPerFile; i++) {
    const ev = {
      ts: Math.floor(base + i * 900),
      worker,
      level: levels[Math.floor(Math.random() * levels.length)],
      msg: msgs[Math.floor(Math.random() * msgs.length)],
      tool: tools[Math.floor(Math.random() * tools.length)],
      path: `/home/coding/project/src/module${f % 20}/file${i % 7}.ts`,
      bead: `fabric-${Math.floor(Math.random() * 0xffffff).toString(16).padStart(8, '0')}`,
    };
    chunks.push(JSON.stringify(ev));
  }
  fs.writeFileSync(file, chunks.join('\n') + '\n');
}
console.error(`generated ${count} files x ${eventsPerFile} events in ${dir}`);
EOF

echo "$TARGET_DIR"
echo "Repro (leave running ~30s, watch CPU in another terminal):" >&2
echo "  node dist/cli.js tui --source $TARGET_DIR" >&2
echo "Clean up when done: rm -rf $TARGET_DIR" >&2
