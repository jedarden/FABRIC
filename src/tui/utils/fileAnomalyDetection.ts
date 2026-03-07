/**
 * File Anomaly Detection Utility
 *
 * Detects unusual file activity patterns that may indicate:
 * - Configuration files modified outside expected context
 * - High-frequency modifications (possible thrashing)
 * - Burst activity (sudden spike in modifications)
 * - Sensitive files being accessed
 */

import {
  FileHeatmapEntry,
  FileAnomaly,
  AnomalyType,
  AnomalySeverity,
  AnomalyDetectionOptions,
  AnomalyStats,
} from '../../types.js';

/** Default patterns for configuration files */
const DEFAULT_CONFIG_PATTERNS = [
  /\.config\.(ts|js|json|yaml|yml)$/i,
  /config\.(ts|js|json|yaml|yml)$/i,
  /\/\.env$/,
  /\.env\./,
  /\/config\//,
  /\/settings\//,
  /\/conf\//,
  /\.rc\.(json|js|yaml|yml)$/i,
  /\/rc$/,
  /settings\.(ts|js|json|yaml|yml)$/i,
];

/** Default patterns for sensitive files */
const DEFAULT_SENSITIVE_PATTERNS = [
  /secret/i,
  /credential/i,
  /password/i,
  /api[-_]?key/i,
  /token/i,
  /auth/i,
  /\.pem$/,
  /\.key$/,
  /id_rsa/,
  /\.ssh\//,
];

/** Default options */
const DEFAULT_OPTIONS: Required<AnomalyDetectionOptions> = {
  minModifications: 1,
  frequencyThreshold: 3.0,      // 3x average = anomaly
  burstWindow: 60000,           // 1 minute
  burstThreshold: 10,           // 10+ mods in 1 minute = burst
  sensitivePatterns: [],
};

/**
 * Check if a path matches any pattern
 */
function matchesPattern(path: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(path));
}

/**
 * Calculate statistics for modifications
 */
function calculateStats(entries: FileHeatmapEntry[]): {
  avgModifications: number;
  stdDevModifications: number;
  avgInterval: number;
} {
  if (entries.length === 0) {
    return { avgModifications: 0, stdDevModifications: 0, avgInterval: 0 };
  }

  const modifications = entries.map(e => e.modifications);
  const avgModifications = modifications.reduce((a, b) => a + b, 0) / modifications.length;

  const squaredDiffs = modifications.map(m => Math.pow(m - avgModifications, 2));
  const stdDevModifications = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / modifications.length);

  const intervals = entries
    .filter(e => e.avgModificationInterval > 0)
    .map(e => e.avgModificationInterval);
  const avgInterval = intervals.length > 0
    ? intervals.reduce((a, b) => a + b, 0) / intervals.length
    : 0;

  return { avgModifications, stdDevModifications, avgInterval };
}

/**
 * Detect anomalies in file activity
 */
