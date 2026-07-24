/**
 * FABRIC Heap Diff Analysis Utilities
 *
 * Utilities for analyzing heap snapshots to identify memory leaks.
 * Provides comparison between snapshots and identifies growing retainers.
 */

import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/** Snapshot directory */
const SNAPSHOT_DIR = join(homedir(), '.needle', 'snapshots');

/** Maximum number of snapshots to consider for diff analysis */
const MAX_SNAPSHOTS_FOR_DIFF = 10;

export interface HeapSnapshotSummary {
  filename: string;
  filepath: string;
  timestamp: number;
  sizeBytes: number;
  sizeMb: number;
}

export interface HeapDiffResult {
  baseline: HeapSnapshotSummary;
  current: HeapSnapshotSummary;
  durationMs: number;
  durationMinutes: number;
  sizeGrowthBytes: number;
  sizeGrowthMb: number;
  growthRateMbPerHour: number;
  percentChange: number;
  /** Objects that grew significantly (if detailed analysis available) */
  growingObjects?: Array<{
    name: string;
    countDelta: number;
    sizeDeltaBytes: number;
    percentChange: number;
  }>;
  /** Assessment of whether this looks like a leak */
  assessment: 'stable' | 'growing' | 'leaking' | 'unknown';
  recommendations: string[];
}

/**
 * Get all heap snapshots sorted by timestamp (oldest first)
 */
