import React, { useState, useEffect, useCallback } from 'react';
import {
  GitStatusResponse,
  GitStatusEvent,
  GitCommitEvent,
  GitFileChange,
  PRFileChange,
  PRPreview,
  GitViewMode,
} from '../types';

interface GitIntegrationPanelProps {
  visible: boolean;
  onClose: () => void;
}

const MAX_FILES = 12;
const MAX_COMMITS = 8;

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return `${seconds}s ago`;
}

function getFileStatusInfo(status: string): { icon: string; className: string } {
  switch (status) {
    case 'added':     return { icon: '+', className: 'git-status-added' };
    case 'modified':  return { icon: 'M', className: 'git-status-modified' };
    case 'deleted':   return { icon: '-', className: 'git-status-deleted' };
    case 'renamed':   return { icon: 'R', className: 'git-status-renamed' };
    case 'copied':    return { icon: 'C', className: 'git-status-renamed' };
    case 'untracked': return { icon: '?', className: 'git-status-untracked' };
    case 'unmerged':  return { icon: 'U', className: 'git-status-conflict' };
    default:          return { icon: '·', className: 'git-status-untracked' };
  }
}

function truncatePath(path: string, max = 48): string {
  if (path.length <= max) return path;
  return '...' + path.slice(-(max - 3));
}

// ─── Sub-components ──────────────────────────────────────────────

interface FileRowProps {
  file: GitFileChange | PRFileChange;
  workers?: string[];
}

const FileRow: React.FC<FileRowProps> = ({ file, workers }) => {
  const { icon, className } = getFileStatusInfo(file.status);
  const prFile = file as PRFileChange;
  const hasLineCounts = prFile.linesAdded !== undefined || prFile.linesDeleted !== undefined;

  return (
    <div className="git-file-row">
      <span className={`git-file-icon ${className}`}>{icon}</span>
      <span className="git-file-path" title={file.path}>{truncatePath(file.path)}</span>
      {file.originalPath && (
        <span className="git-file-origin">(from {truncatePath(file.originalPath, 30)})</span>
      )}
      {hasLineCounts && (prFile.linesAdded > 0 || prFile.linesDeleted > 0) && (
        <span className="git-file-diff">
          <span className="git-diff-added">+{prFile.linesAdded}</span>
          <span className="git-diff-sep">/</span>
          <span className="git-diff-deleted">-{prFile.linesDeleted}</span>
        </span>
      )}
      {workers && workers.length > 0 && (
        <span className="git-file-workers" title={workers.join(', ')}>
          {workers.slice(0, 2).map(w => w.slice(0, 6)).join(', ')}
          {workers.length > 2 && ` +${workers.length - 2}`}
        </span>
      )}
    </div>
  );
};

interface StatusViewProps {
  data: GitStatusResponse;
}

