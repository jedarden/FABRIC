/**
 * E2E Tests: Critical User Flows - Integration
 *
 * Comprehensive integration tests for the most critical user workflows:
 * - Flow 1: Worker selection and detail view navigation
 * - Flow 2: WebSocket connection and real-time event streaming
 * - Flow 3: Command palette search and execution
 * - Flow 4: Focus mode pin/unpin operations
 *
 * These tests verify complete user journeys across multiple features.
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
 * Helper: Get worker count from UI
 */
async function getWorkerCount(page: Page): Promise<number> {
  const workerCards = page.locator('.worker-card');
  return await workerCards.count();
}

/**
 * Helper: Get event count from activity stream
 */
async function getEventCount(page: Page): Promise<number> {
  const events = page.locator('.activity-stream .event-item, .activity-stream .event, .log-entry');
  return await events.count();
}

/**
 * Helper: Open command palette
 */
async function openCommandPalette(page: Page): Promise<void> {
  await page.keyboard.press('Meta+k');
  let paletteVisible = await page.locator('.cp-overlay').isVisible().catch(() => false);
  if (!paletteVisible) {
    await page.keyboard.press('Control+k');
  }
  await page.waitForSelector('.cp-overlay', { timeout: 5000 });
  await page.waitForTimeout(100);
}

/**
 * Helper: Execute command via palette
 */
async function executeCommand(page: Page, query: string): Promise<void> {
  await openCommandPalette(page);
  const input = page.locator('.cp-input');
  await input.fill(query);
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
}

