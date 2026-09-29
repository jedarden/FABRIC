# Web entrypoints and Agentation

FABRIC is currently a single-page web application. Vite uses
`src/web/frontend` as its root, and the complete HTML entrypoint inventory is:

| Source entrypoint | Served path | Built artifact | React entry |
| --- | --- | --- | --- |
| `src/web/frontend/index.html` | `/` | `dist/web/public/index.html` | `src/web/frontend/src/main.tsx` |

The Express server's fallback sends this same `index.html` for client-side
dashboard paths. Those paths are views within the SPA, not additional HTML
entrypoints, so they share the same Agentation mount.

## Agentation contract

Every HTML entrypoint must:

1. Declare the React and `react-dom/client` import-map entries before its
   browser module entrypoint.
2. Render the application with an `#agentation-root` host containing the
   `Agentation` component.
3. Be included automatically by the entrypoint smoke checks. Do not replace
   the discovered inventory with a hand-maintained test list.

The current checks deliberately cover different failure modes:

- `src/web/frontend/src/__agentation-mount-check.test.tsx` renders the real
  application shell in jsdom and waits for both the host and Agentation's
  mounted portal marker.
- `e2e/agentation-mount.spec.ts` discovers every `*.html` entrypoint below the
  Vite root and verifies the mounted toolbar in a real browser. It also loads
  `/` and the representative `/workers` client-side route, checks the required
  React import map and its ordering before the module entrypoint, and asserts
  that the deep-link fallback serves the exact same document as `/`.
- `scripts/smoke-clean-install.sh` fetches every packaged HTML entrypoint and
  checks its referenced bundle for the mount marker; this is the artifact
  check used by the clean-install smoke, not a substitute for mounting.
- `src/smoke-clean-install.test.ts` keeps the smoke implementation and this
  inventory synchronized so a new HTML entrypoint cannot silently skip the
  documented coverage.

When adding an HTML entrypoint, wire it to the same Agentation-enabled app (or
provide an equivalent mount), then update the table above and run:

```bash
npx vitest run src/web/frontend/src/__agentation-mount-check.test.tsx src/smoke-clean-install.test.ts
npx playwright test e2e/agentation-mount.spec.ts
```
