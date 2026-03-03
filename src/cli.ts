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
  .description('Raw log tail (for debugging)')
  .option('-f, --file <path>', 'Log file to tail', '~/.needle/logs/workers.log')
  .option('-w, --worker <id>', 'Filter by worker ID')
  .option('-l, --level <level>', 'Filter by log level')
  .action((options) => {
    console.log('FABRIC Raw Tail');
    console.log(`File: ${options.file}`);
    if (options.worker) console.log(`Worker filter: ${options.worker}`);
    if (options.level) console.log(`Level filter: ${options.level}`);
    console.log('\n(Tail implementation coming in Phase 1)');
  });

program.parse();
