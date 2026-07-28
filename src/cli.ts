#!/usr/bin/env node
/**
 * FABRIC CLI Entry Point
 *
 * Usage:
 *   fabric tui   - Launch terminal UI
 *   fabric web   - Launch web dashboard
 *   fabric tail  - Raw log tail
 *   fabric replay - Replay session history
 */

import { Command, Option } from 'commander';
import { VERSION } from './index.js';
import { LogTailer } from './tailer.js';
import { DirectoryTailer } from './directoryTailer.js';
import { formatEvent } from './parser.js';
import { getStore } from './store.js';
import { createWebServer } from './web/index.js';
import { EventDeduplicator } from './normalizer.js';
import { createConfigCommand } from './config.js';
import { applyAllWorkerLimits } from './workerMemoryLimiter.js';
import * as fs from 'fs';
import * as net from 'net';
import type { LogLevel, EventFilter, LogEvent } from './types.js';

type ResolvedSource = { kind: 'directory'; path: string } | { kind: 'file'; path: string };

const HOME = process.env.HOME || '';

/**
 * Resolve --source option value to a typed source with validation.
 *
 * This is called by resolveFromOptions() when the --source option is provided.
 * It performs actual filesystem validation to determine whether the path is a directory
 * or file, and exits with an error if the path doesn't exist.
 *
 * @param source - The --source option value (file or directory path). Can include ~ as
 *                 home directory shorthand.
 * @returns A ResolvedSource object with 'kind' set to 'directory' or 'file' based on
 *          fs.statSync(), and the expanded absolute path.
 *
 * Validation behavior:
 *   - Expands leading ~ to $HOME environment variable
 *   - Calls fs.statSync() to check path existence and type
 *   - Returns { kind: 'directory', path: expanded } for directories
 *   - Returns { kind: 'file', path: expanded } for files
 *   - Exits process(1) with error message if path doesn't exist
 *
 * Note: This is only called when --source is explicitly provided. The legacy -f/--file
 * option bypasses this validation (see resolveFromOptions()).
 */
function resolveSource(source: string): ResolvedSource {
  const expanded = source.startsWith('~') ? source.replace('~', HOME) : source;
  try {
    const stat = fs.statSync(expanded);
    return stat.isDirectory()
      ? { kind: 'directory', path: expanded }
      : { kind: 'file', path: expanded };
  } catch {
    console.error(`Error: Source path does not exist: ${expanded}`);
    process.exit(1);
  }
}

/**
 * Resolve CLI source options into a typed source.
 *
 * This function implements the backward-compatible source resolution logic for FABRIC commands.
 * It prioritizes --source over -f/--file, with a default to ~/.needle/logs if neither is provided.
 *
 * @param source - The --source option value (file or directory path). If provided, this takes
 *                 precedence over `file` and is validated via resolveSource().
 * @param file - The legacy -f/--file option value (file path only). Used for backward compatibility
 *               with older FABRIC invocations that predate --source.
 * @returns A ResolvedSource object indicating the kind ('directory' | 'file') and expanded path.
 *
 * Flow:
 *   1. If `source` is provided → call resolveSource(source), which:
 *      - Expands ~ to $HOME
 *      - Checks if path exists (fs.statSync)
 *      - Returns { kind: 'directory', path } or { kind: 'file', path }
 *      - Exits with error if path doesn't exist
 *   2. Else if `file` is provided → treat as file path:
 *      - Expands ~ to $HOME if present
 *      - Returns { kind: 'file', path } (no existence check)
 *   3. Else → default to ~/.needle/logs as directory
 *
 * Usage examples:
 *   - `fabric digest --source /path/to/logs` → resolves to directory or file based on fs.stat
 *   - `fabric digest -f /path/to/file.jsonl` → resolves as file (legacy)
 *   - `fabric digest` → resolves to ~/.needle/logs as directory
 *
 * See also: resolveSource() (handles the actual path validation), ResolvedSource type.
 */