const StatusView: React.FC<StatusViewProps> = ({ data }) => {
  const status = data.status as GitStatusEvent | null;

  if (!status) {
    return <div className="git-empty">No git status available. Git events appear when NEEDLE workers run git commands.</div>;
  }

  const staged = status.staged.slice(0, MAX_FILES);
  const unstaged = status.unstaged.slice(0, MAX_FILES);
  const untracked = status.untracked.slice(0, MAX_FILES);
  const totalStaged = status.staged.length;
  const totalUnstaged = status.unstaged.length;
  const totalUntracked = status.untracked.length;
  const isClean = totalStaged === 0 && totalUnstaged === 0 && totalUntracked === 0;

  return (
    <div className="git-status-view">
      {/* Branch info */}
      <div className={`git-branch-row ${data.hasConflicts ? 'git-branch-conflict' : ''}`}>
        <span className="git-branch-label">Branch</span>
        <span className={`git-branch-name ${data.hasConflicts ? 'git-conflict-text' : ''}`}>
          {status.branch}
        </span>
        {data.hasConflicts && <span className="git-conflict-badge">! CONFLICTS</span>}
        {status.commit && (
          <span className="git-commit-hash">{status.commit.slice(0, 7)}</span>
        )}
      </div>

      {status.tracking && (
        <div className="git-tracking-row">
          <span className="git-tracking-label">Tracking</span>
          <span className="git-tracking-name">{status.tracking}</span>
          {(status.ahead ?? 0) > 0 && (
            <span className="git-ahead">↑{status.ahead}</span>
          )}
          {(status.behind ?? 0) > 0 && (
            <span className="git-behind">↓{status.behind}</span>
          )}
        </div>
      )}

      <div className="git-updated-row">
        Updated {formatRelativeTime(status.ts)}
      </div>

      {/* Summary */}
      {!isClean && (
        <div className="git-changes-summary">
          <span className="git-staged-count">{totalStaged} staged</span>
          <span className="git-sep">, </span>
          <span className="git-unstaged-count">{totalUnstaged} unstaged</span>
          <span className="git-sep">, </span>
          <span className="git-untracked-count">{totalUntracked} untracked</span>
        </div>
      )}

      {/* Staged files */}
      {staged.length > 0 && (
        <div className="git-section">
          <div className="git-section-header git-section-staged">Staged</div>
          {staged.map((f, i) => (
            <FileRow key={i} file={f} workers={data.fileWorkerMap[f.path]} />
          ))}
          {totalStaged > MAX_FILES && (
            <div className="git-more">… and {totalStaged - MAX_FILES} more</div>
          )}
        </div>
      )}

      {/* Unstaged files */}
      {unstaged.length > 0 && (
        <div className="git-section">
          <div className="git-section-header git-section-unstaged">Unstaged</div>
          {unstaged.map((f, i) => (
            <FileRow key={i} file={f} workers={data.fileWorkerMap[f.path]} />
          ))}
          {totalUnstaged > MAX_FILES && (
            <div className="git-more">… and {totalUnstaged - MAX_FILES} more</div>
          )}
        </div>
      )}

      {/* Untracked files */}
      {untracked.length > 0 && (
        <div className="git-section">
          <div className="git-section-header git-section-untracked">Untracked</div>
          {untracked.map((path, i) => (
            <div key={i} className="git-file-row">
              <span className="git-file-icon git-status-untracked">?</span>
              <span className="git-file-path" title={path}>{truncatePath(path)}</span>
            </div>
          ))}
          {status.untracked.length > MAX_FILES && (
            <div className="git-more">… and {status.untracked.length - MAX_FILES} more</div>
          )}
        </div>
      )}

      {isClean && (
        <div className="git-clean">Working tree clean</div>
      )}
    </div>
  );
};

interface CommitsViewProps {
  commits: GitCommitEvent[];
}

const CommitsView: React.FC<CommitsViewProps> = ({ commits }) => {
  if (commits.length === 0) {
    return <div className="git-empty">No recent commits found in log events.</div>;
  }

  return (
    <div className="git-commits-view">
      <div className="git-section-header">Recent Commits ({commits.length})</div>
      {[...commits].reverse().slice(0, MAX_COMMITS).map((commit, i) => (
        <div key={i} className="git-commit-row">
          <span className="git-commit-hash">{commit.hash.slice(0, 7)}</span>
          <span className="git-commit-time">{formatRelativeTime(commit.ts)}</span>
          <span className="git-commit-message">
            {commit.message.split('\n')[0].slice(0, 64)}
          </span>
          {commit.author && (
            <span className="git-commit-author">{commit.author.split(' ')[0]}</span>
          )}
        </div>
      ))}
    </div>
  );
};

interface DiffViewProps {
  data: GitStatusResponse;
}

const DiffView: React.FC<DiffViewProps> = ({ data }) => {
  return (
    <div className="git-diff-view">
      <StatusView data={data} />
      <CommitsView commits={data.commits as GitCommitEvent[]} />
    </div>
  );
};

interface PRPreviewViewProps {
  preview: PRPreview;
}

