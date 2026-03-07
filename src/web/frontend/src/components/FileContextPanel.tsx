import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { LogEvent } from '../types';

interface FileContextPanelProps {
  visible: boolean;
  onClose: () => void;
  events: LogEvent[];
  onOpenInEditor?: (path: string, line?: number) => void;
}

interface FileOperation {
  event: LogEvent;
  type: 'read' | 'edit' | 'write' | 'glob' | 'other';
  ts: number;
  worker: string;
}

interface FileContext {
  path: string;
  content?: string;
  operations: FileOperation[];
  highlightedLine?: number;
  lastModifiedBy?: string;
  lastModifiedAt?: number;
}

// File extension to language map
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  css: 'css',
  scss: 'css',
  sass: 'css',
  html: 'html',
  htm: 'html',
  json: 'json',
  jsonl: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  markdown: 'markdown',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  sql: 'sql',
  toml: 'toml',
};

// Keywords for basic syntax highlighting
const KEYWORDS: Record<string, string[]> = {
  typescript: ['import', 'export', 'from', 'const', 'let', 'var', 'function', 'class', 'interface', 'type', 'enum', 'async', 'await', 'return', 'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'new', 'this', 'super', 'extends', 'implements', 'private', 'public', 'protected', 'readonly', 'static', 'abstract', 'as', 'typeof', 'instanceof', 'in', 'of', 'null', 'undefined', 'true', 'false'],
  javascript: ['import', 'export', 'from', 'const', 'let', 'var', 'function', 'class', 'async', 'await', 'return', 'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'new', 'this', 'super', 'extends', 'typeof', 'instanceof', 'in', 'of', 'null', 'undefined', 'true', 'false'],
  python: ['import', 'from', 'def', 'class', 'async', 'await', 'return', 'if', 'elif', 'else', 'for', 'while', 'try', 'except', 'finally', 'raise', 'with', 'as', 'lambda', 'yield', 'global', 'nonlocal', 'pass', 'break', 'continue', 'True', 'False', 'None', 'and', 'or', 'not', 'in', 'is'],
  rust: ['fn', 'let', 'mut', 'const', 'static', 'pub', 'mod', 'use', 'crate', 'self', 'super', 'struct', 'enum', 'impl', 'trait', 'type', 'where', 'for', 'loop', 'while', 'if', 'else', 'match', 'return', 'async', 'await', 'move', 'ref', 'Some', 'None', 'Ok', 'Err', 'true', 'false'],
  go: ['package', 'import', 'func', 'var', 'const', 'type', 'struct', 'interface', 'map', 'chan', 'go', 'defer', 'return', 'if', 'else', 'for', 'range', 'switch', 'case', 'default', 'break', 'continue', 'goto', 'fallthrough', 'select', 'true', 'false', 'nil', 'error'],
  shell: ['if', 'then', 'else', 'elif', 'fi', 'for', 'do', 'done', 'while', 'until', 'case', 'esac', 'function', 'return', 'exit', 'export', 'source', 'alias', 'unset', 'readonly', 'local', 'declare', 'echo', 'printf', 'read', 'test', 'true', 'false'],
};

const FileContextPanel: React.FC<FileContextPanelProps> = ({
  visible,
  onClose,
  events,
  onOpenInEditor,
}) => {
  const [width, setWidth] = useState(40); // percentage
  const [isResizing, setIsResizing] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [recentFiles, setRecentFiles] = useState<FileContext[]>([]);
  const [isPoppedOut, setIsPoppedOut] = useState(false);
  const [popOutWindow, setPopOutWindow] = useState<Window | null>(null);

  // Extract file operations from events
  const fileEvents = useMemo(() => {
    return events.filter(e => {
      // Check if event has path info (either in message or via tool context)
      const hasPath = e.message.includes('/') || e.message.includes('.ts') || e.message.includes('.tsx') ||
        e.message.includes('.js') || e.message.includes('.py') || e.message.includes('.rs');
      return hasPath;
    });
  }, [events]);

  // Get operation type from event
  const getOperationType = useCallback((event: LogEvent): FileOperation['type'] => {
    const tool = event.tool?.toLowerCase() || '';
    const msg = event.message.toLowerCase();

    if (tool === 'read') return 'read';
    if (['edit', 'notebookedit'].includes(tool)) return 'edit';
    if (tool === 'write') return 'write';
    if (tool === 'glob') return 'glob';

    if (msg.includes('reading') || msg.includes('read file')) return 'read';
    if (msg.includes('editing') || msg.includes('modified')) return 'edit';
    if (msg.includes('writing') || msg.includes('wrote')) return 'write';
    if (msg.includes('glob')) return 'glob';

    return 'other';
  }, []);

  // Extract file path from event
  const extractPath = useCallback((event: LogEvent): string | null => {
    // Try to extract path from message
    const pathMatch = event.message.match(/(?:Read|Edit|Write|Glob|File|file)\s+([^\s]+\.[a-zA-Z]+)/);
    if (pathMatch) return pathMatch[1];

    // Look for quoted paths
    const quotedPath = event.message.match(/["']([^"']+\.[a-zA-Z]+)["']/);
    if (quotedPath) return quotedPath[1];

    return null;
  }, []);

  // Build file contexts from events
  useEffect(() => {
    const fileContexts = new Map<string, FileContext>();

    for (const event of [...fileEvents].reverse()) {
      const path = extractPath(event);
      if (!path) continue;

      const operation: FileOperation = {
        event,
        type: getOperationType(event),
        ts: new Date(event.timestamp).getTime(),
        worker: event.worker,
      };

      if (fileContexts.has(path)) {
        const ctx = fileContexts.get(path)!;
        ctx.operations.unshift(operation);
        ctx.lastModifiedAt = operation.ts;
        ctx.lastModifiedBy = operation.worker;
      } else {
        fileContexts.set(path, {
          path,
          operations: [operation],
          lastModifiedAt: operation.ts,
          lastModifiedBy: operation.worker,
        });
      }
    }

    const files = Array.from(fileContexts.values());
    setRecentFiles(files.slice(0, 10));

    if (files.length > 0 && !selectedFile) {
      setSelectedFile(files[0].path);
    }
  }, [fileEvents, extractPath, getOperationType, selectedFile]);

  // Get current file context
  const currentContext = useMemo(() => {
    return recentFiles.find(f => f.path === selectedFile) || null;
  }, [recentFiles, selectedFile]);

  // Get language from file extension
  const getLanguage = useCallback((path: string): string => {
    const ext = path.split('.').pop()?.toLowerCase() || '';
    return EXTENSION_TO_LANGUAGE[ext] || 'text';
  }, []);

  // Get operation icon
  const getOperationIcon = useCallback((type: FileOperation['type']): string => {
    switch (type) {
      case 'read': return '📖';
      case 'edit': return '✏️';
      case 'write': return '📝';
      case 'glob': return '🔍';
      default: return '📄';
    }
  }, []);

  // Format time
  const formatTime = useCallback((ts: number): string => {
    return new Date(ts).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }, []);

  // Handle resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = 100 - (e.clientX / window.innerWidth) * 100;
      setWidth(Math.max(20, Math.min(80, newWidth)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // Handle pop out
  const handlePopOut = useCallback(() => {
    if (isPoppedOut && popOutWindow) {
      popOutWindow.close();
      setIsPoppedOut(false);
      setPopOutWindow(null);
    } else {
      const newWindow = window.open(
        '',
        '_blank',
        'width=800,height=600,left=100,top=100'
      );
      if (newWindow) {
        setIsPoppedOut(true);
        setPopOutWindow(newWindow);

        // Write content to new window
        newWindow.document.write(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>File Context - ${currentContext?.path || 'No file'}</title>
            <style>
              body {
                font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
                background: #1e1e1e;
                color: #d4d4d4;
                margin: 0;
                padding: 20px;
              }
              .file-header {
                margin-bottom: 20px;
              }
              .file-path {
                color: #4fc1ff;
                font-size: 18px;
              }
              .file-info {
                color: #6a9955;
                font-size: 12px;
                margin-top: 5px;
              }
              .file-content {
                background: #252526;
                border-radius: 4px;
                padding: 15px;
              }
              .line {
                display: flex;
                line-height: 1.5;
              }
              .line-number {
                color: #858585;
                width: 50px;
                text-align: right;
                padding-right: 15px;
                user-select: none;
              }
              .line-content {
                flex: 1;
              }
              .operations {
                margin-top: 20px;
                border-top: 1px solid #3c3c3c;
                padding-top: 15px;
              }
              .operation {
                padding: 5px 0;
                color: #9cdcfe;
              }
              .operation-time {
                color: #6a9955;
                margin-right: 10px;
              }
              .operation-worker {
                color: #ce9178;
              }
            </style>
          </head>
          <body>
            <div class="file-header">
              <div class="file-path">${currentContext?.path || 'No file selected'}</div>
              <div class="file-info">Last modified by ${currentContext?.lastModifiedBy || 'unknown'}</div>
            </div>
            <div class="file-content">
              <div style="color: #6a9955; text-align: center; padding: 40px;">
                File content preview (simulated)
              </div>
            </div>
            <div class="operations">
              <h3 style="color: #4fc1ff; margin-bottom: 10px;">Recent Operations</h3>
              ${currentContext?.operations.slice(0, 10).map(op => `
                <div class="operation">
                  <span class="operation-time">${formatTime(op.ts)}</span>
                  <span>${getOperationIcon(op.type)} ${op.type}</span>
                  <span class="operation-worker">by ${op.worker}</span>
                </div>
              `).join('') || '<div style="color: #858585;">No operations recorded</div>'}
            </div>
          </body>
          </html>
        `);
        newWindow.document.close();

        // Handle window close
        newWindow.onbeforeunload = () => {
          setIsPoppedOut(false);
          setPopOutWindow(null);
        };
      }
    }
  }, [isPoppedOut, popOutWindow, currentContext, formatTime, getOperationIcon]);

  // Handle open in editor
  const handleOpenInEditor = useCallback(() => {
    if (currentContext && onOpenInEditor) {
      onOpenInEditor(currentContext.path, currentContext.highlightedLine);
    }
  }, [currentContext, onOpenInEditor]);

  if (!visible) return null;

  return (
    <div className="file-context-panel" style={{ width: `${width}%` }}>
      {/* Resize handle */}
      <div
        className="resize-handle"
        onMouseDown={handleMouseDown}
      />

      {/* Header */}
      <div className="panel-header">
        <h3>File Context</h3>
        <div className="panel-actions">
          <button
            className="panel-btn"
            onClick={handlePopOut}
            title={isPoppedOut ? 'Close pop-out window' : 'Pop out to separate window'}
          >
            {isPoppedOut ? '📌' : '📤'}
          </button>
          <button
            className="panel-btn"
            onClick={handleOpenInEditor}
            disabled={!currentContext}
            title="Open in Editor"
          >
            🔗
          </button>
          <button
            className="panel-btn close"
            onClick={onClose}
            title="Close panel"
          >
            ✕
          </button>
        </div>
      </div>

      {/* File selector */}
      {recentFiles.length > 1 && (
        <div className="file-selector">
          <select
            value={selectedFile || ''}
            onChange={(e) => setSelectedFile(e.target.value)}
          >
            {recentFiles.map(f => (
              <option key={f.path} value={f.path}>
                {f.path.split('/').pop()}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* File info */}
      {currentContext && (
        <div className="file-info">
          <div className="file-path">{currentContext.path}</div>
          <div className="file-meta">
            <span className="language-badge">{getLanguage(currentContext.path)}</span>
            <span className="last-modified">
              Modified by <strong>{currentContext.lastModifiedBy}</strong> at {formatTime(currentContext.lastModifiedAt || 0)}
            </span>
          </div>
        </div>
      )}

      {/* File content placeholder */}
      <div className="file-content">
        {currentContext ? (
          <div className="content-placeholder">
            <div className="placeholder-message">
              📄 File content preview
            </div>
            <div className="placeholder-hint">
              Click on file events in the activity stream to see context
            </div>
            <div className="simulated-lines">
              {Array.from({ length: 10 }, (_, i) => (
                <div key={i} className="simulated-line">
                  <span className="line-num">{i + 1}</span>
                  <span className="line-text">{/* Simulated content */}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="no-file">
            <div className="no-file-icon">📂</div>
            <div className="no-file-text">No file selected</div>
            <div className="no-file-hint">
              Click on file events in the activity stream to see file context
            </div>
          </div>
        )}
      </div>

      {/* Operations history */}
      {currentContext && currentContext.operations.length > 0 && (
        <div className="operations-list">
          <div className="operations-header">
            Recent Operations ({currentContext.operations.length})
          </div>
          <div className="operations-items">
            {currentContext.operations.slice(0, 5).map((op, i) => (
              <div key={i} className="operation-item">
                <span className="op-icon">{getOperationIcon(op.type)}</span>
                <span className="op-type">{op.type}</span>
                <span className="op-worker">by {op.worker.split('-').pop()}</span>
                <span className="op-time">{formatTime(op.ts)}</span>
              </div>
            ))}
            {currentContext.operations.length > 5 && (
              <div className="more-operations">
                +{currentContext.operations.length - 5} more operations
              </div>
            )}
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="quick-actions">
        <button onClick={handleOpenInEditor} disabled={!currentContext}>
          Open in Editor
        </button>
        <button onClick={() => setSelectedFile(null)}>
          Clear Selection
        </button>
      </div>
    </div>
  );
};

export default FileContextPanel;
