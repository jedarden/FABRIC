/**
 * Bead Workspace Scanner
 *
 * Reads .beads/issues.jsonl files from configured workspaces
 * and counts CLOSED beads per project for productivity analytics.
 */

import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceConfig, loadWorkspaces } from './config.js';

/**
 * Bead record from issues.jsonl
 */
interface BeadRecord {
  id: string;
  title: string;
  description: string;
  design: string;
  acceptance_criteria: string;
  notes: string;
  status: 'open' | 'in_progress' | 'blocked' | 'completed' | 'closed' | 'deferred';
  priority: number;
  issue_type: string;
  created_at: string;
  updated_at: string;
  closed_at?: string;
  close_reason?: string;
  assignee?: string;
  source_repo: string;
  compaction_level: number;
  labels?: string[];
  dependencies?: Array<{
    issue_id: string;
    depends_on_id: string;
    type: string;
    created_at: string;
    created_by: string;
    thread_id: string;
  }>;
  comments?: Array<{
    id: number;
    issue_id: string;
    author: string;
    text: string;
    created_at: string;
  }>;
}

/**
 * Project productivity stats
 */
export interface ProjectStats {
  /** Project name */
  name: string;
  /** Bead ID prefix for this project */
  prefix: string;
  /** Total closed beads */
  closedCount: number;
  /** Beads closed by assignee */
  byAssignee: Record<string, number>;
  /** Most recent closure timestamp */
  lastClosedAt?: string;
}

/**
 * Scan result summary
 */
export interface ScanResult {
  /** Total workspaces scanned */
  workspacesScanned: number;
  /** Total beads read */
  totalBeads: number;
  /** Total closed beads across all projects */
  totalClosed: number;
  /** Project breakdown */
  byProject: ProjectStats[];
}

/**
 * Scan all configured workspaces and count closed beads
 */
export function scanBeadWorkspaces(): ScanResult {
  const workspaces = loadWorkspaces();
  const projectStats = new Map<string, ProjectStats>();

  let totalBeads = 0;
  let totalClosed = 0;

  for (const workspace of workspaces) {
    const issuesFile = path.join(workspace.path, '.beads', 'issues.jsonl');

    try {
      if (!fs.existsSync(issuesFile)) {
        continue;
      }

      const content = fs.readFileSync(issuesFile, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());

      for (const line of lines) {
        totalBeads++;
        let bead: BeadRecord;

        try {
          bead = JSON.parse(line) as BeadRecord;
        } catch {
          // Skip invalid JSON lines
          continue;
        }

        // Only count closed beads
        if (bead.status !== 'closed') {
          continue;
        }

        totalClosed++;

        // Get or create project stats
        let stats = projectStats.get(workspace.name);
        if (!stats) {
          stats = {
            name: workspace.name,
            prefix: workspace.prefix,
            closedCount: 0,
            byAssignee: {},
          };
          projectStats.set(workspace.name, stats);
        }

        stats.closedCount++;

        // Track by assignee
        const assignee = bead.assignee || 'unassigned';
        stats.byAssignee[assignee] = (stats.byAssignee[assignee] || 0) + 1;

        // Track most recent closure
        if (bead.closed_at) {
          if (!stats.lastClosedAt || bead.closed_at > stats.lastClosedAt) {
            stats.lastClosedAt = bead.closed_at;
          }
        }
      }
    } catch {
      // Skip workspaces that can't be read
      continue;
    }
  }

  // Convert map to array and sort by closed count
  const byProject = Array.from(projectStats.values()).sort(
    (a, b) => b.closedCount - a.closedCount
  );

  return {
    workspacesScanned: workspaces.length,
    totalBeads,
    totalClosed,
    byProject,
  };
}

/**
 * Get project stats for a specific project name
 */
export function getProjectStats(projectName: string): ProjectStats | undefined {
  const result = scanBeadWorkspaces();
  return result.byProject.find(p => p.name === projectName);
}

/**
 * Get closed beads for a specific workspace
 */
export function getClosedBeadsForWorkspace(
  workspacePath: string,
  limit?: number
): BeadRecord[] {
  const issuesFile = path.join(workspacePath, '.beads', 'issues.jsonl');
  const closedBeads: BeadRecord[] = [];

  try {
    if (!fs.existsSync(issuesFile)) {
      return closedBeads;
    }

    const content = fs.readFileSync(issuesFile, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());

    for (const line of lines) {
      let bead: BeadRecord;
      try {
        bead = JSON.parse(line) as BeadRecord;
      } catch {
        continue;
      }

      if (bead.status === 'closed') {
        closedBeads.push(bead);
        if (limit && closedBeads.length >= limit) {
          break;
        }
      }
    }
  } catch {
    // Return empty on error
  }

  return closedBeads;
}