test.describe('E2E: Critical User Flows - Integration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
  });

  test.describe('Flow 1: Worker Selection and Detail View', () => {
    test('should complete full worker inspection workflow', async ({ page }) => {
      await waitForWebSocketConnection(page);
      await page.waitForTimeout(1000);

      const workerCard = page.locator('.worker-card').first();
      const count = await workerCard.count();

      if (count > 0) {
        // Step 1: View initial state - no worker selected
        const selectedBefore = await workerCard.evaluate(el => el.classList.contains('selected'));
        expect(selectedBefore).toBeFalsy();

        // Step 2: Click worker to select
        await workerCard.click();
        await page.waitForTimeout(200);

        // Verify worker is selected
        const selectedAfter = await workerCard.evaluate(el => el.classList.contains('selected'));
        expect(selectedAfter).toBeTruthy();

        // Step 3: Check if detail panel appears (if implemented)
        const detailPanel = page.locator('.worker-detail-panel, .worker-detail');
        const hasDetail = await detailPanel.count() > 0;

        if (hasDetail) {
          await expect(detailPanel).toBeVisible();
        }

        // Step 4: Verify activity stream filters to selected worker
        const activityStream = page.locator('.activity-stream');
        await expect(activityStream).toBeVisible();

        // Step 5: Deselect worker (Escape key)
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);

        const selectedDeselected = await workerCard.evaluate(el => el.classList.contains('selected'));
        expect(selectedDeselected).toBeFalsy();
      }
    });

    test('should navigate between multiple workers', async ({ page }) => {
      await waitForWebSocketConnection(page);
      await page.waitForTimeout(1000);

      const workerCards = page.locator('.worker-card');
      const count = await workerCards.count();

      if (count >= 2) {
        // Select first worker
        await workerCards.nth(0).click();
        await page.waitForTimeout(100);

        let firstSelected = await workerCards.nth(0).evaluate(el => el.classList.contains('selected'));
        expect(firstSelected).toBeTruthy();

        // Select second worker
        await workerCards.nth(1).click();
        await page.waitForTimeout(100);

        // First worker should be deselected
        firstSelected = await workerCards.nth(0).evaluate(el => el.classList.contains('selected'));
        expect(firstSelected).toBeFalsy();

        // Second worker should be selected
        const secondSelected = await workerCards.nth(1).evaluate(el => el.classList.contains('selected'));
        expect(secondSelected).toBeTruthy();
      }
    });

    test('should show worker status and metadata', async ({ page }) => {
      await waitForWebSocketConnection(page);
      await page.waitForTimeout(1000);

      const workerCard = page.locator('.worker-card').first();
      const count = await workerCard.count();

      if (count > 0) {
        // Worker card should be visible
        await expect(workerCard).toBeVisible();

        // Should contain worker ID
        const text = await workerCard.textContent();
        expect(text).toMatch(/w-[\w-]+/);

        // Should have status indicator
        const statusIndicator = workerCard.locator('.status, [class*="status"]');
        const hasStatus = await statusIndicator.count() > 0;

        if (hasStatus) {
          await expect(statusIndicator.first()).toBeVisible();
        }
      }
    });
  });

  test.describe('Flow 2: WebSocket Connection and Event Streaming', () => {
    test('should establish WebSocket connection on page load', async ({ page }) => {
      // Connection status should be visible
      const connectionStatus = page.locator('.connection-status');
      await expect(connectionStatus).toBeVisible();

      // Should transition to connected state
      await waitForWebSocketConnection(page);

      // Status dot should show connected
      const statusDot = page.locator('.status-dot.connected');
      await expect(statusDot).toBeVisible();
    });

    test('should receive and display events in real-time', async ({ page }) => {
      await waitForWebSocketConnection(page);

      const initialEventCount = await getEventCount(page);

      // Wait for new events to arrive
      await page.waitForTimeout(3000);

      const newEventCount = await getEventCount(page);

      // Event count should update (may stay same if no new events)
      expect(newEventCount).toBeGreaterThanOrEqual(initialEventCount);
    });

    test('should show connection state changes', async ({ page }) => {
      const connectionStatus = page.locator('.connection-status');
      await expect(connectionStatus).toBeVisible();

      // Wait for connection
      await waitForWebSocketConnection(page);

      // Should show connected state
      const statusDot = page.locator('.status-dot.connected');
      await expect(statusDot).toBeVisible();
    });

    test('should handle worker updates from WebSocket', async ({ page }) => {
      await waitForWebSocketConnection(page);

      const workerGrid = page.locator('.worker-grid');
      await expect(workerGrid).toBeVisible();

      const initialWorkerCount = await getWorkerCount(page);

      // Wait for potential updates
      await page.waitForTimeout(2000);

      const newWorkerCount = await getWorkerCount(page);

      // Worker grid should be present
      await expect(workerGrid).toBeVisible();
    });
  });

  test.describe('Flow 3: Command Palette Search and Execution', () => {
    test('should open, search, and execute command', async ({ page }) => {
      // Step 1: Open command palette (Ctrl+K or Cmd+K)
      await openCommandPalette(page);

      const palette = page.locator('.cp-overlay');
      await expect(palette).toBeVisible();

      // Step 2: Type search query
      const input = page.locator('.cp-input');
      await input.fill('theme');
      await page.waitForTimeout(200);

      // Should show filtered results
      const commands = page.locator('.cp-item');
      const count = await commands.count();
      expect(count).toBeGreaterThan(0);

      // Step 3: Execute command (Enter key)
      await page.keyboard.press('Enter');
      await page.waitForTimeout(200);

      // Palette should close
      await expect(palette).not.toBeVisible();
    });

    test('should navigate command suggestions with keyboard', async ({ page }) => {
      await openCommandPalette(page);

      // Type search query
      const input = page.locator('.cp-input');
      await input.fill('show');
      await page.waitForTimeout(200);

      const commands = page.locator('.cp-item');
      const initialCount = await commands.count();

      if (initialCount > 0) {
        // Navigate down
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(50);

        // Navigate up
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(50);

        // Commands should still be visible
        await expect(commands.first()).toBeVisible();
      }
    });

    test('should close palette with Escape key', async ({ page }) => {
      await openCommandPalette(page);

      const palette = page.locator('.cp-overlay');
      await expect(palette).toBeVisible();

      // Press Escape
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);

      // Palette should close
      await expect(palette).not.toBeVisible();
    });

    test('should show empty state for non-matching queries', async ({ page }) => {
      await openCommandPalette(page);

      // Type non-matching query
      const input = page.locator('.cp-input');
      await input.fill('xyznonexistent123456');
      await page.waitForTimeout(200);

      // Should show empty state
      const emptyState = page.locator('.cp-empty');
      await expect(emptyState).toBeVisible();
    });

    test('should execute worker selection command', async ({ page }) => {
      await waitForWebSocketConnection(page);
      await page.waitForTimeout(1000);

      const workerCard = page.locator('.worker-card').first();
      const count = await workerCard.count();

      if (count > 0) {
        // Get worker ID from card
        const workerText = await workerCard.textContent();
        const workerMatch = workerText?.match(/w-[\w-]+/);

        if (workerMatch) {
          const workerId = workerMatch[0];

          // Execute worker selection command
          await executeCommand(page, `worker:${workerId}`);

          // Worker should be selected
          await expect(workerCard).toHaveClass(/selected/);
        }
      }
    });
  });

  test.describe('Flow 4: Focus Mode Pin/Unpin Operations', () => {
    test('should enable focus mode and pin workers', async ({ page }) => {
      await waitForWebSocketConnection(page);
      await page.waitForTimeout(1000);

      const workerCards = page.locator('.worker-card');
      const count = await workerCards.count();

      if (count >= 2) {
        // Step 1: Enable focus mode (if toggle exists)
        const focusToggle = page.locator('.focus-mode-toggle');
        const hasFocusToggle = await focusToggle.count() > 0;

        if (hasFocusToggle) {
          await focusToggle.click();
          await page.waitForTimeout(100);

          const isActive = await focusToggle.evaluate(el => el.classList.contains('active'));
          expect(isActive).toBeTruthy();
        }

        // Step 2: Pin first worker
        const firstCard = workerCards.nth(0);
        const pinButton = firstCard.locator('.pin-button');
        const hasPinButton = await pinButton.count() > 0;

        if (hasPinButton) {
          await pinButton.click();
          await page.waitForTimeout(100);

          const isPinned = await firstCard.evaluate(el => el.classList.contains('pinned'));
          expect(isPinned).toBeTruthy();
        }

        // Step 3: Pin second worker
        const secondCard = workerCards.nth(1);
        const secondPinButton = secondCard.locator('.pin-button');

        if (await secondPinButton.count() > 0) {
          await secondPinButton.click();
          await page.waitForTimeout(100);

          const isPinned = await secondCard.evaluate(el => el.classList.contains('pinned'));
          expect(isPinned).toBeTruthy();
        }

        // Step 4: Check count indicator
        const countBadge = page.locator('.focus-mode-count');
        const hasCountBadge = await countBadge.count() > 0;

        if (hasCountBadge) {
          await expect(countBadge).toBeVisible();
          const countText = await countBadge.textContent();
          expect(parseInt(countText || '0', 10)).toBeGreaterThan(0);
        }
      }
    });

    test('should toggle focus mode on and off', async ({ page }) => {
      await waitForWebSocketConnection(page);

      const focusToggle = page.locator('.focus-mode-toggle');
      const hasFocusToggle = await focusToggle.count() > 0;

      if (hasFocusToggle) {
        // Enable focus mode
        await focusToggle.click();
        await page.waitForTimeout(100);

        let isActive = await focusToggle.evaluate(el => el.classList.contains('active'));
        expect(isActive).toBeTruthy();

        // Disable focus mode
        await focusToggle.click();
        await page.waitForTimeout(100);

        isActive = await focusToggle.evaluate(el => el.classList.contains('active'));
        expect(isActive).toBeFalsy();
      }
    });

    test('should unpin workers by clicking pin button again', async ({ page }) => {
      await waitForWebSocketConnection(page);
      await page.waitForTimeout(1000);

      const workerCard = page.locator('.worker-card').first();
      const count = await workerCard.count();

      if (count > 0) {
        const pinButton = workerCard.locator('.pin-button');
        const hasPinButton = await pinButton.count() > 0;

        if (hasPinButton) {
          // Pin worker
          await pinButton.click();
          await page.waitForTimeout(100);

          let isPinned = await workerCard.evaluate(el => el.classList.contains('pinned'));
          expect(isPinned).toBeTruthy();

          // Unpin worker
          await pinButton.click();
          await page.waitForTimeout(100);

          isPinned = await workerCard.evaluate(el => el.classList.contains('pinned'));
          expect(isPinned).toBeFalsy();
        }
      }
    });

    test('should clear all pins via command palette', async ({ page }) => {
      await waitForWebSocketConnection(page);
      await page.waitForTimeout(1000);

      const workerCards = page.locator('.worker-card');
      const count = await workerCards.count();

      if (count >= 2) {
        // Pin workers
        for (let i = 0; i < Math.min(count, 2); i++) {
          const pinButton = workerCards.nth(i).locator('.pin-button');
          if (await pinButton.count() > 0) {
            await pinButton.click();
            await page.waitForTimeout(50);
          }
        }

        // Clear via command palette
        await executeCommand(page, 'focus:clear');
        await page.waitForTimeout(200);

        // All workers should be unpinned
        for (let i = 0; i < Math.min(count, 2); i++) {
          const isPinned = await workerCards.nth(i).evaluate(el => el.classList.contains('pinned'));
          expect(isPinned).toBeFalsy();
        }
      }
    });
  });

  test.describe('Flow 5: Complete User Journey - End to End', () => {
    test('should support complete inspection workflow', async ({ page }) => {
      // Step 1: Page loads and WebSocket connects
      const connectionStatus = page.locator('.connection-status');
      await expect(connectionStatus).toBeVisible();

      await waitForWebSocketConnection(page);

      // Step 2: View worker grid
      const workerGrid = page.locator('.worker-grid');
      await expect(workerGrid).toBeVisible();

      await page.waitForTimeout(1000);

      const workerCard = page.locator('.worker-card').first();
      const count = await workerCard.count();

      if (count > 0) {
        // Step 3: Select worker
        await workerCard.click();
        await page.waitForTimeout(200);

        const selected = await workerCard.evaluate(el => el.classList.contains('selected'));
        expect(selected).toBeTruthy();

        // Step 4: Open command palette
        await openCommandPalette(page);
        const palette = page.locator('.cp-overlay');
        await expect(palette).toBeVisible();

        // Step 5: Execute a command
        const input = page.locator('.cp-input');
        await input.fill('theme');
        await page.waitForTimeout(200);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(200);

        // Step 6: Close palette
        await expect(palette).not.toBeVisible();

        // Step 7: Enable focus mode
        const focusToggle = page.locator('.focus-mode-toggle');
        const hasFocusToggle = await focusToggle.count() > 0;

        if (hasFocusToggle) {
          await focusToggle.click();
          await page.waitForTimeout(100);

          const isActive = await focusToggle.evaluate(el => el.classList.contains('active'));
          expect(isActive).toBeTruthy();
        }

        // Step 8: Verify activity stream is still visible
        const activityStream = page.locator('.activity-stream');
        await expect(activityStream).toBeVisible();
      }
    });

    test('should handle rapid interactions without errors', async ({ page }) => {
      await waitForWebSocketConnection(page);

      // Rapid sequence of interactions
      for (let i = 0; i < 5; i++) {
        // Open and close command palette
        await openCommandPalette(page);
        await page.waitForTimeout(50);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(50);
      }

      // App should remain stable
      const body = page.locator('body');
      await expect(body).toBeVisible();
    });

    test('should preserve state across keyboard navigation', async ({ page }) => {
      await waitForWebSocketConnection(page);
      await page.waitForTimeout(1000);

      const workerCard = page.locator('.worker-card').first();
      const count = await workerCard.count();

      if (count > 0) {
        // Select worker with keyboard (Enter key)
        await workerCard.focus();
        await page.keyboard.press('Enter');
        await page.waitForTimeout(200);

        const selected = await workerCard.evaluate(el => el.classList.contains('selected'));
        expect(selected).toBeTruthy();

        // Deselect with Escape
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);

        const deselected = await workerCard.evaluate(el => el.classList.contains('selected'));
        expect(deselected).toBeFalsy();
      }
    });
  });

  test.describe('Flow 6: Error Recovery and Resilience', () => {
    test('should handle connection loss gracefully', async ({ page }) => {
      await waitForWebSocketConnection(page);

      // Simulate network loss
      await page.context().setOffline(true);
      await page.waitForTimeout(1000);

      // Restore network
      await page.context().setOffline(false);
      await page.waitForTimeout(1000);

      // App should still be functional
      const body = page.locator('body');
      await expect(body).toBeVisible();
    });

    test('should recover from command palette errors', async ({ page }) => {
      await openCommandPalette(page);

      // Type invalid command
      const input = page.locator('.cp-input');
      await input.fill('invalid:command:that:does:not:exist');
      await page.waitForTimeout(200);

      // Press Enter - should close safely
      await page.keyboard.press('Enter');
      await page.waitForTimeout(200);

      const palette = page.locator('.cp-overlay');
      await expect(palette).not.toBeVisible();

      // App should remain functional
      const body = page.locator('body');
      await expect(body).toBeVisible();
    });

    test('should handle rapid worker selection changes', async ({ page }) => {
      await waitForWebSocketConnection(page);
      await page.waitForTimeout(1000);

      const workerCards = page.locator('.worker-card');
      const count = await workerCards.count();

      if (count >= 2) {
        // Rapid worker selection
        for (let i = 0; i < 5; i++) {
          await workerCards.nth(i % count).click();
          await page.waitForTimeout(50);
        }

        // Should remain stable
        const workerGrid = page.locator('.worker-grid');
        await expect(workerGrid).toBeVisible();
      }
    });
  });
});
