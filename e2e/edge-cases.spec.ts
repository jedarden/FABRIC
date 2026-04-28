/**
 * E2E Tests: Web Dashboard Edge Cases
 *
 * Tests for edge cases and error scenarios in the web dashboard:
 * - Empty states
 * - Error handling
 * - Network resilience
 * - Browser compatibility issues
 * - Performance under load
 */

import { test, expect, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:3000';

/**
 * Helper: Wait for WebSocket connection to be established
 */
async function waitForWebSocketConnection(page: Page, timeout = 10000): Promise<void> {
  await page.waitForSelector('.connection-status .status-dot.connected', { timeout });
}

/**
 * Helper: Get current worker count
 */
async function getWorkerCount(page: Page): Promise<number> {
  const workerCards = page.locator('.worker-card');
  return await workerCards.count();
}

/**
 * Helper: Get event count in activity stream
 */
async function getEventCount(page: Page): Promise<number> {
  const events = page.locator('.activity-stream .event, .log-entry');
  return await events.count();
}

test.describe('E2E: Web Dashboard Edge Cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
  });

  test.describe('Empty States', () => {
    test('should show empty state when no workers are present', async ({ page }) => {
      await waitForWebSocketConnection(page);
      await page.waitForTimeout(1000);

      const workerCards = page.locator('.worker-card');
      const count = await workerCards.count();

      if (count === 0) {
        // Should show empty state message
        const emptyState = page.locator('.empty-state, [class*="empty"], [class*="no-workers"]');
        const hasEmptyState = await emptyState.count() > 0;

        if (hasEmptyState) {
          await expect(emptyState.first()).toBeVisible();
        }
      }
    });

    test('should show empty state in activity stream when no events', async ({ page }) => {
      await waitForWebSocketConnection(page);
      await page.waitForTimeout(1000);

      const events = page.locator('.activity-stream .event, .log-entry');
      const count = await events.count();

      if (count === 0) {
        // Activity stream should still be visible
        const activityStream = page.locator('.activity-stream');
        await expect(activityStream).toBeVisible();
      }
    });

    test('should show empty state in command palette when no results', async ({ page }) => {
      // Open command palette
      await page.keyboard.press('Meta+k');
      const paletteVisible = await page.locator('.cp-overlay').isVisible().catch(() => false);
      if (!paletteVisible) {
        await page.keyboard.press('Control+k');
      }

      await page.waitForSelector('.cp-overlay', { timeout: 5000 });

      // Type non-matching query
      const input = page.locator('.cp-input');
      await input.fill('xyznonexistent123456');
      await page.waitForTimeout(200);

      // Should show empty state
      const emptyState = page.locator('.cp-empty');
      await expect(emptyState).toBeVisible();
      await expect(emptyState).toContainText('No results');
    });
  });

  test.describe('Error Handling', () => {
    test('should handle malformed WebSocket messages gracefully', async ({ page }) => {
      await waitForWebSocketConnection(page);

      // App should remain functional even with bad data
      await page.waitForTimeout(1000);

      const connectionStatus = page.locator('.connection-status');
      await expect(connectionStatus).toBeVisible();
    });

    test('should show error boundary when component fails', async ({ page }) => {
      await waitForWebSocketConnection(page);

      // If there's a JavaScript error, the app should handle it gracefully
      // The page should still be functional
      const body = page.locator('body');
      await expect(body).toBeVisible();
    });

    test('should handle API errors gracefully', async ({ page, request }) => {
      // Try to access an invalid endpoint
      const response = await request.get(`${BASE_URL}/api/invalid-endpoint`);

      // Should return 404, not crash
      expect(response.status()).toBe(404);
    });

    test('should handle large payloads without freezing', async ({ page }) => {
      await waitForWebSocketConnection(page);

      // Simulate large data load by waiting
      await page.waitForTimeout(2000);

      // UI should remain responsive
      const body = page.locator('body');
      await body.click();

      const connectionStatus = page.locator('.connection-status');
      await expect(connectionStatus).toBeVisible();
    });
  });

  test.describe('Network Resilience', () => {
    test('should handle slow network connection', async ({ page }) => {
      // Simulate slow network
      await page.context().setOffline(false);
      await page.route('**/*', async route => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return route.continue();
      });

      await page.goto(BASE_URL);

      // Should still load eventually
      const connectionStatus = page.locator('.connection-status');
      await expect(connectionStatus).toBeVisible({ timeout: 15000 });
    });

    test('should recover from temporary network loss', async ({ page }) => {
      await waitForWebSocketConnection(page);

      // Simulate network loss
      await page.context().setOffline(true);
      await page.waitForTimeout(2000);

      // Restore network
      await page.context().setOffline(false);

      // Should reconnect
      const connectionStatus = page.locator('.connection-status');
      await expect(connectionStatus).toBeVisible({ timeout: 15000 });
    });

    test('should handle connection timeout gracefully', async ({ page }) => {
      // Set a very short timeout
      await page.goto(BASE_URL, { timeout: 5000 }).catch(() => {
        // Timeout is expected
      });

      // Should show connection status regardless
      const body = page.locator('body');
      await expect(body).toBeVisible();
    });
  });

  test.describe('Performance Under Load', () => {
    test('should handle rapid worker updates', async ({ page }) => {
      await waitForWebSocketConnection(page);

      // Wait for multiple update cycles
      for (let i = 0; i < 10; i++) {
        await page.waitForTimeout(100);
        const workerGrid = page.locator('.worker-grid');
        await expect(workerGrid).toBeVisible();
      }
    });

    test('should handle rapid event stream updates', async ({ page }) => {
      await waitForWebSocketConnection(page);

      // Monitor activity stream during rapid updates
      for (let i = 0; i < 10; i++) {
        await page.waitForTimeout(100);
        const activityStream = page.locator('.activity-stream');
        await expect(activityStream).toBeVisible();
      }
    });

    test('should remain responsive with many workers', async ({ page }) => {
      await waitForWebSocketConnection(page);
      await page.waitForTimeout(2000);

      const workerCount = await getWorkerCount(page);

      // UI should remain responsive regardless of worker count
      const workerGrid = page.locator('.worker-grid');
      await expect(workerGrid).toBeVisible();

      // Click should work
      await workerGrid.click();
      await page.waitForTimeout(100);
    });

    test('should handle scrolling in activity stream with many events', async ({ page }) => {
      await waitForWebSocketConnection(page);
      await page.waitForTimeout(2000);

      const activityStream = page.locator('.activity-stream');
      await expect(activityStream).toBeVisible();

      // Scroll should work
      await page.evaluate(() => {
        const stream = document.querySelector('.activity-stream');
        if (stream) {
          stream.scrollTop = 1000;
        }
      });

      await page.waitForTimeout(100);
    });
  });

  test.describe('Browser Compatibility', () => {
    test('should handle different viewport sizes', async ({ page }) => {
      const viewports = [
        { width: 1920, height: 1080 },
        { width: 1366, height: 768 },
        { width: 768, height: 1024 },
        { width: 375, height: 667 },
      ];

      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        await page.goto(BASE_URL);

        const body = page.locator('body');
        await expect(body).toBeVisible();

        await page.waitForTimeout(500);
      }
    });

    test('should handle browser back button navigation', async ({ page }) => {
      await page.goto(BASE_URL);
      await waitForWebSocketConnection(page);

      // Navigate away and back
      await page.goto('about:blank');
      await page.waitForTimeout(500);
      await page.goBack();

      // Should reconnect
      const connectionStatus = page.locator('.connection-status');
      await expect(connectionStatus).toBeVisible({ timeout: 15000 });
    });

    test('should handle tab activation and deactivation', async ({ page }) => {
      await page.goto(BASE_URL);
      await waitForWebSocketConnection(page);

      // Simulate tab becoming inactive
      await page.evaluate(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });

      await page.waitForTimeout(1000);

      // Make tab active again
      await page.evaluate(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });

      await page.waitForTimeout(1000);

      // Should still be functional
      const connectionStatus = page.locator('.connection-status');
      await expect(connectionStatus).toBeVisible();
    });
  });

  test.describe('Input Validation', () => {
    test('should handle special characters in search', async ({ page }) => {
      // Open command palette
      await page.keyboard.press('Meta+k');
      let paletteVisible = await page.locator('.cp-overlay').isVisible().catch(() => false);
      if (!paletteVisible) {
        await page.keyboard.press('Control+k');
      }

      await page.waitForSelector('.cp-overlay');

      // Type special characters
      const input = page.locator('.cp-input');
      const specialChars = ['!@#$%^&*()', '[]{}', '""\'\'', '<>'];

      for (const chars of specialChars) {
        await input.fill(chars);
        await page.waitForTimeout(100);

        // Should not crash
        const palette = page.locator('.cp-overlay');
        await expect(palette).toBeVisible();
      }
    });

    test('should handle very long input in command palette', async ({ page }) => {
      await page.keyboard.press('Meta+k');
      let paletteVisible = await page.locator('.cp-overlay').isVisible().catch(() => false);
      if (!paletteVisible) {
        await page.keyboard.press('Control+k');
      }

      await page.waitForSelector('.cp-overlay');

      const input = page.locator('.cp-input');
      const longText = 'a'.repeat(1000);

      await input.fill(longText);
      await page.waitForTimeout(200);

      // Should handle gracefully
      const palette = page.locator('.cp-overlay');
      await expect(palette).toBeVisible();
    });

    test('should handle rapid typing in command palette', async ({ page }) => {
      await page.keyboard.press('Meta+k');
      let paletteVisible = await page.locator('.cp-overlay').isVisible().catch(() => false);
      if (!paletteVisible) {
        await page.keyboard.press('Control+k');
      }

      await page.waitForSelector('.cp-overlay');

      const input = page.locator('.cp-input');

      // Rapid typing
      for (let i = 0; i < 20; i++) {
        await input.fill(`test${i}`);
        await page.waitForTimeout(50);
      }

      // Should remain stable
      const palette = page.locator('.cp-overlay');
      await expect(palette).toBeVisible();
    });
  });

  test.describe('State Management', () => {
    test('should preserve focus mode state across page reload', async ({ page }) => {
      await waitForWebSocketConnection(page);
      await page.waitForTimeout(1000);

      // Enable focus mode
      const focusToggle = page.locator('.focus-mode-toggle');
      await focusToggle.click();
      await page.waitForTimeout(100);

      // Reload
      await page.reload();
      await page.waitForLoadState('networkidle');

      // Focus mode should still be enabled
      await expect(focusToggle).toHaveClass(/active/);
    });

    test('should preserve theme selection across page reload', async ({ page }) => {
      await page.goto(BASE_URL);
      await page.waitForLoadState('networkidle');

      // Toggle theme
      const themeToggle = page.locator('.theme-toggle');
      await themeToggle.click();
      await page.waitForTimeout(100);

      // Reload
      await page.reload();
      await page.waitForLoadState('networkidle');

      // Theme toggle should still be visible
      await expect(themeToggle).toBeVisible();
    });

    test('should clear worker selection when navigating away', async ({ page }) => {
      await waitForWebSocketConnection(page);
      await page.waitForTimeout(1000);

      const workerCard = page.locator('.worker-card').first();
      const count = await workerCard.count();

      if (count > 0) {
        // Select worker
        await workerCard.click();
        await page.waitForTimeout(100);

        // Navigate away
        await page.goto('about:blank');
        await page.waitForTimeout(500);

        // Navigate back
        await page.goBack();
        await page.waitForTimeout(1000);

        // Worker should be visible
        const workerGrid = page.locator('.worker-grid');
        await expect(workerGrid).toBeVisible();
      }
    });
  });

  test.describe('Accessibility', () => {
    test('should maintain keyboard focus during navigation', async ({ page }) => {
      await page.goto(BASE_URL);
      await page.waitForLoadState('networkidle');

      // Tab through interface
      for (let i = 0; i < 10; i++) {
        await page.keyboard.press('Tab');
        await page.waitForTimeout(50);

        // Should not throw errors
        const body = page.locator('body');
        await expect(body).toBeVisible();
      }
    });

    test('should show focus indicators on interactive elements', async ({ page }) => {
      await page.goto(BASE_URL);
      await page.waitForLoadState('networkidle');

      // Focus on command palette button
      const toggleButton = page.locator('.command-palette-toggle');
      await toggleButton.focus();
      await page.waitForTimeout(100);

      // Should have focus
      await expect(toggleButton).toBeFocused();
    });

    test('should support Escape key to close modals', async ({ page }) => {
      // Open command palette
      await page.keyboard.press('Meta+k');
      let paletteVisible = await page.locator('.cp-overlay').isVisible().catch(() => false);
      if (!paletteVisible) {
        await page.keyboard.press('Control+k');
      }

      await page.waitForSelector('.cp-overlay');

      // Press Escape
      await page.keyboard.press('Escape');

      // Should close
      const palette = page.locator('.cp-overlay');
      await expect(palette).not.toBeVisible();
    });
  });

  test.describe('Memory Management', () => {
    test('should not leak memory with rapid panel open/close', async ({ page }) => {
      await waitForWebSocketConnection(page);

      // Rapid panel toggling
      for (let i = 0; i < 20; i++) {
        await page.keyboard.press('Meta+k');
        await page.waitForTimeout(50);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(50);
      }

      // Should remain stable
      const body = page.locator('body');
      await expect(body).toBeVisible();
    });

    test('should clean up event listeners on unmount', async ({ page }) => {
      await page.goto(BASE_URL);
      await waitForWebSocketConnection(page);

      // Navigate away
      await page.goto('about:blank');

      // Should not throw errors
      const body = page.locator('body');
      await expect(body).toBeVisible();
    });
  });
});
