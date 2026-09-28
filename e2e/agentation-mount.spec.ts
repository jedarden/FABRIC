import { test, expect } from '@playwright/test';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Agentation mount verification in a real browser (repository UI policy).
 *
 * Every web entry point must load the Agentation toolbar with
 * `#agentation-root` mounted in the DOM after load — checked by mounting,
 * never by grepping for a script tag: the toolbar's module graph can fail
 * silently while the page renders perfectly, so only the mounted root is
 * evidence. The list below is discovered from the Vite frontend root so a
 * newly added HTML entry point automatically receives browser coverage.
 */

const frontendRoot = join(process.cwd(), 'src/web/frontend');

function htmlEntryPoints(dir: string, prefix = ''): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const relativePath = prefix ? `${prefix}/${name}` : name;
    if (statSync(path).isDirectory()) return htmlEntryPoints(path, relativePath);
    return name.endsWith('.html') ? [relativePath] : [];
  });
}

const entryPoints = htmlEntryPoints(frontendRoot).sort();

test.describe('Agentation mount', () => {
  for (const entryPoint of entryPoints) {
    const route = entryPoint === 'index.html' ? '/' : `/${entryPoint}`;

    test(`${entryPoint} mounts the Agentation toolbar root`, async ({ page }) => {
      await page.goto(route);
      const root = page.locator('#agentation-root');
      await root.waitFor({ state: 'attached', timeout: 15_000 });
      await expect(root).toBeAttached();
      await expect(page.locator('[data-agentation-root]')).toBeAttached();
    });
  }
});
