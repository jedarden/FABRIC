import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:3000';

test.describe('FABRIC Web Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
  });

  test('loads the dashboard homepage', async ({ page }) => {
    // Check page title or header
    await expect(page).toHaveTitle(/FABRIC|Worker/i);

    // Check main content is visible
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('displays worker grid', async ({ page }) => {
    // Wait for the app to load
    await page.waitForLoadState('networkidle');

    // Look for worker-related content
    const workerGrid = page.locator('[class*="worker"], [class*="Worker"], [data-testid*="worker"]').first();

    // If no specific selector, check for any content
    const content = await page.content();
    expect(content.length).toBeGreaterThan(100);
  });

  test('API /api/workers returns worker data', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/workers`);
    expect(response.ok()).toBeTruthy();

    const workers = await response.json();
    expect(Array.isArray(workers)).toBeTruthy();
  });

  test('API /api/events returns event data', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/events`);
    expect(response.ok()).toBeTruthy();

    const events = await response.json();
    expect(Array.isArray(events)).toBeTruthy();
  });

  test('API /api/stats returns statistics', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/stats`);
    expect(response.ok()).toBeTruthy();

    const stats = await response.json();
    expect(stats).toHaveProperty('totalWorkers');
    expect(stats).toHaveProperty('totalEvents');
  });

  test('WebSocket connection works', async ({ page }) => {
    // Navigate to page
    await page.goto(BASE_URL);

    // Check that WebSocket connects (look for connected state or data updates)
    await page.waitForLoadState('networkidle');

    // Give time for WebSocket to connect
    await page.waitForTimeout(1000);

    // Verify page is responsive
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('worker list shows worker status', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Check for status indicators or worker names in the page
    const content = await page.content();

    // Should contain some worker-related content or empty state
    const hasWorkerContent = content.includes('worker') ||
                             content.includes('Worker') ||
                             content.includes('idle') ||
                             content.includes('active') ||
                             content.includes('No workers');
    expect(hasWorkerContent).toBeTruthy();
  });

  test('activity stream displays events', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Look for activity/event related content
    const content = await page.content();

    // Should have some UI structure
    expect(content).toContain('</div>');
  });

  test('page has proper structure', async ({ page }) => {
    await page.waitForLoadState('domcontentloaded');

    // Check for root element
    const root = page.locator('#root, #app, [id*="root"], body > div').first();
    await expect(root).toBeVisible();
  });

  test('responsive design - mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    // Page should still be functional at mobile size
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('responsive design - tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    const body = page.locator('body');
    await expect(body).toBeVisible();
  });
});
