#!/usr/bin/env node
/**
 * FABRIC CLI Entry Point
 *
 * Usage:
 *   fabric tui   - Launch terminal UI
 *   fabric web   - Launch web dashboard
 *   fabric tail  - Raw log tail
 */

import { Command } from 'commander';
import { VERSION } from './index.js';
import { LogTailer, tailLogFile } from './tailer.js';
import { formatEvent } from './parser.js';
import { getStore } from './store.js';
import { createTuiApp } from './tui/index.js';
import { createWebServer } from './web/index.js';

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

program.parse();