export function getHeapSnapshots(): HeapSnapshotSummary[] {
  if (!existsSync(SNAPSHOT_DIR)) return [];

  const files = readdirSync(SNAPSHOT_DIR)
    .filter(f => f.endsWith('.heapsnapshot'))
    .map(f => {
      const filepath = join(SNAPSHOT_DIR, f);
      const stat = statSync(filepath);
      return {
        filename: f,
        filepath,
        timestamp: stat.mtime.getTime(),
        sizeBytes: stat.size,
        sizeMb: stat.size / (1024 * 1024),
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp);

  return files;
}

/**
 * Compare two heap snapshots and return diff analysis
 */
export function compareSnapshots(
  baseline: HeapSnapshotSummary,
  current: HeapSnapshotSummary
): HeapDiffResult {
  const durationMs = current.timestamp - baseline.timestamp;
  const durationMinutes = durationMs / (1000 * 60);
  const sizeGrowthBytes = current.sizeBytes - baseline.sizeBytes;
  const sizeGrowthMb = sizeGrowthBytes / (1024 * 1024);
  const percentChange = baseline.sizeBytes > 0
    ? (sizeGrowthBytes / baseline.sizeBytes) * 100
    : 0;
  const growthRateMbPerHour = durationMinutes > 0
    ? (sizeGrowthMb / durationMinutes) * 60
    : 0;

  // Determine assessment
  let assessment: 'stable' | 'growing' | 'leaking' | 'unknown' = 'unknown';
  const recommendations: string[] = [];

  if (durationMinutes < 10) {
    assessment = 'unknown';
    recommendations.push('Insufficient time between snapshots for reliable assessment');
  } else if (Math.abs(percentChange) < 5) {
    assessment = 'stable';
    recommendations.push('Memory usage appears stable');
  } else if (percentChange > 0 && growthRateMbPerHour > 10) {
    assessment = 'leaking';
    recommendations.push(`Potential leak: growing at ${growthRateMbPerHour.toFixed(1)} MB/hour`);
    recommendations.push('Review heap snapshot in Chrome DevTools for growing retainers');
    recommendations.push('Check for unbounded collections in EventStore');
    recommendations.push('Verify WebSocket client cleanup');
  } else if (percentChange > 20) {
    assessment = 'growing';
    recommendations.push(`Memory growing: ${percentChange.toFixed(1)}% increase`);
    recommendations.push('Monitor for continued growth');
  } else {
    assessment = 'stable';
    recommendations.push('Memory growth within acceptable bounds');
  }

  return {
    baseline,
    current,
    durationMs,
    durationMinutes,
    sizeGrowthBytes,
    sizeGrowthMb,
    growthRateMbPerHour,
    percentChange,
    assessment,
    recommendations,
  };
}

/**
 * Get the most recent heap diff (comparing oldest recent vs newest)
 */
export function getRecentHeapDiff(): HeapDiffResult | null {
  const snapshots = getHeapSnapshots();
  if (snapshots.length < 2) return null;

  // Use oldest of recent snapshots as baseline for comparison
  const recent = snapshots.slice(-MAX_SNAPSHOTS_FOR_DIFF);
  return compareSnapshots(recent[0], recent[recent.length - 1]);
}

/**
 * Analyze trends across multiple snapshots
 */
export function analyzeTrend(): {
  snapshots: HeapSnapshotSummary[];
  diffs: HeapDiffResult[];
  overallAssessment: 'stable' | 'growing' | 'leaking' | 'insufficient-data';
  avgGrowthRateMbPerHour: number;
  projectedGrowth24hMb: number;
} {
  const snapshots = getHeapSnapshots();
  const diffs: HeapDiffResult[] = [];
  let totalGrowthRate = 0;
  let growingCount = 0;
  let leakingCount = 0;

  if (snapshots.length < 2) {
    return {
      snapshots,
      diffs,
      overallAssessment: 'insufficient-data',
      avgGrowthRateMbPerHour: 0,
      projectedGrowth24hMb: 0,
    };
  }

  // Compare consecutive snapshots
  for (let i = 1; i < snapshots.length; i++) {
    const diff = compareSnapshots(snapshots[i - 1], snapshots[i]);
    diffs.push(diff);
    totalGrowthRate += diff.growthRateMbPerHour;
    if (diff.assessment === 'growing') growingCount++;
    if (diff.assessment === 'leaking') leakingCount++;
  }

  const avgGrowthRateMbPerHour = totalGrowthRate / diffs.length;
  const projectedGrowth24hMb = avgGrowthRateMbPerHour * 24;

  let overallAssessment: 'stable' | 'growing' | 'leaking' | 'insufficient-data';
  if (leakingCount >= diffs.length / 2) {
    overallAssessment = 'leaking';
  } else if (growingCount + leakingCount >= diffs.length * 0.7) {
    overallAssessment = 'growing';
  } else {
    overallAssessment = 'stable';
  }

  return {
    snapshots,
    diffs,
    overallAssessment,
    avgGrowthRateMbPerHour,
    projectedGrowth24hMb,
  };
}

/**
 * Format a heap diff result as markdown
 */
export function formatHeapDiffAsMarkdown(diff: HeapDiffResult): string {
  const lines: string[] = [];

  lines.push('# Heap Diff Analysis');
  lines.push('');
  lines.push(`**Baseline:** ${diff.baseline.filename}`);
  lines.push(`**Current:** ${diff.current.filename}`);
  lines.push(`**Duration:** ${diff.durationMinutes.toFixed(1)} minutes`);
  lines.push('');
  lines.push('## Memory Growth');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Size Growth | ${diff.sizeGrowthMb.toFixed(2)} MB (${diff.percentChange > 0 ? '+' : ''}${diff.percentChange.toFixed(1)}%) |`);
  lines.push(`| Growth Rate | ${diff.growthRateMbPerHour.toFixed(2)} MB/hour |`);
  lines.push(`| Assessment | **${diff.assessment.toUpperCase()}** |`);
  lines.push('');

  if (diff.recommendations.length > 0) {
    lines.push('## Recommendations');
    lines.push('');
    for (const rec of diff.recommendations) {
      lines.push(`- ${rec}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format trend analysis as markdown
 */
export function formatTrendAsMarkdown(trend: ReturnType<typeof analyzeTrend>): string {
  const lines: string[] = [];

  lines.push('# Heap Trend Analysis');
  lines.push('');
  lines.push(`**Snapshots Analyzed:** ${trend.snapshots.length}`);
  lines.push(`**Overall Assessment:** **${trend.overallAssessment.toUpperCase()}**`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Average Growth Rate | ${trend.avgGrowthRateMbPerHour.toFixed(2)} MB/hour |`);
  lines.push(`| Projected 24h Growth | ${trend.projectedGrowth24hMb.toFixed(1)} MB |`);
  lines.push('');

  if (trend.diffs.length > 0) {
    lines.push('## Individual Snapshot Comparisons');
    lines.push('');
    for (const diff of trend.diffs) {
      lines.push(`### ${diff.baseline.filename} → ${diff.current.filename}`);
      lines.push(`- Duration: ${diff.durationMinutes.toFixed(1)} min`);
      lines.push(`- Growth: ${diff.sizeGrowthMb.toFixed(2)} MB (${diff.percentChange.toFixed(1)}%)`);
      lines.push(`- Rate: ${diff.growthRateMbPerHour.toFixed(2)} MB/hour`);
      lines.push(`- Assessment: **${diff.assessment}**`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Save trend analysis to disk
 */
export function saveTrendReport(): string | null {
  const trend = analyzeTrend();
  if (trend.overallAssessment === 'insufficient-data') return null;

  const reportsDir = join(SNAPSHOT_DIR, 'reports');
  if (!existsSync(reportsDir)) {
    mkdirSync(reportsDir, { recursive: true });
  }

  const filename = `trend-report-${Date.now()}.md`;
  const filepath = join(reportsDir, filename);
  writeFileSync(filepath, formatTrendAsMarkdown(trend), 'utf-8');

  return filepath;
}
