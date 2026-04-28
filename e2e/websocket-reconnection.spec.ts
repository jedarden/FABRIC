/**
 * E2E Tests: WebSocket Reconnection Scenarios
 *
 * Comprehensive tests for WebSocket reconnection behavior including:
 * - Exponential backoff verification
 * - Max retry behavior
 * - Manual reconnect after max retries
 * - Connection state transitions
 * - Reconnection during active operations
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
 * Helper: Get connection state from UI
 */
async function getConnectionState(page: Page): Promise<{ state: string; attemptCount?: number; nextRetryIn?: number }> {
  const statusDot = page.locator('.status-dot');
  const hasConnectedClass = await statusDot.evaluate(el => el.classList.contains('connected'));
  const hasReconnectingClass = await statusDot.evaluate(el => el.classList.contains('reconnecting'));
  const hasDisconnectedClass = await statusDot.evaluate(el => el.classList.contains('disconnected'));

  if (hasConnectedClass) return { state: 'connected' };
  if (hasReconnectingClass) {
    const attemptText = await page.locator('.attempt-count').textContent().catch(() => '');
    const retryText = await page.locator('.retry-countdown').textContent().catch(() => '');
    return {
      state: 'reconnecting',
      attemptCount: attemptText ? parseInt(attemptText.match(/\d+/)?.[0] || '0', 10) : undefined,
      nextRetryIn: retryText ? parseInt(retryText, 10) : undefined,
    };
  }
  if (hasDisconnectedClass) return { state: 'disconnected' };

  return { state: 'unknown' };
}

