# FABRIC Report and Live Stream API

This document defines the read-only HTTP contracts for report export and
browser-friendly live updates. All routes are `GET`, so they are open under
the policy in [`api-auth.md`](api-auth.md).

## `GET /api/report`

Returns a deterministic report generated from the current in-memory event
store. It does not write a file, mutate the store, call an external provider,
or change the memory baseline.

### Query parameters

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `format` | `json` or `markdown` | `json` | Selects the response representation |
| `startTime` | finite number | — | Include events at or after this epoch-millisecond timestamp |
| `endTime` | finite number | — | Include events at or before this epoch-millisecond timestamp |
| `workers` | comma-separated string | — | Include only the named workers |
| `includeErrors` | `true` or `false` | `true` | Include error details in the report |
| `includeCost` | `true` or `false` | `true` | Include cost details in the report |
| `maxFiles` | non-negative integer | `50` | Maximum files in the report |
| `maxErrors` | non-negative integer | `20` | Maximum errors in the report |

With `format=json`, the response is the `SessionDigest` JSON object described
by `src/types.ts`. With `format=markdown`, the response is `text/markdown`
containing the same digest rendered by `formatDigestAsMarkdown`.
The JSON shape always includes `cost`; when `includeCost=false`, its numeric
fields are zero and the Markdown representation omits the cost section.

Invalid query values return `400`:

```json
{
  "error": "Invalid report query",
  "message": "format must be \"json\" or \"markdown\""
}
```

`GET /api/digest` remains a compatibility alias for the same contract.

## `GET /api/events/stream`

Opens a Server-Sent Events (SSE) stream. The endpoint sends one bounded
`init` snapshot immediately, followed by live frames until the client closes
the connection. SSE does not replay events by `Last-Event-ID`; reconnecting
clients receive a fresh snapshot.

### Query parameters

| Parameter | Type | Meaning |
|---|---|---|
| `worker` | string | Send only events for this worker |
| `level` | `debug`, `info`, `warn`, or `error` | Send only events at this level |

The response has `Content-Type: text/event-stream`, disables intermediary
buffering, and sends a `: keep-alive` comment every 15 seconds while a client
is connected.

`level` must be one of `debug`, `info`, `warn`, or `error`, and `worker` must
be a single string value. Invalid values return `400` with a JSON error before
the stream is opened.

### Frames

The initial frame is:

```text
event: init
data: {"workers":[],"recentEvents":[],"collisions":[]}

```

Opening the stream reads the current collision snapshot without retiring stale
records or changing worker flags; it remains read-only.

Subsequent frames use these event names:

| Event | Data | ID |
|---|---|---|
| `event` | one normalized `LogEvent` | monotonically increasing per server process |
| `collision` | `{ "collisions": [...], "workers": [...] }` | omitted |
| `memory` | `{ "workers": [...] }` | omitted |

The `event` frame is filtered by `worker` and `level`; `init.recentEvents` is
filtered the same way and capped at 50 events. The existing WebSocket stream
remains available for clients that need its JSON envelope or bidirectional
transport.

## Verification ownership

The endpoint behavior is pinned by
`src/web/reportSse.contract.test.ts`, while the global open-GET and
auth-side-effect sweep in `src/web/server.getRoutes.test.ts` covers the route
inventory automatically.
