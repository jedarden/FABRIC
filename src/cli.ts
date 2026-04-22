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
import * as fs from 'fs';
import type { LogLevel, EventFilter, LogEvent } from './types.js';

type ResolvedSource = { kind: 'directory'; path: string } | { kind: 'file'; path: string };

const HOME = process.env.HOME || '';

/** Resolve --source to a typed source. Errors if path doesn't exist. */
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

/** Resolve CLI source options into a typed source. */
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
  .option('--otlp-grpc <addr>', 'Enable OTLP/gRPC receiver (e.g. :4317 or 0.0.0.0:4317)')
  .option('--otlp-http <addr>', 'Enable OTLP/HTTP receiver (e.g. :4318 or 0.0.0.0:4318)')
  .action(async (options) => {
    const resolved = resolveFromOptions(options.source, options.file);

    try {
      const { createTuiApp } = await import('./tui/index.js');
      const { OtlpGrpcReceiver } = await import('./otlpGrpcReceiver.js');
      const store = getStore();
      const app = createTuiApp(store, { logPath: resolved.path });

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

      tailer.on('event', (event) => {
        store.add(event);
        app.addEvent(event);
      });

      tailer.on('error', (err) => {
        console.error(`Tailer error: ${err.message}`);
      });

      // Start OTLP/gRPC receiver if requested
      let otlpReceiver: import('./otlpGrpcReceiver.js').OtlpGrpcReceiver | undefined;
      if (options.otlpGrpc) {
        otlpReceiver = new OtlpGrpcReceiver({ address: options.otlpGrpc, deduplicator });
        otlpReceiver.on('event', (event) => {
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
  .option('-a, --auth-token <token>', 'Auth token for POST endpoints (or use FABRIC_AUTH_TOKEN env var)')
  .option('--otlp-grpc <addr>', 'Enable OTLP/gRPC receiver (e.g. :4317 or 0.0.0.0:4317)')
  .option('--otlp-http <addr>', 'Enable OTLP/HTTP receiver (e.g. :4318 or 0.0.0.0:4318)')
  .action(async (options) => {
    const resolved = resolveFromOptions(options.source, options.file);
    const port = parseInt(options.port, 10) || 3000;
    const authToken = options.authToken || process.env.FABRIC_AUTH_TOKEN;
    const otlpHttpAddr: string | undefined = options.otlpHttp;

    // Extract port number from --otlp-http (e.g. ":4318" or "0.0.0.0:4318" → 4318)
    let otlpHttpPort: number | undefined;
    if (otlpHttpAddr) {
      const match = otlpHttpAddr.match(/(\d+)$/);
      otlpHttpPort = match ? parseInt(match[1], 10) : undefined;
    }

    // Shared deduplicator for cross-source dedup when OTLP is active
    const needsDedup = !!(options.otlpGrpc || options.otlpHttp);
    const deduplicator = needsDedup ? new EventDeduplicator() : undefined;

    try {
      const store = getStore();
      const server = createWebServer({
        port,
        logPath: resolved.path,
        store,
        authToken,
        otlpHttpPort,
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

      tailer.on('event', (event) => {
        store.add(event);
        server.broadcast(event);
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
          store.add(event);
          server.broadcast(event);
        });
        const boundAddr = await otlpReceiver.start();
        console.error(`OTLP/gRPC receiver listening on ${boundAddr}`);
      }

      // Handle graceful shutdown
      process.on('SIGINT', () => {
        console.log('\nShutting down...');
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
      server.start();

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
  .option('-f, --file <path>', 'Log file to replay', '~/.needle/logs/workers.log')
  .option('-w, --worker <id>', 'Filter by worker ID')
  .option('-t, --event-type <pattern>', 'Filter by event type (glob, e.g. "bead.*", "worker.started")')
  .addOption(new Option('-l, --level <level>', 'Filter by log level (deprecated: use --event-type)').hideHelp())
  .option('-s, --speed <speed>', 'Playback speed (0.5/1/2/5/10)', '1')
  .option('--auto', 'Start playback automatically')
  .action(async (options) => {
    const filePath = options.file.replace('~', process.env.HOME || '');
    const speed = parseFloat(options.speed) as 0.5 | 1 | 2 | 5 | 10;

    console.log(`FABRIC Session Replay - Loading: ${filePath}`);

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

      // Load the log file
      await replay.loadFile(filePath, Object.keys(filter).length > 0 ? filter : undefined);

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
  .command('digest')
  .description('Generate session digest from log file')
  .option('-f, --file <path>', 'Log file to analyze', '~/.needle/logs/workers.log')
  .option('-o, --output <path>', 'Output file (default: stdout)')
  .option('-w, --worker <ids>', 'Filter by worker IDs (comma-separated)')
  .option('--since <timestamp>', 'Start time (Unix timestamp in ms)')
  .option('--until <timestamp>', 'End time (Unix timestamp in ms)')
  .option('--max-files <number>', 'Maximum files to list', '50')
  .option('--max-errors <number>', 'Maximum errors to list', '20')
  .option('--no-cost', 'Exclude cost information')
  .option('--no-errors', 'Exclude error information')
  .action(async (options) => {
    const filePath = options.file.replace('~', process.env.HOME || '');

    console.error(`FABRIC Digest - Analyzing: ${filePath}`);

    try {
      // Load events from file
      const store = getStore();
      const tailer = new LogTailer({
        path: filePath,
        parseJson: true,
        follow: false,
        lines: 0, // Load all lines
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

      // Wait for file to be fully read
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          tailer.stop();
          resolve();
        }, 500);
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

program.parse();
