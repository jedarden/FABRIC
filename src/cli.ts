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

const program = new Command();

program
  .name('fabric')
  .description('Flow Analysis & Bead Reporting Interface Console')
  .version(VERSION);

program
  .command('tui')
  .description('Launch terminal UI dashboard')
  .option('-f, --file <path>', 'Log file to tail', '~/.needle/logs/workers.log')
  .action((options) => {
    console.log('FABRIC TUI - Terminal Dashboard');
    console.log(`Watching: ${options.file}`);
    console.log('\n(TUI implementation coming in Phase 2)');
  });

program
  .command('web')
  .description('Launch web dashboard')
  .option('-p, --port <number>', 'Port to listen on', '3000')
  .option('-f, --file <path>', 'Log file to tail', '~/.needle/logs/workers.log')
  .action((options) => {
    console.log('FABRIC Web Dashboard');
    console.log(`Starting server on port ${options.port}`);
    console.log(`Watching: ${options.file}`);
    console.log('\n(Web implementation coming in Phase 3)');
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
