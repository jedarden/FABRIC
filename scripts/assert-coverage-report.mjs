#!/usr/bin/env node

/**
 * Fail the coverage gate when Vitest produces an empty report.
 *
 * A coverage threshold can pass with zero instrumented files, so checking the
 * report shape is part of the gate rather than relying on the threshold alone.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const summaryPath = join(repositoryRoot, 'artifacts', 'coverage', 'coverage-summary.json');

const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
const total = summary.total;
const fileCount =
  typeof total?.files === 'number'
    ? total.files
    : Object.keys(summary).filter((key) => key !== 'total').length;
const hasMeasuredCode = ['lines', 'statements', 'functions', 'branches'].some(
  (metric) => Number(total?.[metric]?.total) > 0,
);

if (fileCount <= 0 || !hasMeasuredCode) {
  throw new Error(
    `coverage report is empty: files=${fileCount}, measured code=${hasMeasuredCode ? 'yes' : 'no'}`,
  );
}

process.stdout.write(`coverage report contains ${fileCount} file(s) with measured code\n`);
