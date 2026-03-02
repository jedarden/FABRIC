# FABRIC Implementation Plan

**Flow Analysis & Bead Reporting Interface Console**

## Overview

FABRIC provides visualization of NEEDLE worker activity by consuming logging and telemetry output. It generates both TUI (terminal) and HTML visualizations for reviewing worker execution patterns, performance, and output.

## Goals

1. **Worker Visibility**: Surface what NEEDLE workers are doing in real-time
2. **Log Aggregation**: Collect and present worker logging output in digestible formats
3. **Telemetry Analysis**: Visualize performance metrics, execution timelines, and resource usage
4. **Dual Output**: Generate both TUI dashboards for terminal users and HTML reports for browser review

## Data Sources

FABRIC consumes NEEDLE's logging and telemetry output:

### Primary Sources
- **Worker stdout/stderr**: Captured execution output
- **Structured logs**: JSON-formatted log events from workers
- **Telemetry streams**: Timing, resource usage, API call metrics
- **Session transcripts**: Worker conversation/execution history

### Data Model
```typescript
interface WorkerEvent {
  worker_id: string;
  session_id: string;
  timestamp: number;
  event_type: 'log' | 'metric' | 'state_change' | 'tool_call' | 'error';
  level?: 'debug' | 'info' | 'warn' | 'error';
  message?: string;
  metadata?: Record<string, any>;
}

interface WorkerSession {
  worker_id: string;
  session_id: string;
  started_at: number;
  ended_at?: number;
  status: 'running' | 'completed' | 'failed' | 'idle';
  task_description?: string;
  events: WorkerEvent[];
  metrics: WorkerMetrics;
}

interface WorkerMetrics {
  api_calls: number;
  tool_invocations: number;
  tokens_in: number;
  tokens_out: number;
  duration_ms: number;
  errors: number;
}
```

## Architecture Components

### 1. Log Collector
- **Stream Reader**: Consume NEEDLE worker output streams
- **Log Parser**: Extract structured data from log lines
- **Event Normalizer**: Convert various log formats to unified schema

### 2. Telemetry Aggregator
- **Metrics Accumulator**: Track counters, gauges, histograms
- **Timeline Builder**: Construct execution timelines per worker
- **Session Tracker**: Group events by worker session

### 3. Visualization Renderers

#### TUI Renderer
- **Live Dashboard**: Real-time terminal display using blessed/ink/textual
- **Log Viewer**: Scrollable, filterable log output
- **Worker Grid**: At-a-glance status of all workers
- **Detail Pane**: Deep-dive into specific worker sessions

#### HTML Renderer
- **Static Reports**: Self-contained HTML files for sharing/archiving
- **Interactive Dashboard**: Browser-based live view
- **Timeline Visualization**: Gantt-style execution timelines
- **Log Explorer**: Searchable, syntax-highlighted log viewer

### 4. Output Formats
- **TUI**: Direct terminal rendering (ncurses/blessed style)
- **HTML**: Static files or served via local HTTP
- **JSON**: Raw data export for external tools
- **Markdown**: Summary reports for documentation

## Key Features

### Phase 1: Foundation (MVP)
- [ ] Consume NEEDLE worker log streams
- [ ] Parse structured JSON log events
- [ ] Simple TUI: list active workers with status
- [ ] Basic HTML: render session logs as static page

### Phase 2: TUI Dashboard
- [ ] Real-time worker status grid
- [ ] Live log streaming with filtering
- [ ] Worker detail view (select worker, see history)
- [ ] Keyboard navigation and search

### Phase 3: HTML Visualizations
- [ ] Session timeline visualization (Gantt-style)
- [ ] Metrics charts (API calls, tokens, duration)
- [ ] Searchable log explorer with syntax highlighting
- [ ] Export/share capabilities

### Phase 4: Advanced Analytics
- [ ] Cross-session analysis (patterns, trends)
- [ ] Error clustering and root cause hints
- [ ] Performance regression detection
- [ ] Custom dashboard layouts

## Technology Stack

### Log Processing
- **Node.js streams**: Efficient log consumption
- **pino/winston parsers**: Structured log parsing
- **RxJS**: Reactive event stream processing

### TUI Framework Options
- **blessed/blessed-contrib**: Feature-rich terminal UI (Node.js)
- **ink**: React for CLI (Node.js)
- **textual**: Modern TUI framework (Python)
- **bubbletea**: Elegant TUI framework (Go)

### HTML Generation
- **Static**: Generate self-contained HTML files with embedded CSS/JS
- **Templates**: Handlebars/EJS for report generation
- **Charts**: Chart.js, Recharts, or Plotly for visualizations
- **Timeline**: vis-timeline or custom D3.js

### Serving (Optional)
- **Local HTTP server**: Serve HTML dashboard on localhost
- **WebSocket**: Real-time updates to browser

## CLI Interface

```bash
# TUI mode - live dashboard
fabric tui

# Watch specific worker
fabric tui --worker <worker-id>

# Generate HTML report for session
fabric html --session <session-id> --output report.html

# Generate HTML report for all recent sessions
fabric html --since 1h --output dashboard.html

# Stream logs in terminal
fabric logs --follow
fabric logs --worker <worker-id> --level error

# Export raw data
fabric export --format json --output data.json
```

## Integration with NEEDLE

FABRIC reads from NEEDLE's output, requiring:

1. **Log Format Agreement**: NEEDLE outputs structured JSON logs
2. **Telemetry Events**: NEEDLE emits timing/metric events
3. **Session Boundaries**: Clear start/end markers for worker sessions

### Expected Log Format
```json
{"ts":1709337600,"worker":"w-abc123","level":"info","msg":"Starting task","task":"Process bead bd-xyz"}
{"ts":1709337601,"worker":"w-abc123","level":"debug","msg":"Tool call","tool":"Read","args":{"path":"/src/main.ts"}}
{"ts":1709337605,"worker":"w-abc123","level":"info","msg":"Task complete","duration_ms":5000}
```

## Deployment

### Development
```bash
# Run TUI alongside NEEDLE
fabric tui --source ~/.needle/logs/

# Generate HTML report
fabric html --source ~/.needle/logs/ --output ./reports/
```

### Production
- Sidecar container reading NEEDLE worker logs
- Periodic HTML report generation to shared storage
- Optional: hosted dashboard with real-time WebSocket updates

## Success Metrics

1. **Immediate insight**: See worker status within 1 second of running `fabric tui`
2. **Log accessibility**: Find relevant log entries in <10 seconds
3. **Shareable reports**: Generate HTML that works offline, no dependencies
4. **Low overhead**: <5% CPU impact when monitoring NEEDLE workers

## Next Steps

1. **Define log format contract**: Specify what NEEDLE must output
2. **Prototype TUI**: Basic worker list with status
3. **Prototype HTML**: Static page from sample logs
4. **Integrate with NEEDLE**: Connect to actual worker output
5. **Iterate on UX**: Refine based on real usage

## Open Questions

- Where does NEEDLE write logs? (stdout, files, both?)
- What telemetry does NEEDLE currently emit?
- Should FABRIC support multiple NEEDLE instances?
- Retention: how much history should FABRIC keep accessible?

---

**Status**: Planning phase
**Last Updated**: 2026-03-02
