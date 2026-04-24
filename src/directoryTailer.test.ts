import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DirectoryTailer } from './directoryTailer.js';
import { EventDeduplicator } from './normalizer.js';

function makeEvent(worker: string, msg: string, sequence: number) {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    event_type: msg,
    worker_id: worker,
    session_id: 'test-session',
    sequence,
    data: {},
  });
}

describe('DirectoryTailer', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-dir-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('emits events from multiple pre-existing JSONL files', async () => {
    const fileA = path.join(tempDir, 'a.jsonl');
    const fileB = path.join(tempDir, 'b.jsonl');

    // Write initial content then close so size is known
    fs.writeFileSync(fileA, makeEvent('w-a', 'alpha', 1) + '\n');
    fs.writeFileSync(fileB, makeEvent('w-b', 'beta', 1) + '\n');

    const tailer = new DirectoryTailer({ directory: tempDir });

    const received: Array<{ msg: string; filePath: string }> = [];
    tailer.on('event', (event, filePath) => {
      received.push({ msg: event.msg, filePath });
    });

    tailer.start();

    // Wait for initial reads to propagate
    await new Promise((r) => setTimeout(r, 300));

    // Append a new line to each so the watcher fires
    fs.appendFileSync(fileA, makeEvent('w-a', 'alpha2', 2) + '\n');
    fs.appendFileSync(fileB, makeEvent('w-b', 'beta2', 2) + '\n');

    await new Promise((r) => setTimeout(r, 500));

    tailer.stop();

    expect(received.length).toBeGreaterThanOrEqual(2);
    const msgs = received.map((r) => r.msg);
    expect(msgs).toContain('alpha2');
    expect(msgs).toContain('beta2');
  });

  it('hot-adds a new JSONL file and emits its events', async () => {
    const tailer = new DirectoryTailer({ directory: tempDir });
    const received: string[] = [];

    tailer.on('event', (event) => {
      received.push(event.msg);
    });

    tailer.start();
    await new Promise((r) => setTimeout(r, 100));

    // Create a new file after the tailer is running
    const newFile = path.join(tempDir, 'new.jsonl');
    fs.writeFileSync(newFile, '');
    await new Promise((r) => setTimeout(r, 200));

    // Append an event
    fs.appendFileSync(newFile, makeEvent('w-new', 'hot-add-event', 1) + '\n');

    await new Promise((r) => setTimeout(r, 500));

    tailer.stop();

    expect(received).toContain('hot-add-event');
  });

  it('ignores non-*.jsonl files', async () => {
    const txtFile = path.join(tempDir, 'notes.txt');
    fs.writeFileSync(txtFile, makeEvent('w-txt', 'ignored', 1) + '\n');

    const tailer = new DirectoryTailer({ directory: tempDir });

    let eventCount = 0;
    tailer.on('event', () => {
      eventCount++;
    });

    tailer.start();
    await new Promise((r) => setTimeout(r, 300));

    // Append to the txt file — should be ignored
    fs.appendFileSync(txtFile, makeEvent('w-txt', 'still-ignored', 2) + '\n');
    await new Promise((r) => setTimeout(r, 300));

    tailer.stop();

    expect(eventCount).toBe(0);
  });

  it('stop() closes all child watchers', async () => {
    fs.writeFileSync(path.join(tempDir, 'a.jsonl'), '');
    fs.writeFileSync(path.join(tempDir, 'b.jsonl'), '');

    const tailer = new DirectoryTailer({ directory: tempDir });

    const endPromise = new Promise<void>((resolve) => {
      tailer.on('end', resolve);
    });

    tailer.start();
    await new Promise((r) => setTimeout(r, 200));

    expect(tailer.activeFiles.length).toBe(2);
    expect(tailer.isActive).toBe(true);

    tailer.stop();
    await endPromise;

    expect(tailer.isActive).toBe(false);
    expect(tailer.activeFiles.length).toBe(0);
  });

  it('deduplicates events across files', async () => {
    const dedup = new EventDeduplicator();

    const fileA = path.join(tempDir, 'a.jsonl');
    const fileB = path.join(tempDir, 'b.jsonl');

    // Same (worker_id, session_id, sequence) in both files
    const dupEvent = JSON.stringify({
      timestamp: new Date().toISOString(),
      event_type: 'bead.claimed',
      worker_id: 'w-dup',
      session_id: 's-dup',
      sequence: 42,
      data: {},
    });

    fs.writeFileSync(fileA, '');
    fs.writeFileSync(fileB, '');

    const tailer = new DirectoryTailer({ directory: tempDir, deduplicator: dedup });
    const received: string[] = [];

    tailer.on('event', (event) => {
      received.push(event.msg);
    });

    tailer.start();
    await new Promise((r) => setTimeout(r, 200));

    // Append the same event to both files
    fs.appendFileSync(fileA, dupEvent + '\n');
    fs.appendFileSync(fileB, dupEvent + '\n');

    await new Promise((r) => setTimeout(r, 500));

    tailer.stop();

    // Only one should have been emitted (dedup drops the second)
    const claimedCount = received.filter((m) => m === 'bead.claimed').length;
    expect(claimedCount).toBe(1);
  });

  it('emits error when directory does not exist', async () => {
    const tailer = new DirectoryTailer({ directory: '/nonexistent/dir' });

    const errorPromise = new Promise<Error>((resolve) => {
      tailer.on('error', resolve);
    });

    tailer.start();

    const err = await errorPromise;
    expect(err.message).toContain('Directory not found');
  });

  it('caps active-file count and inotify watches with many files', async () => {
    const COUNT = 10_000;
    const MAX_ACTIVE = 100;

    // Create COUNT empty *.jsonl files synchronously.
    for (let i = 0; i < COUNT; i++) {
      fs.writeFileSync(path.join(tempDir, `worker-${String(i).padStart(5, '0')}.jsonl`), '');
    }

    const tailer = new DirectoryTailer({
      directory: tempDir,
      maxActiveFiles: MAX_ACTIVE,
      recentMtimeMs: 86_400_000,
    });

    tailer.start();
    await new Promise((r) => setTimeout(r, 1500));

    // Active set must be bounded.
    expect(tailer.activeFiles.length).toBeLessThanOrEqual(MAX_ACTIVE);
    // All files must be tracked in fileInfo.
    expect(tailer.knownFileCount).toBe(COUNT);

    // On Linux, each fs.FSWatcher corresponds to one inotify watch.  Check the
    // open-fd count as a proxy (Node.js uses one inotify fd shared by all
    // watches, so the actual fd count stays very small regardless of watch count,
    // but inotify watches are bounded by maxActiveFiles + 1 for the dir watcher).
    if (fs.existsSync('/proc/self/fd')) {
      const fdCount = fs.readdirSync('/proc/self/fd').length;
      // Generous ceiling: baseline fds (~20) + MAX_ACTIVE + dir watcher + some slack.
      expect(fdCount).toBeLessThan(MAX_ACTIVE + 60);
    }

    tailer.stop();
  }, 60_000);

  it('evicts LRU and re-activates a file on mtime change', async () => {
    // maxActiveFiles=2 with 3 files forces an eviction.
    const fileA = path.join(tempDir, 'a.jsonl');
    const fileB = path.join(tempDir, 'b.jsonl');
    const fileC = path.join(tempDir, 'c.jsonl');

    fs.writeFileSync(fileA, '');
    fs.writeFileSync(fileB, '');
    fs.writeFileSync(fileC, '');

    const tailer = new DirectoryTailer({
      directory: tempDir,
      maxActiveFiles: 2,
      recentMtimeMs: 86_400_000,
      inactiveCheckIntervalMs: 200, // fast poll for test
    });

    const received: string[] = [];
    tailer.on('event', (event) => {
      received.push(event.msg);
    });

    tailer.start();
    await new Promise((r) => setTimeout(r, 300));

    // Only 2 of 3 files should be active.
    expect(tailer.activeFiles.length).toBe(2);

    // Find the evicted file and write content to it.
    const evicted = [fileA, fileB, fileC].find(
      (f) => !tailer.activeFiles.includes(f),
    )!;
    expect(evicted).toBeDefined();

    // Append an event to the evicted file — the poll should re-activate it.
    fs.appendFileSync(evicted, makeEvent('w-evicted', 'reactivated-event', 1) + '\n');

    // Wait for the poll interval to fire and re-activate.
    await new Promise((r) => setTimeout(r, 800));

    tailer.stop();

    expect(received).toContain('reactivated-event');
  });

  it('resumes from saved position when a file is re-activated after eviction', async () => {
    const fileA = path.join(tempDir, 'a.jsonl');
    const fileB = path.join(tempDir, 'b.jsonl');

    fs.writeFileSync(fileA, makeEvent('w-a', 'before-eviction', 1) + '\n');
    fs.writeFileSync(fileB, '');

    // maxActiveFiles=1 so opening fileB will evict fileA.
    const tailer = new DirectoryTailer({
      directory: tempDir,
      maxActiveFiles: 1,
      recentMtimeMs: 86_400_000,
      inactiveCheckIntervalMs: 200,
    });

    const received: string[] = [];
    tailer.on('event', (event) => received.push(event.msg));

    tailer.start();
    await new Promise((r) => setTimeout(r, 400));

    // Exactly one file is active; the other is inactive.
    expect(tailer.activeFiles.length).toBe(1);

    // Write to the inactive file to trigger re-activation.
    const inactive = tailer.activeFiles[0] === fileA ? fileB : fileA;
    fs.appendFileSync(inactive, makeEvent('w-inactive', 'after-reactivation', 2) + '\n');

    await new Promise((r) => setTimeout(r, 800));
    tailer.stop();

    // The event written after re-activation must have been received.
    expect(received).toContain('after-reactivation');
    // The event written before eviction (to fileA at start time) should NOT
    // have been re-emitted when fileA was re-activated (position is checkpointed).
    const beforeCount = received.filter((m) => m === 'before-eviction').length;
    expect(beforeCount).toBe(0);
  });
});
