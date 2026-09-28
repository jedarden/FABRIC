import { test, expect } from '@playwright/test';

/**
 * Agentation mount verification in a real browser (repository UI policy).
 *
 * Every web entry point must load the Agentation toolbar with
 * `#agentation-root` mounted in the DOM after load — checked by mounting,
 * never by grepping for a script tag: the toolbar's module graph can fail
 * silently while the page renders perfectly, so only the mounted root is
 * evidence. FABRIC mounts <Agentation /> inside the React app shell
 * (src/web/frontend/src/App.tsx) and the SPA fallback serves the same
 * document for every route, so the browser-level check runs at `/`; the
 * artifact-level check that covers every shipped HTML entry point lives in
 * scripts/smoke-clean-install.sh, and the jsdom-level proof in
 * src/web/frontend/src/__agentation-mount-check.test.tsx.
 */
const BASE_URL = 'http://localhost:3000';

test.describe('Agentation mount', () => {
  test('web entry point mounts the Agentation toolbar root', async ({ page }) => {
    await page.goto(BASE_URL);
    const root = page.locator('#agentation-root, [data-agentation-root]').first();
    await root.waitFor({ state: 'attached', timeout: 15_000 });
    await expect(root).toBeAttached();
  });
});
