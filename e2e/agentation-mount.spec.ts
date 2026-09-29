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
const REPRESENTATIVE_CLIENT_ROUTE = '/workers';

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

  test('serves the same entrypoint for the root and a client-side route', async ({ page, request }) => {
    const rootResponse = await request.get('/');
    const routeResponse = await request.get(REPRESENTATIVE_CLIENT_ROUTE);
    expect(rootResponse.status()).toBe(200);
    expect(routeResponse.status()).toBe(200);
    expect(await routeResponse.text()).toBe(await rootResponse.text());

    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await page.goto('/');
    const importMap = await page.locator('script[type="importmap"]').textContent();
    expect(importMap).not.toBeNull();
    expect(JSON.parse(importMap as string)).toMatchObject({
      imports: {
        react: 'https://esm.sh/react@19.2.4',
        'react-dom': 'https://esm.sh/react-dom@19.2.4',
        'react-dom/client': 'https://esm.sh/react-dom@19.2.4/client',
      },
    });

    const scriptOrder = await page.evaluate(() => {
      const scripts = [...document.querySelectorAll('script')];
      const importMapIndex = scripts.findIndex((script) => script.type === 'importmap');
      const moduleEntryIndex = scripts.findIndex(
        (script) => script.type === 'module' && script.src.includes('/assets/'),
      );
      return { importMapIndex, moduleEntryIndex };
    });
    expect(scriptOrder.importMapIndex).toBeGreaterThanOrEqual(0);
    expect(scriptOrder.moduleEntryIndex).toBeGreaterThan(scriptOrder.importMapIndex);

    const assertMounted = async () => {
      await expect(page.locator('#agentation-root')).toBeAttached({ timeout: 15_000 });
      await expect(page.locator('[data-agentation-root]')).toBeAttached({ timeout: 15_000 });
    };
    await assertMounted();

    await page.goto(REPRESENTATIVE_CLIENT_ROUTE);
    await assertMounted();
    expect(page.url()).toContain(REPRESENTATIVE_CLIENT_ROUTE);
    expect(pageErrors).toEqual([]);
  });
});