export function detectAnomalies(
  entries: FileHeatmapEntry[],
  options: AnomalyDetectionOptions = {}
): FileAnomaly[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const anomalies: FileAnomaly[] = [];
  const now = Date.now();

  // Combine sensitive patterns
  const sensitivePatterns = [
    ...DEFAULT_SENSITIVE_PATTERNS,
    ...opts.sensitivePatterns.map(p => new RegExp(p, 'i')),
  ];

  // Calculate baseline statistics
  const stats = calculateStats(entries);

  for (const entry of entries) {
    // Skip if below minimum modifications
    if (entry.modifications < opts.minModifications) continue;

    // 1. Detect config file modifications
    if (matchesPattern(entry.path, DEFAULT_CONFIG_PATTERNS)) {
      anomalies.push({
        path: entry.path,
        type: 'config_modification',
        severity: 'warning',
        message: `Configuration file modified outside of config-related task`,
        detectedAt: now,
        details: {
          modifications: entry.modifications,
          workers: entry.workers.map(w => w.workerId),
          context: {
            heatLevel: entry.heatLevel,
          },
        },
      });
    }

    // 2. Detect sensitive file access
    if (matchesPattern(entry.path, sensitivePatterns)) {
      anomalies.push({
        path: entry.path,
        type: 'sensitive_file',
        severity: 'critical',
        message: `Sensitive file accessed - review for security implications`,
        detectedAt: now,
        details: {
          modifications: entry.modifications,
          workers: entry.workers.map(w => w.workerId),
          context: {
            pattern: 'sensitive',
          },
        },
      });
    }

    // 3. Detect high-frequency modifications (outliers)
    if (
      stats.avgModifications > 0 &&
      entry.modifications > stats.avgModifications * opts.frequencyThreshold
    ) {
      const ratio = entry.modifications / stats.avgModifications;
      const severity: AnomalySeverity = ratio > opts.frequencyThreshold * 2 ? 'critical' : 'warning';

      anomalies.push({
        path: entry.path,
        type: 'high_frequency',
        severity,
        message: `High modification frequency (${ratio.toFixed(1)}x average)`,
        detectedAt: now,
        details: {
          modifications: entry.modifications,
          workers: entry.workers.map(w => w.workerId),
          expectedValue: Math.round(stats.avgModifications),
          actualValue: entry.modifications,
          context: {
            ratio: ratio,
          },
        },
      });
    }

    // 4. Detect burst activity (very low modification interval)
    if (
      entry.avgModificationInterval > 0 &&
      entry.avgModificationInterval < 1000 && // Less than 1 second between mods
      entry.modifications >= opts.burstThreshold
    ) {
      anomalies.push({
        path: entry.path,
        type: 'burst_activity',
        severity: 'warning',
        message: `Burst activity detected - ${entry.modifications} modifications in rapid succession`,
        detectedAt: now,
        details: {
          modifications: entry.modifications,
          workers: entry.workers.map(w => w.workerId),
          timeSpan: entry.lastModified - entry.firstModified,
          context: {
            avgInterval: entry.avgModificationInterval,
          },
        },
      });
    }

    // 5. Detect unusual patterns (multiple workers on typically single-worker files)
    if (
      entry.workers.length >= 3 &&
      entry.modifications > 5
    ) {
      anomalies.push({
        path: entry.path,
        type: 'unusual_pattern',
        severity: 'info',
        message: `Unusual multi-worker activity on same file (${entry.workers.length} workers)`,
        detectedAt: now,
        details: {
          modifications: entry.modifications,
          workers: entry.workers.map(w => w.workerId),
          context: {
            workerCount: entry.workers.length,
            collision: entry.hasCollision,
          },
        },
      });
    }
  }

  // Sort by severity (critical first) then by path
  const severityOrder: Record<AnomalySeverity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };

  anomalies.sort((a, b) => {
    const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (severityDiff !== 0) return severityDiff;
    return a.path.localeCompare(b.path);
  });

  return anomalies;
}

/**
 * Get anomaly statistics
 */
export function getAnomalyStats(anomalies: FileAnomaly[]): AnomalyStats {
  const byType: Record<AnomalyType, number> = {
    config_modification: 0,
    high_frequency: 0,
    burst_activity: 0,
    unusual_pattern: 0,
    sensitive_file: 0,
  };

  const bySeverity: Record<AnomalySeverity, number> = {
    info: 0,
    warning: 0,
    critical: 0,
  };

  const fileAnomalies = new Map<string, { count: number; types: Set<AnomalyType> }>();

  for (const anomaly of anomalies) {
    byType[anomaly.type]++;
    bySeverity[anomaly.severity]++;

    const existing = fileAnomalies.get(anomaly.path);
    if (existing) {
      existing.count++;
      existing.types.add(anomaly.type);
    } else {
      fileAnomalies.set(anomaly.path, {
        count: 1,
        types: new Set([anomaly.type]),
      });
    }
  }

  // Get top 5 files with most anomalies
  const topAnomalyFiles = Array.from(fileAnomalies.entries())
    .map(([path, data]) => ({
      path,
      count: data.count,
      types: Array.from(data.types),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    totalAnomalies: anomalies.length,
    byType,
    bySeverity,
    topAnomalyFiles,
  };
}

/**
 * Get severity icon for display
 */
export function getAnomalyIcon(severity: AnomalySeverity): string {
  switch (severity) {
    case 'critical': return '🚨';
    case 'warning': return '⚠️';
    case 'info': return 'ℹ️';
    default: return '?';
  }
}

/**
 * Get color name for severity
 */
export function getAnomalyColor(severity: AnomalySeverity): string {
  switch (severity) {
    case 'critical': return 'red';
    case 'warning': return 'yellow';
    case 'info': return 'blue';
    default: return 'gray';
  }
}

/**
 * Get short label for anomaly type
 */
export function getAnomalyTypeLabel(type: AnomalyType): string {
  switch (type) {
    case 'config_modification': return 'CONFIG';
    case 'high_frequency': return 'FREQ';
    case 'burst_activity': return 'BURST';
    case 'unusual_pattern': return 'PATTERN';
    case 'sensitive_file': return 'SENSITIVE';
    default: return 'UNKNOWN';
  }
}

export default {
  detectAnomalies,
  getAnomalyStats,
  getAnomalyIcon,
  getAnomalyColor,
  getAnomalyTypeLabel,
};
