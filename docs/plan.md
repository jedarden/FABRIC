# FABRIC Implementation Plan

**Flow Analysis & Bead Reporting Interface Console**

## Overview

FABRIC will provide visualization and analytics for NEEDLE's bead orchestration system. This document outlines the implementation roadmap.

## Goals

1. **Real-time Monitoring**: Live dashboard showing active bead processing
2. **Historical Analysis**: Query and visualize past workflow executions
3. **Performance Metrics**: Identify bottlenecks and optimization opportunities
4. **Debugging Support**: Trace individual bead lifecycles and dependencies

## Data Sources

FABRIC will consume data from:

### Primary Sources
- **Bead JSONL files**: Read `.beads/*.jsonl` for current state
- **Worker logs**: Parse execution logs for timing and error data
- **NEEDLE orchestration events**: Real-time event stream (if available)

### Data Model
```typescript
interface BeadRecord {
  id: string;
  type: string;
  status: 'pending' | 'active' | 'completed' | 'failed' | 'blocked';
  priority: string;
  created_at: timestamp;
  started_at?: timestamp;
  completed_at?: timestamp;
  assigned_worker?: string;
  dependencies?: string[];
  blocking?: string[];
  metadata?: Record<string, any>;
}
```

## Architecture Components

### 1. Data Ingestion Layer
- **Watcher**: Monitor `.beads/*.jsonl` for changes
- **Parser**: Extract and normalize bead records
- **Event Stream**: Convert file changes to real-time events

### 2. Processing Layer
- **State Aggregator**: Maintain current view of all beads
- **Metrics Calculator**: Compute throughput, latency, success rates
- **Dependency Resolver**: Build bead relationship graphs

### 3. Storage Layer
- **Time-series DB**: Store metrics for historical analysis (InfluxDB/TimescaleDB)
- **Graph Store**: Bead dependency relationships (in-memory or Neo4j)
- **Cache**: Fast access to current state (Redis/Valkey)

### 4. API Layer
- **REST API**: Query beads, metrics, and relationships
- **WebSocket**: Real-time updates for dashboard
- **GraphQL** (optional): Flexible querying for complex visualizations

### 5. Visualization Layer
- **Web Dashboard**: React/Vue-based UI
- **CLI Tool**: Terminal-based monitoring (`fabric status`, `fabric trace <bead-id>`)
- **Metrics Export**: Prometheus-compatible endpoint

## Key Features

### Phase 1: Foundation (MVP)
- [ ] Read and parse bead JSONL files
- [ ] Display current bead counts by status
- [ ] List active beads with basic details
- [ ] Simple CLI for querying state

### Phase 2: Visualization
- [ ] Web dashboard with real-time updates
- [ ] Bead state distribution charts (pie/bar)
- [ ] Timeline view of bead processing
- [ ] Dependency graph visualization

### Phase 3: Analytics
- [ ] Historical trend analysis
- [ ] Performance metrics (avg completion time, throughput)
- [ ] Bottleneck detection (most-blocked beads)
- [ ] Worker utilization statistics

### Phase 4: Advanced Features
- [ ] Alerting on stalled workflows
- [ ] Predictive completion estimates
- [ ] Custom dashboard widgets
- [ ] Export capabilities (CSV, JSON, reports)

## Technology Stack

### Backend Options
- **Node.js + TypeScript**: Fast development, good JSONL parsing
- **Python + FastAPI**: Rich data analysis libraries (pandas, plotly)
- **Go**: High performance, good for file watching and streaming

### Frontend Options
- **React + Recharts**: Component-based, good charting library
- **Vue + Chart.js**: Lightweight, reactive
- **Svelte + D3.js**: Minimal bundle size, powerful visualizations

### Storage
- **SQLite**: Simple, file-based, good for MVP
- **PostgreSQL + TimescaleDB**: Production-grade time-series
- **Redis/Valkey**: Caching and pub/sub for real-time updates

## Deployment Model

### Development
- Run locally alongside NEEDLE
- Watch local `.beads/` directory
- Serve dashboard on `localhost:3000`

### Production (Kubernetes)
- Deploy as sidecar to NEEDLE workers
- Aggregate data from multiple workers
- Expose dashboard via Ingress
- Store metrics in centralized DB

## Success Metrics

FABRIC will be successful if it:
1. **Reduces debugging time**: Find problematic beads in <30 seconds
2. **Improves visibility**: All stakeholders can see workflow status
3. **Enables optimization**: Identify and fix bottlenecks based on data
4. **Scales efficiently**: Handle 1000+ beads without performance degradation

## Next Steps

1. **Prototype CLI tool**: Validate JSONL parsing and basic queries
2. **Design data schema**: Finalize storage format for metrics
3. **Build API**: Implement core endpoints for querying state
4. **Create dashboard mockups**: Define UX before implementation
5. **Implement MVP**: Phase 1 features with simple web UI

## Open Questions

- Should FABRIC store historical data indefinitely or have retention policies?
- How should we handle multi-workspace scenarios (multiple NEEDLE instances)?
- What's the desired latency for real-time updates (1s, 5s, 10s)?
- Should FABRIC be read-only or allow workflow control (pause, retry, cancel)?

---

**Status**: Planning phase
**Last Updated**: 2026-03-02
