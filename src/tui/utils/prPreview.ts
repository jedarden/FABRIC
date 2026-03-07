/**
 * PR Preview Generation Utilities
 *
 * Generates PR title, description, and conflict detection from git events.
 */

import {
  GitEvent,
  GitStatusEvent,
  GitCommitEvent,
  GitFileChange,
  PRPreview,
  PRFileChange,
  UpstreamCommit,
  PotentialConflict,
} from '../../types.js';

/**
 * Generate a PR title from commit messages
 */
export function generatePRTitle(commits: GitCommitEvent[]): string {
  if (commits.length === 0) {
    return 'WIP: Changes';
  }

  // Use the first commit message as the base
  const firstMessage = commits[0].message.split('\n')[0];

  // Check if it's a conventional commit format
  const conventionalMatch = firstMessage.match(/^(\w+)(?:\(([^)]+)\))?:\s*(.+)$/);
  if (conventionalMatch) {
    const [, type, scope, subject] = conventionalMatch;
    return scope ? `${type}(${scope}): ${subject}` : `${type}: ${subject}`;
  }

  // Otherwise, use the first line of the first commit
  return firstMessage.slice(0, 72);
}

/**
 * Generate a PR description from commits and file changes
 */
export function generatePRDescription(
  commits: GitCommitEvent[],
  files: PRFileChange[],
  beads: string[] = []
): string {
  const lines: string[] = [];

  // Summary line
  lines.push('## Summary');
  lines.push('');

  if (commits.length > 0) {
    // Extract bullet points from commit messages
    const bulletPoints = new Set<string>();
    for (const commit of commits) {
      const msgLines = commit.message.split('\n');
      for (const line of msgLines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          bulletPoints.add(trimmed.slice(2));
        }
      }
    }

    if (bulletPoints.size > 0) {
      for (const point of bulletPoints) {
        lines.push(`- ${point}`);
      }
    } else {
      // Use first lines of commit messages
      for (const commit of commits) {
        const firstLine = commit.message.split('\n')[0];
        if (firstLine && !firstLine.startsWith('Merge')) {
          lines.push(`- ${firstLine}`);
        }
      }
    }
  } else {
    lines.push('- Changes in progress');
  }

  lines.push('');

  // Files changed section
  if (files.length > 0) {
    lines.push('## Files Changed');
    lines.push('');

    const byStatus: Record<string, PRFileChange[]> = {
      added: [],
      modified: [],
      deleted: [],
      renamed: [],
      other: [],
    };

    for (const file of files) {
      if (file.status === 'added') byStatus.added.push(file);
      else if (file.status === 'modified') byStatus.modified.push(file);
      else if (file.status === 'deleted') byStatus.deleted.push(file);
      else if (file.status === 'renamed') byStatus.renamed.push(file);
      else byStatus.other.push(file);
    }

    if (byStatus.added.length > 0) {
      lines.push(`**Added (${byStatus.added.length}):**`);
      for (const f of byStatus.added.slice(0, 5)) {
        lines.push(`- \`${f.path}\` (+${f.linesAdded})`);
      }
      if (byStatus.added.length > 5) {
        lines.push(`- ... and ${byStatus.added.length - 5} more`);
      }
      lines.push('');
    }

    if (byStatus.modified.length > 0) {
      lines.push(`**Modified (${byStatus.modified.length}):**`);
      for (const f of byStatus.modified.slice(0, 5)) {
        lines.push(`- \`${f.path}\` (+${f.linesAdded}/-${f.linesDeleted})`);
      }
      if (byStatus.modified.length > 5) {
        lines.push(`- ... and ${byStatus.modified.length - 5} more`);
      }
      lines.push('');
    }

    if (byStatus.deleted.length > 0) {
      lines.push(`**Deleted (${byStatus.deleted.length}):**`);
      for (const f of byStatus.deleted.slice(0, 5)) {
        lines.push(`- \`${f.path}\``);
      }
      if (byStatus.deleted.length > 5) {
        lines.push(`- ... and ${byStatus.deleted.length - 5} more`);
      }
      lines.push('');
    }
  }

  // Related beads
  if (beads.length > 0) {
    lines.push('## Related Tasks');
    lines.push('');
    for (const bead of beads) {
      lines.push(`- Closes #${bead}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Generate a commit message from activity
 */
export function generateCommitMessage(
  commits: GitCommitEvent[],
  files: PRFileChange[],
  bead?: string
): string {
  const lines: string[] = [];

  // Title line
  if (commits.length > 0) {
    lines.push(commits[0].message.split('\n')[0]);
  } else if (files.length > 0) {
    // Infer type from file changes
    const hasNewFiles = files.some(f => f.status === 'added');
    const hasDeletedFiles = files.some(f => f.status === 'deleted');
    const hasModifiedFiles = files.some(f => f.status === 'modified');

    let type = 'chore';
    if (hasNewFiles) type = 'feat';
    else if (hasDeletedFiles) type = 'refactor';
    else if (hasModifiedFiles) type = 'fix';

    // Get common directory
    const dirs = files.map(f => f.path.split('/').slice(0, -1).join('/'));
    const commonDir = findCommonPrefix(dirs);

    const scope = commonDir ? `(${commonDir.split('/').pop()})` : '';
    lines.push(`${type}${scope}: update ${files.length} file${files.length > 1 ? 's' : ''}`);
  } else {
    lines.push('chore: update files');
  }

  // Blank line before body
  lines.push('');

  // Body - list changes
  if (files.length > 0) {
    const summary = summarizeFileChanges(files);
    lines.push(summary);
  }

  // Add bead reference
  if (bead) {
    lines.push('');
    lines.push(`Closes #${bead}`);
  }

  // Add co-authorship
  lines.push('');
  lines.push('Co-Authored-By: Claude Worker <noreply@anthropic.com>');

  return lines.join('\n');
}

/**
 * Summarize file changes in a human-readable format
 */
function summarizeFileChanges(files: PRFileChange[]): string {
  const byDir: Map<string, PRFileChange[]> = new Map();

  for (const file of files) {
    const dir = file.path.split('/').slice(0, -1).join('/') || 'root';
    if (!byDir.has(dir)) {
      byDir.set(dir, []);
    }
    byDir.get(dir)!.push(file);
  }

  const lines: string[] = [];

  if (byDir.size === 1) {
    // All files in same directory
    for (const [, dirFiles] of byDir) {
      for (const f of dirFiles.slice(0, 10)) {
        const status = getStatusEmoji(f.status);
        const diff = f.status !== 'deleted' ? ` (+${f.linesAdded}/-${f.linesDeleted})` : '';
        lines.push(`${status} ${f.path}${diff}`);
      }
      if (dirFiles.length > 10) {
        lines.push(`... and ${dirFiles.length - 10} more files`);
      }
    }
  } else {
    // Multiple directories
    for (const [dir, dirFiles] of byDir) {
      const totalAdded = dirFiles.reduce((sum, f) => sum + f.linesAdded, 0);
      const totalDeleted = dirFiles.reduce((sum, f) => sum + f.linesDeleted, 0);
      lines.push(`${dir}/: ${dirFiles.length} files (+${totalAdded}/-${totalDeleted})`);
    }
  }

  return lines.join('\n');
}

/**
 * Get emoji for file status
 */
function getStatusEmoji(status: string): string {
  switch (status) {
    case 'added': return '+';
    case 'modified': return 'M';
    case 'deleted': return '-';
    case 'renamed': return 'R';
    case 'copied': return 'C';
    default: return '•';
  }
}

/**
 * Find common prefix of an array of strings
 */
function findCommonPrefix(strings: string[]): string {
  if (strings.length === 0) return '';
  if (strings.length === 1) return strings[0];

  const sorted = [...strings].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  let i = 0;
  while (i < first.length && first[i] === last[i]) {
    i++;
  }

  return first.slice(0, i);
}

/**
 * Detect potential conflicts with upstream
 */
export function detectPotentialConflicts(
  localFiles: GitFileChange[],
  upstreamCommits: UpstreamCommit[],
  ahead: number,
  behind: number
): PotentialConflict {
  const conflictingFiles: string[] = [];

  // Get local file paths
  const localPaths = new Set(localFiles.map(f => f.path));

  // Check upstream commits for overlapping files
  for (const commit of upstreamCommits) {
    for (const file of commit.files) {
      if (localPaths.has(file) && !conflictingFiles.includes(file)) {
        conflictingFiles.push(file);
      }
    }
  }

  const hasUpstreamCommits = upstreamCommits.length > 0;
  const rebaseRecommended = behind > 0 && conflictingFiles.length > 0;

  let rebaseReason: string | undefined;
  if (rebaseRecommended) {
    rebaseReason = `${behind} new commit${behind > 1 ? 's' : ''} on upstream, ${conflictingFiles.length} file${conflictingFiles.length > 1 ? 's' : ''} may conflict`;
  } else if (behind > 0) {
    rebaseReason = `${behind} new commit${behind > 1 ? 's' : ''} on upstream since branch creation`;
  }

  return {
    hasUpstreamCommits,
    upstreamCommitCount: upstreamCommits.length,
    upstreamCommits,
    conflictingFiles,
    rebaseRecommended,
    rebaseReason,
  };
}

/**
 * Generate a PR preview from git events
 */
export function generatePRPreview(
  events: GitEvent[],
  options: {
    targetBranch?: string;
    beadIds?: string[];
  } = {}
): PRPreview {
  const { targetBranch = 'main', beadIds = [] } = options;

  // Extract status event
  const statusEvents = events.filter((e): e is GitStatusEvent => e.type === 'status');
  const currentStatus = statusEvents.length > 0 ? statusEvents[statusEvents.length - 1] : null;

  // Extract commits
  const commitEvents = events.filter((e): e is GitCommitEvent => e.type === 'commit');

  // Build file changes with stats
  const fileMap = new Map<string, PRFileChange>();

  // Add files from status
  if (currentStatus) {
    for (const file of [...currentStatus.staged, ...currentStatus.unstaged]) {
      if (!fileMap.has(file.path)) {
        fileMap.set(file.path, {
          ...file,
          linesAdded: 0,
          linesDeleted: 0,
        });
      }
    }
  }

  // Add files from commits with stats
  for (const commit of commitEvents) {
    if (commit.files) {
      for (const file of commit.files) {
        const existing = fileMap.get(file.path);
        if (existing) {
          // Update status if needed
          if (existing.status === 'untracked' && file.status !== 'untracked') {
            existing.status = file.status;
          }
        } else {
          fileMap.set(file.path, {
            ...file,
            linesAdded: 0,
            linesDeleted: 0,
          });
        }
      }
    }
  }

  const files = Array.from(fileMap.values());
  const totalLinesAdded = files.reduce((sum, f) => sum + f.linesAdded, 0);
  const totalLinesDeleted = files.reduce((sum, f) => sum + f.linesDeleted, 0);

  // Extract unique bead IDs
  const beads = new Set<string>(beadIds);
  for (const event of events) {
    if (event.bead) {
      beads.add(event.bead);
    }
  }

  // Generate title and description
  const title = generatePRTitle(commitEvents);
  const description = generatePRDescription(commitEvents, files, Array.from(beads));
  const commitMessage = generateCommitMessage(
    commitEvents,
    files,
    beads.size > 0 ? Array.from(beads)[0] : undefined
  );

  // Generate mock upstream commits (in real implementation, these would come from git fetch)
  const upstreamCommits: UpstreamCommit[] = [];
  const behind = currentStatus?.behind || 0;

  // Detect conflicts
  const conflicts = detectPotentialConflicts(
    files,
    upstreamCommits,
    currentStatus?.ahead || 0,
    behind
  );

  return {
    title,
    description,
    commitMessage,
    files,
    totalLinesAdded,
    totalLinesDeleted,
    filesChanged: files.length,
    conflicts,
    sourceBranch: currentStatus?.branch || 'unknown',
    targetBranch,
    ahead: currentStatus?.ahead || 0,
    behind,
    hasUncommittedChanges: files.length > 0,
    generatedAt: Date.now(),
  };
}

/**
 * Format a PR preview for display
 */
export function formatPRPreview(preview: PRPreview): string {
  const lines: string[] = [];

  // Title section
  lines.push('{bold}PR Title:{/}');
  lines.push(`  ${preview.title}`);
  lines.push('');

  // Commit message preview
  lines.push('{bold}Commit Message Preview:{/}');
  const commitLines = preview.commitMessage.split('\n');
  for (const line of commitLines.slice(0, 5)) {
    lines.push(`  {gray-fg}${line}{/}`);
  }
  if (commitLines.length > 5) {
    lines.push(`  {gray-fg}...{/}`);
  }
  lines.push('');

  // Stats
  lines.push('{bold}Stats:{/}');
  lines.push(`  {green-fg}+${preview.totalLinesAdded}{/} {red-fg}-${preview.totalLinesDeleted}{/} in ${preview.filesChanged} file${preview.filesChanged !== 1 ? 's' : ''}`);
  lines.push(`  ${preview.ahead} commit${preview.ahead !== 1 ? 's' : ''} ahead of ${preview.targetBranch}`);
  lines.push('');

  // Conflict detection
  if (preview.conflicts.hasUpstreamCommits || preview.conflicts.rebaseRecommended) {
    lines.push('{bold}{yellow-fg}Potential Conflicts:{/}');
    if (preview.conflicts.rebaseRecommended) {
      lines.push(`  {yellow-fg}⚠ ${preview.conflicts.rebaseReason}{/}`);
    }
    if (preview.conflicts.conflictingFiles.length > 0) {
      lines.push('  Files that may conflict:');
      for (const file of preview.conflicts.conflictingFiles.slice(0, 3)) {
        lines.push(`    {red-fg}• ${file}{/}`);
      }
      if (preview.conflicts.conflictingFiles.length > 3) {
        lines.push(`    {gray-fg}... and ${preview.conflicts.conflictingFiles.length - 3} more{/}`);
      }
    }
    if (preview.conflicts.rebaseRecommended) {
      lines.push('  {cyan-fg}Recommendation: rebase before merging{/}');
    }
    lines.push('');
  }

  // Files section
  if (preview.files.length > 0) {
    lines.push('{bold}Files Changed:{/}');
    const displayFiles = preview.files.slice(0, 8);
    for (const file of displayFiles) {
      const statusIcon = getStatusIcon(file.status);
      const diff = file.status !== 'deleted'
        ? ` {green-fg}+${file.linesAdded}{/}/{red-fg}-${file.linesDeleted}{/}`
        : '';
      lines.push(`  ${statusIcon} ${file.path}${diff}`);
    }
    if (preview.files.length > 8) {
      lines.push(`  {gray-fg}... and ${preview.files.length - 8} more files{/}`);
    }
  }

  return lines.join('\n');
}

/**
 * Get status icon for file
 */
function getStatusIcon(status: string): string {
  switch (status) {
    case 'added': return '{green-fg}+{/}';
    case 'modified': return '{yellow-fg}M{/}';
    case 'deleted': return '{red-fg}-{/}';
    case 'renamed': return '{cyan-fg}R{/}';
    case 'copied': return '{cyan-fg}C{/}';
    case 'untracked': return '{gray-fg}?{/}';
    case 'unmerged': return '{red-fg}U{/}';
    default: return '{white-fg}•{/}';
  }
}

export default {
  generatePRTitle,
  generatePRDescription,
  generateCommitMessage,
  detectPotentialConflicts,
  generatePRPreview,
  formatPRPreview,
};