function resolveFromOptions(source?: string, file?: string): ResolvedSource {
  if (source) return resolveSource(source);
  if (file) return { kind: 'file', path: file.startsWith('~') ? file.replace('~', HOME) : file };
  return { kind: 'directory', path: `${HOME}/.needle/logs` };
}

/** Simple glob → regex for NeedleEventType patterns like "bead.*", "worker.started". */
function globMatch(pattern: string, value: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${regexStr}$`).test(value);
}

/** Start a standalone OTLP/HTTP listener (used by tui and tail commands). */
async function startOtlpHttpListener(
  addr: string,
  onEvent: (event: import('./types.js').LogEvent) => void,
  deduplicator?: EventDeduplicator,
): Promise<import('http').Server> {
  const { default: express } = await import('express');
  const { createOtlpHttpRouter } = await import('./otlpHttpReceiver.js');
  const { createServer } = await import('http');

  const app = express();
  app.use(createOtlpHttpRouter({ onEvent, deduplicator }));

  const match = addr.match(/^(?:([\d.]+):)?(\d+)$/);
  const host = match?.[1] || '0.0.0.0';
  const port = match ? parseInt(match[2], 10) : 4318;

  const server = createServer(app);
  return new Promise((resolve, reject) => {
    server.listen(port, host, () => {
      console.error(`OTLP/HTTP receiver listening on ${host}:${port}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

const program = new Command();

program
  .name('fabric')
  .description('Flow Analysis & Bead Reporting Interface Console')
  .version(VERSION);

program
  .command('tui')
  .description('Launch terminal UI dashboard')
  .option('-f, --file <path>', 'Log file to tail (single-file mode)')
  .option('--source <path>', 'Log source (file or directory)', undefined)
  .option('-w, --worker <id>', 'Filter to specific worker ID')
  .option('-l, --level <level>', 'Filter by log level (debug, info, warn, error)')
  .option('--otlp-grpc <addr>', 'Enable OTLP/gRPC receiver (e.g. :4317 or 0.0.0.0:4317)')
  .option('--otlp-http <addr>', 'Enable OTLP/HTTP receiver (e.g. :4318 or 0.0.0.0:4318)')
  .action(async (options) => {
    const resolved = resolveFromOptions(options.source, options.file);

    // Validate level filter if provided
    const validLevels = ['debug', 'info', 'warn', 'error'];
    const levelFilter = options.level?.toLowerCase();
    if (levelFilter && !validLevels.includes(levelFilter)) {
      console.error(`Invalid level: ${options.level}. Must be one of: ${validLevels.join(', ')}`);
      process.exit(1);
    }

    // Build filter object
    const filter: EventFilter = {};
    if (options.worker) filter.worker = options.worker;
    if (levelFilter) filter.level = levelFilter as LogLevel;

    try {
      const { createTuiApp } = await import('./tui/index.js');
      const { OtlpGrpcReceiver } = await import('./otlpGrpcReceiver.js');
      const store = getStore();
      const app = createTuiApp(store, { logPath: resolved.path, filter });

      // Shared deduplicator for cross-source dedup when OTLP is active
      const needsDedup = !!(options.otlpGrpc || options.otlpHttp);
      const deduplicator = needsDedup ? new EventDeduplicator() : undefined;

      // Setup log tailing
      const tailer = resolved.kind === 'directory'
        ? new DirectoryTailer({ directory: resolved.path, deduplicator })
        : new LogTailer({
            path: resolved.path,
            parseJson: true,
            follow: true,
            lines: 50,
            deduplicator,
          });

      // Apply memory limits to all currently running needle workers at startup
      if (resolved.kind === 'directory') {
        const limitedCount = applyAllWorkerLimits();
        if (limitedCount > 0) {
          console.error(`Applied memory limits to ${limitedCount} needle worker(s)`);
        }
      }

      tailer.on('event', (event) => {
        // Apply filters before processing event
        if (filter.worker && event.worker !== filter.worker) return;
        if (filter.level && event.level !== filter.level) return;

        store.add(event);
        app.addEvent(event);
      });

      tailer.on('error', (err) => {
        console.error(`Tailer error: ${err.message}`);
      });

      // Setup workers.log tailer for hot reload (monitors the main aggregated log file)
      const workersLogPath = `${HOME}/.needle/logs/workers.log`;
      const workersLogDir = `${HOME}/.needle/logs`;
      let workersLogTailer: LogTailer | undefined;
      let workersLogDirWatcher: fs.FSWatcher | undefined;

      const startWorkersLogTailer = () => {
        if (workersLogTailer) return; // Already running

        workersLogTailer = new LogTailer({
          path: workersLogPath,
          parseJson: true,
          follow: true,
          lines: 0, // Start from end, only watch for new lines
          deduplicator,
        });

        workersLogTailer.on('event', (event) => {
          // Apply filters before processing event
          if (filter.worker && event.worker !== filter.worker) return;
          if (filter.level && event.level !== filter.level) return;

          store.add(event);
          app.addEvent(event);
        });

        workersLogTailer.on('error', (err) => {
          console.error(`workers.log tailer error: ${err.message}`);
        });

        workersLogTailer.start();
        console.error(`Watching workers.log for hot reload: ${workersLogPath}`);
      };

      // Start tailer immediately if file exists, otherwise watch for its creation
      if (fs.existsSync(workersLogPath)) {
        startWorkersLogTailer();
      } else {
        // Watch the directory for workers.log to be created
        if (fs.existsSync(workersLogDir)) {
          workersLogDirWatcher = fs.watch(workersLogDir, (eventType, filename) => {
            if (filename === 'workers.log' && !workersLogTailer) {
              startWorkersLogTailer();
              // Stop directory watcher once we've started the file tailer
              workersLogDirWatcher?.close();
              workersLogDirWatcher = undefined;
            }
          });
        }
      }

      // Start OTLP/gRPC receiver if requested
      let otlpReceiver: import('./otlpGrpcReceiver.js').OtlpGrpcReceiver | undefined;
      if (options.otlpGrpc) {
        otlpReceiver = new OtlpGrpcReceiver({ address: options.otlpGrpc, deduplicator });
        otlpReceiver.on('event', (event) => {
          // Apply filters before processing event
          if (filter.worker && event.worker !== filter.worker) return;
          if (filter.level && event.level !== filter.level) return;

          store.add(event);
          app.addEvent(event);
        });
        const boundAddr = await otlpReceiver.start();
        console.error(`OTLP/gRPC receiver listening on ${boundAddr}`);
      }

      // Start OTLP/HTTP receiver if requested
      let otlpHttpServer: import('http').Server | undefined;
      if (options.otlpHttp) {
        otlpHttpServer = await startOtlpHttpListener(options.otlpHttp, (event) => {
          // Apply filters before processing event
          if (filter.worker && event.worker !== filter.worker) return;
          if (filter.level && event.level !== filter.level) return;

          store.add(event);
          app.addEvent(event);
        }, deduplicator);
      }

      // Start tailing and TUI
      tailer.start();
      app.start();

      // Handle graceful shutdown
      process.on('SIGINT', () => {
        tailer.stop();
        workersLogTailer?.stop();
        workersLogDirWatcher?.close();
        otlpReceiver?.stop();
        otlpHttpServer?.close();
        app.stop();
        store.clear(); // persists session + metric summaries to SQLite
        process.exit(0);
      });
    } catch (err) {
      console.error(`Failed to start TUI: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('web')
  .description('Launch web dashboard')
  .option('-p, --port <number>', 'Port to listen on', '3000')
  .option('-f, --file <path>', 'Log file to tail (single-file mode)')
  .option('--source <path>', 'Log source (file or directory)', undefined)
  .option('-w, --worker <id>', 'Filter to specific worker ID')
  .option('-l, --level <level>', 'Filter by log level (debug, info, warn, error)')
  .option('-a, --auth-token <token>', 'Auth token for POST endpoints (or use FABRIC_AUTH_TOKEN env var)')
  .option('--otlp-grpc <addr>', 'Enable OTLP/gRPC receiver (e.g. :4317 or 0.0.0.0:4317)')
  .option('--otlp-http <addr>', 'Enable OTLP/HTTP receiver (e.g. :4318 or 0.0.0.0:4318)')
  .option('--max-events <number>', 'Max events in store before liveness guard exits (memory-bomb guard)')
  .option('--heap-snapshots', 'Enable automatic heap snapshot capture for leak detection (default: true in production)')
  .option('--snapshot-interval <minutes>', 'Interval between heap snapshots (default: 30)', '30')
  .action(async (options) => {
    const resolved = resolveFromOptions(options.source, options.file);
    const port = parseInt(options.port, 10) || 3000;
    const authToken = options.authToken || process.env.FABRIC_AUTH_TOKEN;
    const otlpHttpAddr: string | undefined = options.otlpHttp;
    const maxEventCount = options.maxEvents ? parseInt(options.maxEvents, 10) : undefined;

    // Validate level filter if provided
    const validLevels = ['debug', 'info', 'warn', 'error'];
    const levelFilter = options.level?.toLowerCase();
    if (levelFilter && !validLevels.includes(levelFilter)) {
      console.error(`Invalid level: ${options.level}. Must be one of: ${validLevels.join(', ')}`);
      process.exit(1);
    }

    // Build filter object
    const filter: EventFilter = {};
    if (options.worker) filter.worker = options.worker;
    if (levelFilter) filter.level = levelFilter as LogLevel;

    // Extract port number from --otlp-http (e.g. ":4318" or "0.0.0.0:4318" → 4318)
    let otlpHttpPort: number | undefined;
    if (otlpHttpAddr) {
      const match = otlpHttpAddr.match(/(\d+)$/);
      otlpHttpPort = match ? parseInt(match[1], 10) : undefined;
    }

    // Enable heap snapshots for leak detection in production (NODE_ENV=production)
    const enableHeapSnapshots = options.heapSnapshots ?? (process.env.NODE_ENV === 'production');
    const snapshotIntervalMinutes = parseInt(options.snapshotInterval, 10) || 30;

    // Initialize memory profiler for leak detection
    const { getMemoryProfiler } = await import('./memoryProfiler.js');
    const profiler = getMemoryProfiler();
    if (enableHeapSnapshots) {
      profiler.writeSnapshots = true;
      profiler.autoSnapshot = true;
      profiler.snapshotIntervalMs = snapshotIntervalMinutes * 60 * 1000;
      profiler.startPeriodicCapture();
      console.error(`Heap snapshots enabled: every ${snapshotIntervalMinutes} minutes → ~/.needle/snapshots/`);
    }

    // Shared deduplicator for cross-source dedup when OTLP is active.
    // Always created so dedup_dropped is reported accurately in /api/health.
    const deduplicator = new EventDeduplicator();

    try {
      const store = getStore();
      const server = createWebServer({
        port,
        logPath: resolved.path,
        store,
        authToken,
        otlpHttpPort,
        maxEventCount,
        deduplicator,
        cliFilter: Object.keys(filter).length > 0 ? filter : undefined,
      });

      // Setup log tailing
      const tailer = resolved.kind === 'directory'
        ? new DirectoryTailer({ directory: resolved.path, deduplicator })
        : new LogTailer({
            path: resolved.path,
            parseJson: true,
            follow: true,
            lines: 100,
            deduplicator,
          });

      // Apply memory limits to all currently running needle workers at startup
      if (resolved.kind === 'directory') {
        const limitedCount = applyAllWorkerLimits();
        if (limitedCount > 0) {
          console.error(`Applied memory limits to ${limitedCount} needle worker(s)`);
        }
      }

      tailer.on('event', (event) => {
        // Apply filters before processing event
        if (filter.worker && event.worker !== filter.worker) return;
        if (filter.level && event.level !== filter.level) return;

        store.add(event);
        server.recordEvent();
        server.broadcast(event);
        // Keep tailer_files_watched in sync for directory tailers
        if (tailer instanceof DirectoryTailer) {
          server.setTailerFilesWatched(tailer.activeFiles.length);
        }
      });

      tailer.on('error', (err) => {
        console.error(`Tailer error: ${err.message}`);
      });

      // Start OTLP/gRPC receiver if requested
      let otlpReceiver: import('./otlpGrpcReceiver.js').OtlpGrpcReceiver | undefined;
      if (options.otlpGrpc) {
        const { OtlpGrpcReceiver } = await import('./otlpGrpcReceiver.js');
        otlpReceiver = new OtlpGrpcReceiver({ address: options.otlpGrpc, deduplicator });
        otlpReceiver.on('event', (event) => {
          // Apply filters before processing event
          if (filter.worker && event.worker !== filter.worker) return;
          if (filter.level && event.level !== filter.level) return;

          store.add(event);
          server.recordEvent();
          server.broadcast(event);
        });
        const boundAddr = await otlpReceiver.start();
        console.error(`OTLP/gRPC receiver listening on ${boundAddr}`);
      }

      // Handle graceful shutdown
      process.on('SIGINT', () => {
        console.log('\nShutting down...');
        profiler.stopPeriodicCapture();
        tailer.stop();
        otlpReceiver?.stop();
        server.stop();
        store.clear(); // persists session + metric summaries to SQLite
        process.exit(0);
      });

      server.on('error', (err: Error) => {
        console.error(`Server error: ${err.message}`);
        process.exit(1);
      });

      // Start tailing and server
      tailer.start();
      // Set initial tailer file count (directory tailers know their count after start())
      server.setTailerFilesWatched(
        tailer instanceof DirectoryTailer ? tailer.activeFiles.length : 1
      );
      server.start();

      // systemd watchdog: periodically send WATCHDOG=1 to prevent restart
      const watchdogUsec = parseInt(process.env.WATCHDOG_USEC || '0', 10);
      if (watchdogUsec > 0) {
        const notifySocket = process.env.NOTIFY_SOCKET;
        const intervalMs = Math.floor(watchdogUsec / 1000 / 2); // notify at half the timeout
        const sdNotify = (msg: string) => {
          if (!notifySocket) return;
          try {
            const client = net.createConnection(notifySocket, () => {
              client.write(msg);
              client.end();
            });
            client.on('error', () => {});
          } catch { /* ignore if not running under systemd */ }
        };
        sdNotify('READY=1');
        setInterval(() => sdNotify('WATCHDOG=1'), intervalMs);
        console.log(`systemd watchdog enabled (interval: ${intervalMs}ms)`);
      }

    } catch (err) {
      console.error(`Failed to start web server: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('tail')
  .alias('logs')
  .description('Tail NEEDLE log file and display events')
  .option('-f, --file <path>', 'Log file to tail (single-file mode)')
  .option('--source <path>', 'Log source (file or directory)', undefined)
  .option('-w, --worker <id>', 'Filter by worker ID')
  .option('-t, --event-type <pattern>', 'Filter by event type (glob, e.g. "bead.*", "worker.started")')
  .addOption(new Option('-l, --level <level>', 'Filter by log level (deprecated: use --event-type)').hideHelp())
  .option('-n, --lines <number>', 'Number of existing lines to show', '0')
  .option('--no-follow', 'Exit after reading existing lines')
  .option('--json', 'Output raw JSON instead of formatted')
  .option('--otlp-grpc <addr>', 'Enable OTLP/gRPC receiver (e.g. :4317 or 0.0.0.0:4317)')
  .option('--otlp-http <addr>', 'Enable OTLP/HTTP receiver (e.g. :4318 or 0.0.0.0:4318)')
  .action(async (options) => {
    const resolved = resolveFromOptions(options.source, options.file);
    const lines = parseInt(options.lines, 10) || 0;
    const follow = options.follow !== false;
    const eventTypeFilter = options.eventType as string | undefined;

    console.log(`FABRIC Tail - Watching: ${resolved.path} (${resolved.kind})`);
    console.log(`Follow: ${follow}, Lines: ${lines}`);
    console.log('---');

    const validLevels = ['debug', 'info', 'warn', 'error'];
    const levelFilter = options.level?.toLowerCase();
    if (levelFilter && !validLevels.includes(levelFilter)) {
      console.error(`Invalid level: ${options.level}. Must be one of: ${validLevels.join(', ')}`);
      process.exit(1);
    }

    // Shared deduplicator for cross-source dedup when OTLP is active
    const needsDedup = !!(options.otlpGrpc || options.otlpHttp);
    const deduplicator = needsDedup ? new EventDeduplicator() : undefined;

    try {
      const tailer = resolved.kind === 'directory'
        ? new DirectoryTailer({ directory: resolved.path, deduplicator })
        : new LogTailer({
            path: resolved.path,
            parseJson: true,
            follow,
            lines,
            deduplicator,
          });

      const store = getStore();

      const handleEvent = (event: LogEvent) => {
        // Apply filters
        if (options.worker && event.worker !== options.worker) return;
        if (levelFilter && event.level !== levelFilter) return;
        if (eventTypeFilter && !globMatch(eventTypeFilter, event.msg)) return;

        // Store event
        store.add(event);

        // Output
        if (options.json) {
          console.log(JSON.stringify(event));
        } else {
          console.log(formatEvent(event, { colorize: true }));
        }
      };

      tailer.on('event', handleEvent);

      tailer.on('line', (line) => {
        if (!options.json) {
          // Only show raw lines in non-JSON mode for unparseable lines
        }
      });

      tailer.on('error', (err) => {
        console.error(`Error: ${err.message}`);
      });

      tailer.start();

      // Start OTLP/gRPC receiver if requested
      let otlpReceiver: import('./otlpGrpcReceiver.js').OtlpGrpcReceiver | undefined;
      if (options.otlpGrpc) {
        const { OtlpGrpcReceiver } = await import('./otlpGrpcReceiver.js');
        otlpReceiver = new OtlpGrpcReceiver({ address: options.otlpGrpc, deduplicator });
        otlpReceiver.on('event', handleEvent);
        const boundAddr = await otlpReceiver.start();
        console.error(`OTLP/gRPC receiver listening on ${boundAddr}`);
      }

      // Start OTLP/HTTP receiver if requested
      let otlpHttpServer: import('http').Server | undefined;
      if (options.otlpHttp) {
        otlpHttpServer = await startOtlpHttpListener(options.otlpHttp, handleEvent, deduplicator);
      }

      // Handle graceful shutdown
      process.on('SIGINT', () => {
        console.log('\n---');
        console.log(`Events processed: ${store.size}`);
        tailer.stop();
        otlpReceiver?.stop();
        otlpHttpServer?.close();
        process.exit(0);
      });

      // Keep process alive if following
      if (follow) {
        await new Promise(() => {}); // Never resolves
      } else {
        await new Promise<void>((resolve) => {
          setTimeout(() => {
            tailer.stop();
            resolve();
          }, 100); // Small delay to let initial reads complete
        });
      }
    } catch (err) {
      console.error(`Failed to tail: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('replay')
  .description('Replay worker session history chronologically')
  .option('-f, --file <path>', 'Log file to replay (single-file mode)')
  .option('--source <path>', 'Log source (file or directory)')
  .option('-w, --worker <id>', 'Filter by worker ID')
  .option('-t, --event-type <pattern>', 'Filter by event type (glob, e.g. "bead.*", "worker.started")')
  .addOption(new Option('-l, --level <level>', 'Filter by log level (deprecated: use --event-type)').hideHelp())
  .option('-s, --speed <speed>', 'Playback speed (0.5/1/2/5/10)', '1')
  .option('--auto', 'Start playback automatically')
  .action(async (options) => {
    const resolved = resolveFromOptions(options.source, options.file);
    const speed = parseFloat(options.speed) as 0.5 | 1 | 2 | 5 | 10;

    console.log(`FABRIC Session Replay - Loading: ${resolved.path} (${resolved.kind})`);

    const validLevels = ['debug', 'info', 'warn', 'error'];
    const levelFilter = options.level?.toLowerCase();
    if (levelFilter && !validLevels.includes(levelFilter)) {
      console.error(`Invalid level: ${options.level}. Must be one of: ${validLevels.join(', ')}`);
      process.exit(1);
    }

    const eventTypeFilter = options.eventType as string | undefined;

    try {
      const blessed = (await import('blessed')).default;
      const { SessionReplay } = await import('./tui/components/SessionReplay.js');

      // Create blessed screen
      const screen = blessed.screen({
        smartCSR: true,
        title: 'FABRIC Session Replay',
        fullUnicode: true,
      });

      // Create store for analytics pipeline integration
      const store = getStore();

      // Create session replay component
      const replay = new SessionReplay({
        parent: screen,
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        onEvent: (event, index, total) => {
          store.add(event);
        },
        onStateChange: (state) => {
          if (state === 'ended') {
            const summary = store.getAnalyticsSummary();
            console.error(`\nReplay complete. ${summary}`);
          }
        },
      });

      // Set initial speed
      if ([0.5, 1, 2, 5, 10].includes(speed)) {
        replay.setSpeed(speed);
      }

      // Bind global keys
      screen.key(['q', 'C-c'], () => {
        replay.destroy();
        screen.destroy();
        process.exit(0);
      });

      screen.key(['escape'], () => {
        replay.destroy();
        screen.destroy();
        process.exit(0);
      });

      // Build filter
      const filter: EventFilter = {};
      if (options.worker) filter.worker = options.worker;
      if (levelFilter) filter.level = levelFilter as LogLevel;
      if (eventTypeFilter) filter.eventType = eventTypeFilter;

      // Load from source (file or directory)
      await replay.loadSource(resolved, Object.keys(filter).length > 0 ? filter : undefined);

      // Focus and render
      replay.focus();
      screen.render();

      // Auto-start if requested
      if (options.auto) {
        setTimeout(() => replay.play(), 500);
      }

    } catch (err) {
      console.error(`Failed to start replay: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('prune')
  .description('Prune old NEEDLE log files (archive + delete)')
  .option('--source <path>', 'Log directory to prune (default: ~/.needle/logs)')
  .option('--archive-after <days>', 'Archive files older than N days', '3')
  .option('--archive-retain <days>', 'Delete archives older than N days', '30')
  .option('--max-age <days>', 'Delete files older than N days regardless', '7')
  .option('--dry-run', 'Report what would happen without making changes')
  .action(async (options) => {
    const { pruneLogs, formatPruneResult } = await import('./logPruner.js');
    const logDir = options.source
      ? (options.source.startsWith('~') ? options.source.replace('~', HOME) : options.source)
      : `${HOME}/.needle/logs`;

    const result = pruneLogs({
      logDir,
      archiveAfterDays: parseInt(options.archiveAfter, 10) || 3,
      archiveRetentionDays: parseInt(options.archiveRetain, 10) || 30,
      maxAgeDays: parseInt(options.maxAge, 10) || 7,
      dryRun: !!options.dryRun,
    });

    console.log(formatPruneResult(result, !!options.dryRun));
  });

program
  .command('digest')
  .description('Generate session digest from log source (directory or file)')
  .option('-f, --file <path>', 'Log file to analyze (single-file mode)')
  .option('--source <path>', 'Log source (file or directory)', undefined)
  .option('-o, --output <path>', 'Output file (default: stdout)')
  .option('-w, --worker <ids>', 'Filter by worker IDs (comma-separated)')
  .option('--since <timestamp>', 'Start time (Unix timestamp in ms)')
  .option('--until <timestamp>', 'End time (Unix timestamp in ms)')
  .option('--max-files <number>', 'Maximum files to list', '50')
  .option('--max-errors <number>', 'Maximum errors to list', '20')
  .option('--no-cost', 'Exclude cost information')
  .option('--no-errors', 'Exclude error information')
  .action(async (options) => {
    // Resolve source from CLI options
    // Flow: options.source → resolveFromOptions(options.source, options.file) → ResolvedSource
    //
    // The resolveFromOptions() function (line 95 in src/cli.ts) implements backward-compatible
    // source resolution with the following priority:
    //
    // 1. --source <path> (modern option, recommended):
    //    - Calls resolveSource() which validates path existence via fs.statSync()
    //    - Auto-detects if path is a directory or file
    //    - Exits with error if path doesn't exist
    //    - Supports ~ expansion for home directory
    //
    // 2. -f/--file <path> (legacy option, for backward compatibility):
    //    - Treats path as a file without existence checking
    //    - Supports ~ expansion for home directory
    //    - Used by older FABRIC invocations that predate --source
    //
    // 3. Default (neither option provided):
    //    - Resolves to ~/.needle/logs as a directory
    //
    // Returns: ResolvedSource = { kind: 'directory', path: string } | { kind: 'file', path: string }
    //
    // Examples:
    //   fabric digest --source /path/to/logs.jsonl      → file kind
    //   fabric digest --source ~/.needle/logs/          → directory kind
    //   fabric digest -f /path/to/file.jsonl            → file kind (legacy)
    //   fabric digest                                    → ~/.needle/logs directory
    const resolved = resolveFromOptions(options.source, options.file);

    console.error(`FABRIC Digest - Analyzing: ${resolved.path} (${resolved.kind})`);

    try {
      // Load events from source
      const store = getStore();
      const tailer = resolved.kind === 'directory'
        ? new DirectoryTailer({
            directory: resolved.path,
            recentMtimeMs: Infinity, // Read all files for digest, not just recent ones
            startupRereadMs: Infinity, // Read all files from beginning, regardless of age
          })
        : new LogTailer({
            path: resolved.path,
            parseJson: true,
            follow: false,
            lines: 0,
            startPosition: 0, // Read from beginning for digest (files may be old)
          });

      let eventCount = 0;
      tailer.on('event', (event) => {
        store.add(event);
        eventCount++;
      });

      tailer.on('error', (err) => {
        console.error(`Tailer error: ${err.message}`);
      });

      // Start tailing and wait for completion
      tailer.start();

      // Wait for source to be fully read, then stop
      await new Promise<void>((resolve) => {
        tailer.once('end', () => resolve());
        // Give directory tailers more time to process all files
        const delay = resolved.kind === 'directory' ? 2000 : 500;
        setTimeout(() => tailer.stop(), delay);
      });

      console.error(`Loaded ${eventCount} events`);

      // Generate digest
      const { SessionDigestGenerator, formatDigestAsMarkdown } = await import('./sessionDigest.js');
      const { getCostTracker } = await import('./tui/utils/costTracking.js');
      const costTracker = getCostTracker();
      const generator = new SessionDigestGenerator(store, costTracker);

      const digestOptions: any = {
        includeCost: options.cost !== false,
        includeErrors: options.errors !== false,
        maxFiles: parseInt(options.maxFiles, 10) || 50,
        maxErrors: parseInt(options.maxErrors, 10) || 20,
      };

      if (options.worker) {
        digestOptions.workers = options.worker.split(',').map((w: string) => w.trim());
      }

      if (options.since) {
        digestOptions.startTime = parseInt(options.since, 10);
      }

      if (options.until) {
        digestOptions.endTime = parseInt(options.until, 10);
      }

      const digest = generator.generateDigest(digestOptions);
      const markdown = formatDigestAsMarkdown(digest);

      // Output
      if (options.output) {
        const outputPath = options.output.replace('~', process.env.HOME || '');
        fs.writeFileSync(outputPath, markdown, 'utf8');
        console.error(`Digest written to: ${outputPath}`);
      } else {
        console.log(markdown);
      }

    } catch (err) {
      console.error(`Failed to generate digest: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// Add config command
program.addCommand(createConfigCommand());

program.parse();
