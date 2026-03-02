# FABRIC

**Flow Analysis & Bead Reporting Interface Console**

A visualization system for surfacing NEEDLE worker activity through TUI and HTML dashboards.

## Purpose

FABRIC consumes logging and telemetry output from NEEDLE workers, transforming raw execution data into reviewable visualizations:

- **Flow Analysis**: Visualize worker execution timelines and patterns
- **Bead Reporting**: Surface what workers are doing and how they're performing
- **Interface Console**: Both TUI (terminal) and HTML dashboards for review

## Output Formats

### TUI Dashboard
Real-time terminal interface showing:
- Active worker status grid
- Live log streaming with filtering
- Worker detail views and session history
- Keyboard-driven navigation

### HTML Reports
Static and interactive browser-based views:
- Session timeline visualizations (Gantt-style)
- Metrics charts (API calls, tokens, duration)
- Searchable log explorer
- Shareable, self-contained reports

## Relationship to NEEDLE

NEEDLE orchestrates workers; FABRIC surfaces their activity:
- What is each worker currently doing?
- How long are tasks taking?
- What errors are occurring?
- What's the API/token usage?
- What does the execution timeline look like?

## Status

🚧 **In Development** - See [docs/plan.md](docs/plan.md) for implementation roadmap.

## Getting Started

_(Coming soon)_

## Documentation

- [Implementation Plan](docs/plan.md)
- [Architecture](docs/architecture.md) _(coming soon)_
- [API Reference](docs/api.md) _(coming soon)_
