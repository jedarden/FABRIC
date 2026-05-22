/**
 * Tests for Bead Workspace Scanner
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { scanBeadWorkspaces, getProjectStats, getClosedBeadsForWorkspace, ProjectStats } from './beadWorkspaceScanner.js';
import { WorkspaceConfig } from './config.js';

// Mock fs module
vi.mock('fs');
const mockFs = vi.mocked(fs);

// Mock config module
vi.mock('./config.js', () => ({
  loadWorkspaces: vi.fn(),
}));

describe('Bead Workspace Scanner', () => {
  const mockWorkspaces: WorkspaceConfig[] = [
    {
      path: '/home/coding/FABRIC',
      name: 'FABRIC',
      prefix: 'bf',
    },
    {
      path: '/home/coding/spaxel',
      name: 'spaxel',
      prefix: 'bf',
    },
  ];

  const mockBeadsData = {
    '/home/coding/FABRIC/.beads/issues.jsonl': [
      JSON.stringify({
        id: 'bf-1abc',
        title: 'Test bead 1',
        status: 'closed',
        closed_at: '2026-05-20T10:00:00Z',
        assignee: 'claude-code-glm-4.7-alpha',
        source_repo: '.',
      }),
      JSON.stringify({
        id: 'bf-2def',
        title: 'Test bead 2',
        status: 'open',
        source_repo: '.',
      }),
      JSON.stringify({
        id: 'bf-3ghi',
        title: 'Test bead 3',
        status: 'closed',
        closed_at: '2026-05-21T14:30:00Z',
        assignee: 'claude-code-glm-4.7-beta',
        source_repo: '.',
      }),
    ].join('\n'),
    '/home/coding/spaxel/.beads/issues.jsonl': [
      JSON.stringify({
        id: 'bf-4jkl',
        title: 'Spaxel bead 1',
        status: 'closed',
        closed_at: '2026-05-19T08:00:00Z',
        assignee: 'claude-code-glm-4.7-gamma',
        source_repo: '.',
      }),
      JSON.stringify({
        id: 'bf-5mno',
        title: 'Spaxel bead 2',
        status: 'closed',
        closed_at: '2026-05-20T12:00:00Z',
        assignee: 'claude-code-glm-4.7-alpha',
        source_repo: '.',
      }),
    ].join('\n'),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock loadWorkspaces to return our test workspaces
    const { loadWorkspaces } = await import('./config.js');
    vi.mocked(loadWorkspaces).mockReturnValue(mockWorkspaces);

    // Mock fs.existsSync to return true for our test files
    mockFs.existsSync.mockImplementation((filePath) => {
      const pathStr = String(filePath);
      return Object.keys(mockBeadsData).includes(pathStr);
    });

    // Mock fs.readFileSync to return our test data
    mockFs.readFileSync.mockImplementation((filePath) => {
      const pathStr = String(filePath);
      if (mockBeadsData[pathStr]) {
        return mockBeadsData[pathStr];
      }
      throw new Error(`File not found: ${pathStr}`);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('scanBeadWorkspaces', () => {
    it('should scan all configured workspaces', () => {
      const result = scanBeadWorkspaces();

      expect(result.workspacesScanned).toBe(2);
      expect(result.totalBeads).toBe(5);
      expect(result.totalClosed).toBe(4);
    });

    it('should return project stats sorted by closed count', () => {
      const result = scanBeadWorkspaces();

      expect(result.byProject).toHaveLength(2);
      expect(result.byProject[0].name).toBe('FABRIC');
      expect(result.byProject[0].closedCount).toBe(2);
      expect(result.byProject[1].name).toBe('spaxel');
      expect(result.byProject[1].closedCount).toBe(2);
    });

    it('should track assignees per project', () => {
      const result = scanBeadWorkspaces();

      const fabric = result.byProject.find(p => p.name === 'FABRIC');
      expect(fabric?.byAssignee['claude-code-glm-4.7-alpha']).toBe(1);
      expect(fabric?.byAssignee['claude-code-glm-4.7-beta']).toBe(1);

      const spaxel = result.byProject.find(p => p.name === 'spaxel');
      expect(spaxel?.byAssignee['claude-code-glm-4.7-gamma']).toBe(1);
      expect(spaxel?.byAssignee['claude-code-glm-4.7-alpha']).toBe(1);
    });

    it('should track most recent closure timestamp', () => {
      const result = scanBeadWorkspaces();

      const fabric = result.byProject.find(p => p.name === 'FABRIC');
      expect(fabric?.lastClosedAt).toBe('2026-05-21T14:30:00Z');

      const spaxel = result.byProject.find(p => p.name === 'spaxel');
      expect(spaxel?.lastClosedAt).toBe('2026-05-20T12:00:00Z');
    });

    it('should handle missing workspace directories gracefully', () => {
      mockFs.existsSync.mockImplementation((filePath) => {
        const pathStr = String(filePath);
        return pathStr.includes('spaxel'); // Only spaxel exists
      });

      const result = scanBeadWorkspaces();

      expect(result.workspacesScanned).toBe(2);
      expect(result.byProject).toHaveLength(1);
      expect(result.byProject[0].name).toBe('spaxel');
    });

    it('should handle invalid JSON lines gracefully', () => {
      mockFs.readFileSync.mockImplementation((filePath) => {
        const pathStr = String(filePath);
        if (pathStr.includes('FABRIC')) {
          return [
            JSON.stringify({
              id: 'bf-1abc',
              title: 'Valid bead',
              status: 'closed',
              closed_at: '2026-05-20T10:00:00Z',
              source_repo: '.',
            }),
            'invalid json line',
            JSON.stringify({
              id: 'bf-2def',
              title: 'Another valid bead',
              status: 'closed',
              closed_at: '2026-05-21T10:00:00Z',
              source_repo: '.',
            }),
          ].join('\n');
        }
        return '';
      });

      const result = scanBeadWorkspaces();

      expect(result.totalClosed).toBe(2);
    });
  });

  describe('getProjectStats', () => {
    it('should return stats for a specific project', () => {
      const stats = getProjectStats('FABRIC');

      expect(stats).toBeDefined();
      expect(stats?.name).toBe('FABRIC');
      expect(stats?.closedCount).toBe(2);
      expect(stats?.prefix).toBe('bf');
    });

    it('should return undefined for non-existent project', () => {
      const stats = getProjectStats('nonexistent');

      expect(stats).toBeUndefined();
    });
  });

  describe('getClosedBeadsForWorkspace', () => {
    it('should return closed beads for a workspace', () => {
      const beads = getClosedBeadsForWorkspace('/home/coding/FABRIC');

      expect(beads).toHaveLength(2);
      expect(beads[0].status).toBe('closed');
      expect(beads[1].status).toBe('closed');
    });

    it('should respect limit parameter', () => {
      const beads = getClosedBeadsForWorkspace('/home/coding/FABRIC', 1);

      expect(beads).toHaveLength(1);
    });

    it('should return empty array for non-existent workspace', () => {
      mockFs.existsSync.mockReturnValue(false);
      const beads = getClosedBeadsForWorkspace('/nonexistent/path');

      expect(beads).toEqual([]);
    });
  });
});
