/**
 * Tests for File Anomaly Detection
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  detectAnomalies,
  getAnomalyStats,
  getAnomalyIcon,
  getAnomalyColor,
  getAnomalyTypeLabel,
} from './fileAnomalyDetection.js';
import { FileHeatmapEntry, AnomalyType, AnomalySeverity } from '../../types.js';

// Helper to create mock heatmap entries
function createMockEntry(overrides: Partial<FileHeatmapEntry> = {}): FileHeatmapEntry {
  return {
    path: '/src/test.ts',
    modifications: 1,
    heatLevel: 'cold',
    workers: [{ workerId: 'worker-1', modifications: 1, lastModified: Date.now(), percentage: 100 }],
    firstModified: Date.now() - 1000,
    lastModified: Date.now(),
    hasCollision: false,
    activeWorkers: 1,
    avgModificationInterval: 0,
    ...overrides,
  };
}

describe('detectAnomalies', () => {
  it('should return empty array for normal file activity', () => {
    const entries: FileHeatmapEntry[] = [
      createMockEntry({ path: '/src/index.ts', modifications: 3 }),
      createMockEntry({ path: '/src/utils.ts', modifications: 2 }),
    ];

    const anomalies = detectAnomalies(entries);

    expect(anomalies.length).toBe(0);
  });

  it('should detect config file modifications', () => {
    const entries: FileHeatmapEntry[] = [
      createMockEntry({ path: '/src/config/app.config.ts', modifications: 1 }),
    ];

    const anomalies = detectAnomalies(entries);

    expect(anomalies.length).toBeGreaterThan(0);
    expect(anomalies[0].type).toBe('config_modification');
    expect(anomalies[0].severity).toBe('warning');
    expect(anomalies[0].message).toContain('Configuration file');
  });

  it('should detect various config file patterns', () => {
    const configPaths = [
      '/src/.env',
      '/src/.env.production',
      '/src/config/database.yml',
      '/src/settings.json',
      '/src/app.config.js',
    ];

    for (const path of configPaths) {
      const entries = [createMockEntry({ path })];
      const anomalies = detectAnomalies(entries);
      expect(anomalies.some(a => a.type === 'config_modification')).toBe(true);
    }
  });

  it('should detect sensitive file access', () => {
    const entries: FileHeatmapEntry[] = [
      createMockEntry({ path: '/src/secrets/api-key.ts', modifications: 1 }),
    ];

    const anomalies = detectAnomalies(entries);

    expect(anomalies.some(a => a.type === 'sensitive_file')).toBe(true);
    const sensitive = anomalies.find(a => a.type === 'sensitive_file');
    expect(sensitive?.severity).toBe('critical');
  });

  it('should detect various sensitive file patterns', () => {
    const sensitivePaths = [
      '/src/auth/password.ts',
      '/src/credentials/db.ts',
      '/src/.ssh/id_rsa',
      '/src/certs/server.pem',
    ];

    for (const path of sensitivePaths) {
      const entries = [createMockEntry({ path })];
      const anomalies = detectAnomalies(entries);
      expect(anomalies.some(a => a.type === 'sensitive_file')).toBe(true);
    }
  });

  it('should detect high-frequency modifications', () => {
    // Create entries where one has significantly more modifications
    const entries: FileHeatmapEntry[] = [
      createMockEntry({ path: '/src/normal.ts', modifications: 5 }),
      createMockEntry({ path: '/src/normal2.ts', modifications: 3 }),
      createMockEntry({ path: '/src/normal3.ts', modifications: 4 }),
      createMockEntry({ path: '/src/hot.ts', modifications: 50 }), // 10x average
    ];

    const anomalies = detectAnomalies(entries);

    const highFreq = anomalies.find(a => a.type === 'high_frequency');
    expect(highFreq).toBeDefined();
    expect(highFreq?.path).toBe('/src/hot.ts');
    expect(highFreq?.details.actualValue).toBe(50);
    expect(highFreq?.details.expectedValue).toBeDefined();
  });

  it('should detect burst activity', () => {
    const entries: FileHeatmapEntry[] = [
      createMockEntry({
        path: '/src/burst.ts',
        modifications: 15,
        avgModificationInterval: 100, // Very fast - 100ms between mods
        firstModified: Date.now() - 1500,
        lastModified: Date.now(),
      }),
    ];

    const anomalies = detectAnomalies(entries);

    const burst = anomalies.find(a => a.type === 'burst_activity');
    expect(burst).toBeDefined();
    expect(burst?.message).toContain('Burst activity');
  });

  it('should detect unusual multi-worker patterns', () => {
    const entries: FileHeatmapEntry[] = [
      createMockEntry({
        path: '/src/shared.ts',
        modifications: 10,
        workers: [
          { workerId: 'w1', modifications: 4, lastModified: Date.now(), percentage: 40 },
          { workerId: 'w2', modifications: 3, lastModified: Date.now(), percentage: 30 },
          { workerId: 'w3', modifications: 3, lastModified: Date.now(), percentage: 30 },
        ],
      }),
    ];

    const anomalies = detectAnomalies(entries);

    const unusual = anomalies.find(a => a.type === 'unusual_pattern');
    expect(unusual).toBeDefined();
    expect(unusual?.severity).toBe('info');
  });

  it('should sort anomalies by severity', () => {
    const entries: FileHeatmapEntry[] = [
      createMockEntry({ path: '/src/config.ts', modifications: 1 }), // warning
      createMockEntry({ path: '/src/secrets.ts', modifications: 1 }), // critical
      createMockEntry({ path: '/src/shared.ts', modifications: 10, workers: [ // info
        { workerId: 'w1', modifications: 4, lastModified: Date.now(), percentage: 40 },
        { workerId: 'w2', modifications: 3, lastModified: Date.now(), percentage: 30 },
        { workerId: 'w3', modifications: 3, lastModified: Date.now(), percentage: 30 },
      ]}),
    ];

    const anomalies = detectAnomalies(entries);

    // Should be sorted: critical first, then warning, then info
    const severities = anomalies.map(a => a.severity);
    expect(severities.indexOf('critical')).toBeLessThan(severities.indexOf('warning'));
    expect(severities.indexOf('warning')).toBeLessThan(severities.indexOf('info'));
  });

  it('should respect minModifications option', () => {
    const entries: FileHeatmapEntry[] = [
      createMockEntry({ path: '/src/config.ts', modifications: 0 }),
    ];

    const anomalies = detectAnomalies(entries, { minModifications: 1 });

    expect(anomalies.length).toBe(0);
  });

  it('should respect frequencyThreshold option', () => {
    const entries: FileHeatmapEntry[] = [
      createMockEntry({ path: '/src/a.ts', modifications: 5 }),
      createMockEntry({ path: '/src/b.ts', modifications: 4 }),
      createMockEntry({ path: '/src/hot.ts', modifications: 20 }), // 4x average
    ];

    // With high threshold, no anomaly
    const anomalies1 = detectAnomalies(entries, { frequencyThreshold: 10 });
    expect(anomalies1.some(a => a.type === 'high_frequency')).toBe(false);

    // With low threshold, should detect
    const anomalies2 = detectAnomalies(entries, { frequencyThreshold: 2 });
    expect(anomalies2.some(a => a.type === 'high_frequency')).toBe(true);
  });
});

describe('getAnomalyStats', () => {
  it('should return correct statistics', () => {
    const anomalies = [
      {
        path: '/src/config.ts',
        type: 'config_modification' as AnomalyType,
        severity: 'warning' as AnomalySeverity,
        message: 'Test',
        detectedAt: Date.now(),
        details: {},
      },
      {
        path: '/src/config.ts',
        type: 'high_frequency' as AnomalyType,
        severity: 'critical' as AnomalySeverity,
        message: 'Test',
        detectedAt: Date.now(),
        details: {},
      },
      {
        path: '/src/secret.ts',
        type: 'sensitive_file' as AnomalyType,
        severity: 'critical' as AnomalySeverity,
        message: 'Test',
        detectedAt: Date.now(),
        details: {},
      },
    ];

    const stats = getAnomalyStats(anomalies);

    expect(stats.totalAnomalies).toBe(3);
    expect(stats.byType.config_modification).toBe(1);
    expect(stats.byType.high_frequency).toBe(1);
    expect(stats.byType.sensitive_file).toBe(1);
    expect(stats.bySeverity.critical).toBe(2);
    expect(stats.bySeverity.warning).toBe(1);
    expect(stats.topAnomalyFiles[0].path).toBe('/src/config.ts');
    expect(stats.topAnomalyFiles[0].count).toBe(2);
  });

  it('should handle empty anomalies', () => {
    const stats = getAnomalyStats([]);

    expect(stats.totalAnomalies).toBe(0);
    expect(stats.topAnomalyFiles.length).toBe(0);
  });
});

describe('anomaly display helpers', () => {
  it('should return correct icons for severity', () => {
    expect(getAnomalyIcon('critical')).toBe('🚨');
    expect(getAnomalyIcon('warning')).toBe('⚠️');
    expect(getAnomalyIcon('info')).toBe('ℹ️');
  });

  it('should return correct colors for severity', () => {
    expect(getAnomalyColor('critical')).toBe('red');
    expect(getAnomalyColor('warning')).toBe('yellow');
    expect(getAnomalyColor('info')).toBe('blue');
  });

  it('should return correct labels for types', () => {
    expect(getAnomalyTypeLabel('config_modification')).toBe('CONFIG');
    expect(getAnomalyTypeLabel('high_frequency')).toBe('FREQ');
    expect(getAnomalyTypeLabel('burst_activity')).toBe('BURST');
    expect(getAnomalyTypeLabel('unusual_pattern')).toBe('PATTERN');
    expect(getAnomalyTypeLabel('sensitive_file')).toBe('SENSITIVE');
  });
});