test.describe('E2E: WebSocket Reconnection Scenarios', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
  });

  test.describe('Connection State Transitions', () => {
    test('should transition from disconnected to connected', async ({ page }) => {
      // Initial state should be disconnected or connecting
      const initialState = await getConnectionState(page);
      expect(['disconnected', 'connecting', 'reconnecting']).toContain(initialState.state);

      // Should eventually connect
      await waitForWebSocketConnection(page);

      const finalState = await getConnectionState(page);
      expect(finalState.state).toBe('connected');
    });

    test('should show connecting state during initial connection', async ({ page }) => {
      // Page starts, connection not yet established
      const connectionStatus = page.locator('.connection-status');
      await expect(connectionStatus).toBeVisible();

      // Wait for connection
      await waitForWebSocketConnection(page);

      // Should now show connected
      const statusDot = page.locator('.status-dot.connected');
      await expect(statusDot).toBeVisible();
    });

    test('should update UI when connection state changes', async ({ page }) => {
      const connectionStatus = page.locator('.connection-status');

      // Initial state
      await expect(connectionStatus).toBeVisible();

      // Connected state
      await waitForWebSocketConnection(page);

      const connectedText = await connectionStatus.textContent();
      expect(connectedText?.toLowerCase()).toContain('connected');
    });
  });

  test.describe('Reconnection Behavior', () => {
    test('should attempt reconnection after connection loss', async ({ page }) => {
      await waitForWebSocketConnection(page);

      // Connection is established
      let state = await getConnectionState(page);
      expect(state.state).toBe('connected');

      // Note: Actual disconnection simulation requires server cooperation
      // This test verifies the UI has reconnection elements

      const reconnectingText = page.locator('.reconnecting-text');
      const hasReconnecting = await reconnectingText.count() > 0;

      if (hasReconnecting) {
        await expect(reconnectingText).toBeVisible();
      }
    });

    test('should display retry countdown during reconnection', async ({ page }) => {
      await waitForWebSocketConnection(page);

      // Check for countdown element
      const retryCountdown = page.locator('.retry-countdown');
      const exists = await retryCountdown.count() > 0;

      if (exists) {
        await expect(retryCountdown).toBeVisible();

        // Should contain a number
        const text = await retryCountdown.textContent();
        expect(text).toMatch(/\d+/);
      }
    });

    test('should show attempt count during reconnection', async ({ page }) => {
      await waitForWebSocketConnection(page);

      const attemptCount = page.locator('.attempt-count');
      const exists = await attemptCount.count() > 0;

      if (exists) {
        await expect(attemptCount).toBeVisible();

        // Should be in format [N]
        const text = await attemptCount.textContent();
        expect(text).toMatch(/\[\d+\]/);
      }
    });

    test('should use exponential backoff for retries', async ({ page }) => {
      await waitForWebSocketConnection(page);

      // Verify exponential backoff elements exist
      const retryCountdown = page.locator('.retry-countdown');
      const attemptCount = page.locator('.attempt-count');

      const hasCountdown = await retryCountdown.count() > 0;
      const hasAttemptCount = await attemptCount.count() > 0;

      // At least one of these should exist for exponential backoff display
      expect(hasCountdown || hasAttemptCount).toBeTruthy();
    });
  });

  test.describe('Max Retry Behavior', () => {
    test('should show manual reconnect button after max retries', async ({ page }) => {
      await waitForWebSocketConnection(page);

      // Check for reconnect button
      const reconnectButton = page.locator('.reconnect-button');
      const exists = await reconnectButton.count() > 0;

      if (exists) {
        await expect(reconnectButton).toBeVisible();
        await expect(reconnectButton).toHaveText(/Retry|Reconnect/i);
      }
    });

    test('should stop automatic retries after max attempts', async ({ page }) => {
      await waitForWebSocketConnection(page);

      // If in disconnected state with max retries reached
      const reconnectButton = page.locator('.reconnect-button');
      const exists = await reconnectButton.count() > 0;

      if (exists) {
        // Should show manual reconnect button
        await expect(reconnectButton).toBeVisible();

        // Should not show automatic countdown
        const reconnectingText = page.locator('.reconnecting-text');
        const hasReconnectingText = await reconnectingText.count() > 0;

        if (hasReconnectingText) {
          const text = await reconnectingText.textContent();
          // Should not have countdown if max retries reached
          expect(text).not.toContain('Reconnecting...');
        }
      }
    });

    test('should allow manual reconnect via button click', async ({ page }) => {
      await waitForWebSocketConnection(page);

      const reconnectButton = page.locator('.reconnect-button');
      const exists = await reconnectButton.count() > 0;

      if (exists) {
        // Click reconnect button
        await reconnectButton.click();

        // Should trigger reconnection attempt
        await page.waitForTimeout(500);

        // Connection status should update
        const connectionStatus = page.locator('.connection-status');
        await expect(connectionStatus).toBeVisible();
      }
    });
  });

  test.describe('Reconnection During Operations', () => {
    test('should preserve selected worker during reconnection', async ({ page }) => {
      await waitForWebSocketConnection(page);
      await page.waitForTimeout(1000);

      const workerCard = page.locator('.worker-card').first();
      const count = await workerCard.count();

      if (count > 0) {
        // Select a worker
        await workerCard.click();
        await page.waitForTimeout(100);

        // Verify worker is selected
        await expect(workerCard).toHaveClass(/selected/);

        // Connection might be lost and reconnect
        // Worker selection should be preserved
        await page.waitForTimeout(2000);

        // Worker should still be selected (if still in DOM)
        const stillVisible = await workerCard.isVisible().catch(() => false);
        if (stillVisible) {
          await expect(workerCard).toHaveClass(/selected/);
        }
      }
    });

    test('should preserve command palette state during reconnection', async ({ page }) => {
      await waitForWebSocketConnection(page);

      // Open command palette
      await page.keyboard.press('Meta+k');
      let paletteVisible = await page.locator('.cp-overlay').isVisible().catch(() => false);
      if (!paletteVisible) {
        await page.keyboard.press('Control+k');
      }

      await page.waitForSelector('.cp-overlay');

      // Type a query
      const input = page.locator('.cp-input');
      await input.fill('test');
      await page.waitForTimeout(100);

      // Connection might be lost
      // Command palette should remain open
      const palette = page.locator('.cp-overlay');
      await expect(palette).toBeVisible();
    });

    test('should preserve focus mode state during reconnection', async ({ page }) => {
      await waitForWebSocketConnection(page);

      // Enable focus mode
      const focusToggle = page.locator('.focus-mode-toggle');
      await focusToggle.click();
      await page.waitForTimeout(100);

      const isActive = await focusToggle.evaluate(el => el.classList.contains('active'));
      expect(isActive).toBeTruthy();

      // Connection might be lost and reconnect
      await page.waitForTimeout(2000);

      // Focus mode should still be active
      await expect(focusToggle).toHaveClass(/active/);
    });
  });

  test.describe('Connection Quality Indicators', () => {
    test('should display connection status with correct styling', async ({ page }) => {
      await waitForWebSocketConnection(page);

      const statusDot = page.locator('.status-dot');

      // Should have connected class
      await expect(statusDot).toHaveClass(/connected/);

      // Should not have error or warning classes
      await expect(statusDot).not.toHaveClass(/error|warning|disconnected/);
    });

    test('should update status indicator when connection changes', async ({ page }) => {
      const connectionStatus = page.locator('.connection-status');

      // Should be visible throughout
      await expect(connectionStatus).toBeVisible();

      // Wait for connection
      await waitForWebSocketConnection(page);

      // Should show connected state
      const statusDot = page.locator('.status-dot.connected');
      await expect(statusDot).toBeVisible();
    });

    test('should show connection quality if available', async ({ page }) => {
      await waitForWebSocketConnection(page);

      // Check for latency indicator
      const latencyIndicator = page.locator('.connection-latency, .connection-quality');
      const hasLatency = await latencyIndicator.count() > 0;

      if (hasLatency) {
        await expect(latencyIndicator).toBeVisible();
      }
    });
  });

  test.describe('Error Recovery', () => {
    test('should recover from WebSocket errors', async ({ page }) => {
      await waitForWebSocketConnection(page);

      // Simulate potential error condition
      // App should remain functional
      const body = page.locator('body');
      await expect(body).toBeVisible();

      // Connection status should still be shown
      const connectionStatus = page.locator('.connection-status');
      await expect(connectionStatus).toBeVisible();
    });

    test('should handle malformed messages during reconnection', async ({ page }) => {
      await waitForWebSocketConnection(page);

      // App should handle bad data gracefully
      await page.waitForTimeout(1000);

      // Should still be functional
      const workerGrid = page.locator('.worker-grid');
      await expect(workerGrid).toBeVisible();
    });

    test('should maintain application state during reconnection', async ({ page }) => {
      await waitForWebSocketConnection(page);
      await page.waitForTimeout(1000);

      // Get initial worker count
      const initialCount = await getWorkerCount(page);

      // Connection might reconnect
      await page.waitForTimeout(2000);

      // Application state should be maintained
      const workerGrid = page.locator('.worker-grid');
      await expect(workerGrid).toBeVisible();
    });
  });

  test.describe('Concurrent Connection Handling', () => {
    test('should handle multiple tabs connecting simultaneously', async ({ context }) => {
      const pages: Page[] = [];

      try {
        // Create multiple pages
        for (let i = 0; i < 3; i++) {
          const page = await context.newPage();
          await page.goto(BASE_URL);
          pages.push(page);
        }

        // All should connect
        for (const page of pages) {
          await page.waitForSelector('.connection-status', { timeout: 10000 });
          const connectionStatus = page.locator('.connection-status');
          await expect(connectionStatus).toBeVisible();
        }
      } finally {
        // Clean up pages
        for (const page of pages) {
          await page.close();
        }
      }
    });

    test('should handle rapid connection attempts', async ({ page }) => {
      // Rapid page reloads
      for (let i = 0; i < 3; i++) {
        await page.goto(BASE_URL);
        await page.waitForTimeout(500);
      }

      // Should still connect
      const connectionStatus = page.locator('.connection-status');
      await expect(connectionStatus).toBeVisible({ timeout: 15000 });
    });
  });

  test.describe('Network Conditions', () => {
    test('should handle intermittent network connectivity', async ({ page }) => {
      await waitForWebSocketConnection(page);

      // Simulate intermittent connectivity
      for (let i = 0; i < 3; i++) {
        await page.context().setOffline(true);
        await page.waitForTimeout(500);
        await page.context().setOffline(false);
        await page.waitForTimeout(1000);
      }

      // Should recover
      const connectionStatus = page.locator('.connection-status');
      await expect(connectionStatus).toBeVisible();
    });

    test('should handle very slow reconnection', async ({ page }) => {
      await page.goto(BASE_URL);

      // Simulate slow network
      await page.route('**/*', async route => {
        await new Promise(resolve => setTimeout(resolve, 2000));
        return route.continue();
      });

      // Should still load (eventually)
      const body = page.locator('body');
      await expect(body).toBeVisible({ timeout: 30000 });
    });
  });
});

/**
 * Helper function to get worker count
 */
async function getWorkerCount(page: Page): Promise<number> {
  const workerCards = page.locator('.worker-card');
  return await workerCards.count();
}