const PRPreviewView: React.FC<PRPreviewViewProps> = ({ preview }) => {
  const { conflicts } = preview;
  const hasConflictWarning = conflicts.hasUpstreamCommits || conflicts.rebaseRecommended;

  return (
    <div className="git-pr-preview-view">
      <div className="git-section">
        <div className="git-section-header">PR Title</div>
        <div className="git-pr-title">{preview.title}</div>
      </div>

      <div className="git-section">
        <div className="git-section-header">Commit Message Preview</div>
        <pre className="git-commit-preview">
          {preview.commitMessage.split('\n').slice(0, 6).join('\n')}
          {preview.commitMessage.split('\n').length > 6 ? '\n…' : ''}
        </pre>
      </div>

      <div className="git-section">
        <div className="git-section-header">Stats</div>
        <div className="git-pr-stats">
          <span className="git-diff-added">+{preview.totalLinesAdded}</span>
          {' / '}
          <span className="git-diff-deleted">-{preview.totalLinesDeleted}</span>
          {' in '}
          <strong>{preview.filesChanged}</strong> file{preview.filesChanged !== 1 ? 's' : ''}
          {preview.ahead > 0 && (
            <span className="git-pr-ahead"> · {preview.ahead} commit{preview.ahead !== 1 ? 's' : ''} ahead of {preview.targetBranch}</span>
          )}
        </div>
      </div>

      {hasConflictWarning && (
        <div className="git-section git-conflict-section">
          <div className="git-section-header git-section-conflict">Potential Conflicts</div>
          {conflicts.rebaseRecommended && conflicts.rebaseReason && (
            <div className="git-conflict-warning">! {conflicts.rebaseReason}</div>
          )}
          {conflicts.conflictingFiles.length > 0 && (
            <>
              <div className="git-conflict-files-label">Files that may conflict:</div>
              {conflicts.conflictingFiles.slice(0, 4).map((f, i) => (
                <div key={i} className="git-conflict-file">• {truncatePath(f)}</div>
              ))}
              {conflicts.conflictingFiles.length > 4 && (
                <div className="git-more">… and {conflicts.conflictingFiles.length - 4} more</div>
              )}
            </>
          )}
          {conflicts.rebaseRecommended && (
            <div className="git-rebase-recommendation">Recommendation: rebase before merging</div>
          )}
        </div>
      )}

      {preview.files.length > 0 && (
        <div className="git-section">
          <div className="git-section-header">Files Changed</div>
          {preview.files.slice(0, MAX_FILES).map((f, i) => (
            <FileRow key={i} file={f} />
          ))}
          {preview.files.length > MAX_FILES && (
            <div className="git-more">… and {preview.files.length - MAX_FILES} more files</div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Main panel ──────────────────────────────────────────────────

const GitIntegrationPanel: React.FC<GitIntegrationPanelProps> = ({ visible, onClose }) => {
  const [data, setData] = useState<GitStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<GitViewMode>('status');

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/git/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch git status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [visible, fetchStatus]);

  if (!visible) return null;

  const hasConflicts = data?.hasConflicts ?? false;

  return (
    <div className="git-integration-panel">
      <div className="git-panel-header">
        <div className="git-panel-title">
          <span className="git-panel-icon">&#x2335;</span>
          Git Integration
          {hasConflicts && <span className="git-panel-conflict-badge">! CONFLICTS</span>}
        </div>
        <div className="git-panel-tabs">
          <button
            className={`git-tab ${viewMode === 'status' ? 'git-tab-active' : ''}`}
            onClick={() => setViewMode('status')}
          >
            Status
          </button>
          <button
            className={`git-tab ${viewMode === 'pr-preview' ? 'git-tab-active' : ''}`}
            onClick={() => setViewMode('pr-preview')}
          >
            PR Preview
          </button>
          <button
            className={`git-tab ${viewMode === 'diff' ? 'git-tab-active' : ''}`}
            onClick={() => setViewMode('diff')}
          >
            Diff + Commits
          </button>
        </div>
        <button className="git-panel-close" onClick={onClose}>×</button>
      </div>

      <div className="git-panel-body">
        {loading && !data && (
          <div className="git-loading">Loading git status…</div>
        )}
        {error && (
          <div className="git-error">Error: {error}</div>
        )}
        {data && !loading && (
          <>
            {viewMode === 'status' && <StatusView data={data} />}
            {viewMode === 'pr-preview' && (
              data.prPreview
                ? <PRPreviewView preview={data.prPreview} />
                : <div className="git-empty">No PR preview available — no git events detected yet.</div>
            )}
            {viewMode === 'diff' && <DiffView data={data} />}
          </>
        )}
        {data && (
          <div className="git-panel-footer">
            <span className="git-footer-events">{data.totalGitEvents} git event{data.totalGitEvents !== 1 ? 's' : ''}</span>
            <button className="git-footer-refresh" onClick={() => { setLoading(true); fetchStatus(); }}>
              Refresh
            </button>
            <span className="git-footer-updated">Updated {formatRelativeTime(data.updatedAt)}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default GitIntegrationPanel;
