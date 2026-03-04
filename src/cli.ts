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

import { Command } from 'commander';
import * as blessed from 'blessed';
import { VERSION } from './index.js';
import { LogTailer, tailLogFile } from './tailer.js';
import { formatEvent } from './parser.js';
import { getStore } from './store.js';
import { createTuiApp } from './tui/index.js';
import { createWebServer } from './web/index.js';
import { SessionReplay } from './tui/components/SessionReplay.js';
import { SessionDigestGenerator, formatDigestAsMarkdown } from './sessionDigest.js';
import { getCostTracker } from './tui/utils/costTracking.js';
import * as fs from 'fs';
import type { LogLevel, EventFilter } from './types.js';

const program = new Command();

program
  .name('fabric')
  .description('Flow Analysis & Bead Reporting Interface Console')
  .version(VERSION);

program
  .command('tui')
  .description('Launch terminal UI dashboard')
  .option('-f, --file <path>', 'Log file to tail', '~/.needle/logs/workers.log')
  .action(async (options) => {
    const filePath = options.file.replace('~', process.env.HOME || '');

    try {
      const store = getStore();
      const app = createTuiApp(store, { logPath: filePath });

      // Setup log tailing
      const tailer = new LogTailer({
        path: filePath,
        parseJson: true,
        follow: true,
        lines: 50, // Load last 50 lines on start
      });

      tailer.on('event', (event) => {
        store.add(event);
        app.addEvent(event);
      });

      tailer.on('error', (err) => {
        console.error(`Tailer error: ${err.message}`);
      });

      // Start tailing and TUI
      tailer.start();
      app.start();

      // Handle graceful shutdown
      process.on('SIGINT', () => {
        tailer.stop();
        app.stop();
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
  .option('-f, --file <path>', 'Log file to tail', '~/.needle/logs/workers.log')
  .action(async (options) => {
    const filePath = options.file.replace('~', process.env.HOME || '');
    const port = parseInt(options.port, 10) || 3000;

    try {
      const store = getStore();
      const server = createWebServer({
        port,
        logPath: filePath,
        store,
      });

      // Setup log tailing
      const tailer = new LogTailer({
        path: filePath,
        parseJson: true,
        follow: true,
        lines: 100, // Load last 100 lines on start
      });

      tailer.on('event', (event) => {
        store.add(event);
        server.broadcast(event);
      });

      tailer.on('error', (err) => {
        console.error(`Tailer error: ${err.message}`);
      });

      // Handle graceful shutdown
      process.on('SIGINT', () => {
        console.log('\nShutting down...');
        tailer.stop();
        server.stop();
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
  .description('Tail NEEDLE log file and display events')
  .option('-f, --file <path>', 'Log file to tail', '~/.needle/logs/workers.log')
  .option('-w, --worker <id>', 'Filter by worker ID')
  .option('-l, --level <level>', 'Filter by log level (debug/info/warn/error)')
  .option('-n, --lines <number>', 'Number of existing lines to show', '0')
  .option('--no-follow', 'Exit after reading existing lines')
  .option('--json', 'Output raw JSON instead of formatted')
  .action(async (options) => {
    const filePath = options.file.replace('~', process.env.HOME || '');
    const lines = parseInt(options.lines, 10) || 0;
    const follow = options.follow !== false;

    console.log(`FABRIC Tail - Watching: ${filePath}`);
    console.log(`Follow: ${follow}, Lines: ${lines}`);
    console.log('---');

    const validLevels = ['debug', 'info', 'warn', 'error'];
    const levelFilter = options.level?.toLowerCase();
    if (levelFilter && !validLevels.includes(levelFilter)) {
      console.error(`Invalid level: ${options.level}. Must be one of: ${validLevels.join(', ')}`);
      process.exit(1);
    }

    try {
      const tailer = new LogTailer({
        path: filePath,
        parseJson: true,
        follow,
        lines,
      });

      const store = getStore();

      tailer.on('event', (event) => {
        // Apply filters
        if (options.worker && event.worker !== options.worker) return;
        if (levelFilter && event.level !== levelFilter) return;

        // Store event
        store.add(event);

        // Output
        if (options.json) {
          console.log(JSON.stringify(event));
        } else {
          console.log(formatEvent(event, { colorize: true }));
        }
      });

      tailer.on('line', (line) => {
        if (!options.json) {
          // Only show raw lines in non-JSON mode for unparseable lines
        }
      });

      tailer.on('error', (err) => {
        console.error(`Error: ${err.message}`);
      });

      tailer.start();

      // Handle graceful shutdown
      process.on('SIGINT', () => {
        console.log('\n---');
        console.log(`Events processed: ${store.size}`);
        tailer.stop();
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
  .option('-l, --level <level>', 'Filter by log level (debug/info/warn/error)')
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

    try {
      // Create blessed screen
      const screen = blessed.screen({
        smartCSR: true,
        title: 'FABRIC Session Replay',
        fullUnicode: true,
      });

      // Create session replay component
      const replay = new SessionReplay({
        parent: screen,
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        onEvent: (event, index, total) => {
          // Could emit to store if needed
        },
        onStateChange: (state) => {
          if (state === 'ended') {
            // Show ended message
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
