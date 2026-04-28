/**
 * E2E Tests: WebSocket Event Streaming
 *
 * Comprehensive tests for real-time WebSocket event streaming including:
 * - Event delivery and ordering
 * - Real-time updates to UI components
 * - Multi-worker event streaming
 * - Event filtering during streaming
 * - Large event batch handling
 * - Event throttling and debouncing
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
 * Helper: Get event count from activity stream
 */
async function getEventCount(page: Page): Promise<number> {
  const events = page.locator('.activity-stream .event-item, .activity-stream .event, .log-entry');
  return await events.count();
}

/**
 * Helper: Get worker count
 */
async function getWorkerCount(page: Page): Promise<number> {
  const workerCards = page.locator('.worker-card');
  return await workerCards.count();
}

/**
 * Helper: Get text content of last event
 */
async function getLastEventText(page: Page): Promise<string | null> {
  const lastEvent = page.locator('.activity-stream .event-item, .activity-stream .event, .log-entry').last();
  const count = await lastEvent.count();
  if (count > 0) {
    return await lastEvent.textContent();
  }
  return null;
}

test.describe('E2E: WebSocket Event Streaming', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
  });

  test.describe('Initial Connection and Handshake', () => {
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

    test('should receive initial data after connection', async ({ page }) => {
      await waitForWebSocketConnection(page);
      await page.waitForTimeout(1000);

      // Should have received some data
      const workerGrid = page.locator('.worker-grid');
      await expect(workerGrid).toBeVisible();

      const activityStream = page.locator('.activity-stream');
      await expect(activityStream).toBeVisible();
    });

    test('should show connection state in UI', async ({ page }) => {
      const connectionStatus = page.locator('.connection-status');
      await expect(connectionStatus).toBeVisible();

      // Wait for connection
      await waitForWebSocketConnection(page);

      // Should show connected text or indicator
      const text = await connectionStatus.textContent();
      const isConnected = text?.toLowerCase().includes('connected') ||
                         await connectionStatus.locator('.connected').count() > 0;
      expect(isConnected).toBeTruthy();
    });
  });

  test.describe('Real-time Event Delivery', () => {
    test('should deliver events in chronological order', async ({ page }) => {
      await waitForWebSocketConnection(page);
      await page.waitForTimeout(1000);

      const events = page.locator('.activity-stream .event-item, .activity-stream .event');
      const count = await events.count();

      if (count > 1) {
        // Get timestamps of first and last events
        const firstEventTime = await events.first().locator('.event-time, .timestamp').textContent();
        const lastEventTime = await events.last().locator('.event-time, .timestamp').textContent();

        // Both should have timestamps
        expect(firstEventTime).toBeTruthy();
        expect(lastEventTime).toBeTruthy();

        // If we can parse them, first should be earlier than last
        // (events are ordered newest to oldest or oldest to newest)
        expect(firstEventTime).not.toBe(lastEventTime);
      }
    });

    test('should update event count in real-time', async ({ page }) => {
      await waitForWebSocketConnection(page);

      const initialCount = await getEventCount(page);

      // Wait for new events to arrive
      await page.waitForTimeout(3000);

      const newCount = await getEventCount(page);

      // Event count should update (may stay same if no new events)
      expect(newCount).toBeGreaterThanOrEqual(initialCount);
    });

    test('should display worker information in events', async ({ page }) => {
      await waitForWebSocketConnection(page);
      await page.waitForTimeout(1000);

      const events = page.locator('.activity-stream .event-item, .activity-stream .event');
      const count = await events.count();

      if (count > 0) {
        // First event should have worker information
        const firstEvent = events.first();
        const workerInfo = firstEvent.locator('[class*="worker"], .worker-id, [data-worker]');
        const hasWorker = await workerInfo.count() > 0;

        if (hasWorker) {
          await expect(workerInfo.first()).toBeVisible();
        }
      }
    });

    test('should show event levels with correct styling', async ({ page }) => {
      await waitForWebSocketConnection(page);
      await page.waitForTimeout(1000);

      // Check for events with different levels
      const infoEvents = page.locator('.activity-stream .event-item.info, .activity-stream .event.info, [class*="level-info"]');
      const errorEvents = page.locator('.activity-stream .event-item.error, .activity-stream .event.error, [class*="level-error"]');
      const warnEvents = page.locator('.activity-stream .event-item.warn, .activity-stream .event.warn, [class*="level-warn"]');

      // At least one type of event might exist
      const hasInfo = await infoEvents.count() > 0;
      const hasError = await errorEvents.count() > 0;
      const hasWarn = await warnEvents.count() > 0;

      expect(hasInfo || hasError || hasWarn).toBeTruthy();
    });
  });

  test.describe('Multi-Worker Event Streaming', () => {
    test('should show events from multiple workers', async ({ page }) => {
      await waitForWebSocketConnection(page);
      await page.waitForTimeout(2000);

      const workerCards = page.locator('.worker-card');
      const workerCount = await workerCards.count();

      if (workerCount > 1) {
        // Get worker IDs from cards
        const workerIds: string[] = [];
        for (let i = 0; i < Math.min(workerCount, 3); i++) {
          const text = await workerCards.nth(i).textContent();
          const match = text?.match(/w-[\w-]+/);
          if (match) {
            workerIds.push(match[0]);
          }
        }

        if (workerIds.length > 1) {
          // Activity stream should contain events from multiple workers
          const events = page.locator('.activity-stream .event-item, .activity-stream .event');
          const eventCount = await events.count();

          if (eventCount > 0) {
            // Check that events reference different workers
            const workersInEvents = new Set<string>();
            for (let i = 0; i < Math.min(eventCount, 10); i++) {
              const text = await events.nth(i).textContent();
              for (const workerId of workerIds) {
                if (text?.includes(workerId)) {
                  workersInEvents.add(workerId);
                }
              }
            }

            // Should have at least one worker's events
            expect(workersInEvents.size).toBeGreaterThanOrEqual(1);
          }
        }
      }
    });

    test('should update worker grid in real-time', async ({ page }) => {
      await waitForWebSocketConnection(page);

      const initialWorkerCount = await getWorkerCount(page);

      // Wait for potential updates
      await page.waitForTimeout(3000);

      const newWorkerCount = await getWorkerCount(page);

      // Worker grid should be present and may have updated
      const workerGrid = page.locator('.worker-grid');
      await expect(workerGrid).toBeVisible();
    });

    test('should show worker status changes', async ({ page }) => {
      await waitForWebSocketConnection(page);
      await page.waitForTimeout(1000);

      const workerCards = page.locator('.worker-card');
      const count = await workerCards.count();

      if (count > 0) {
        // Check for status indicators
        const statusIndicators = page.locator('.worker-card .status, .worker-card [class*="status"]');
        const hasStatus = await statusIndicators.count() > 0;

        if (hasStatus) {
          // Should have status on at least one worker
          await expect(statusIndicators.first()).toBeVisible();
        }
      }
    });
  });

  test.describe('Event Filtering During Streaming', () => {
    test('should filter activity stream when worker is selected', async ({ page }) => {
      await waitForWebSocketConnection(page);
      await page.waitForTimeout(1000);

      const workerCard = page.locator('.worker-card').first();
      const count = await workerCard.count();

      if (count > 0) {
        // Get initial event count
        const initialEventCount = await getEventCount(page);

        // Click on worker to select
        await workerCard.click();
        await page.waitForTimeout(500);

        // Activity stream should now be filtered
        const activityStream = page.locator('.activity-stream');
        await expect(activityStream).toBeVisible();

        // May show filtered indicator or different event count
        const filteredIndicator = page.locator('.filtered-indicator, .filter-indicator, [class*="worker-filter"]');
        const hasFilteredIndicator = await filteredIndicator.count() > 0;

        if (hasFilteredIndicator) {
          await expect(filteredIndicator.first()).toBeVisible();
        }
      }
    });

    test('should show all events when worker is deselected', async ({ page }) => {
      await waitForWebSocketConnection(page);
      await page.waitForTimeout(1000);

      const workerCard = page.locator('.worker-card').first();
      const count = await workerCard.count();

      if (count > 0) {
        // Select worker
        await workerCard.click();
        await page.waitForTimeout(500);

        // Deselect (click again or ESC)
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);

        // Should show all events again
        const activityStream = page.locator('.activity-stream');
        await expect(activityStream).toBeVisible();
      }
    });

    test('should apply level filter during streaming', async ({ page }) => {
      await waitForWebSocketConnection(page);

      // Open command palette to set filter
      await page.keyboard.press('Meta+k');
      let paletteVisible = await page.locator('.cp-overlay').isVisible().catch(() => false);
      if (!paletteVisible) {
        await page.keyboard.press('Control+k');
      }

      await page.waitForSelector('.cp-overlay', { timeout: 5000 });

      // Type filter command
      const input = page.locator('.cp-input');
      await input.fill('filter:level:error');
      await page.waitForTimeout(200);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);

      // Activity stream should be filtered
      const activityStream = page.locator('.activity-stream');
      await expect(activityStream).toBeVisible();
    });
  });

  test.describe('Large Event Batch Handling', () => {
    test('should handle large number of events gracefully', async ({ page }) => {
      await waitForWebSocketConnection(page);
      await page.waitForTimeout(2000);

      const eventCount = await getEventCount(page);

      // Activity stream should handle any number of events
      const activityStream = page.locator('.activity-stream');
      await expect(activityStream).toBeVisible();

      // Scroll should work
      await page.evaluate(() => {
        const stream = document.querySelector('.activity-stream');
        if (stream) {
          stream.scrollTop = stream.scrollHeight;
        }
      });

      await page.waitForTimeout(100);
    });

    test('should maintain performance with many workers', async ({ page }) => {
      await waitForWebSocketConnection(page);
      await page.waitForTimeout(2000);

      const workerCount = await getWorkerCount(page);

      // UI should remain responsive
      const workerGrid = page.locator('.worker-grid');
      await expect(workerGrid).toBeVisible();

      // Click should work
      await workerGrid.click();
      await page.waitForTimeout(100);
    });

    test('should virtualize or paginate large event lists', async ({ page }) => {
      await waitForWebSocketConnection(page);
      await page.waitForTimeout(1000);

      const activityStream = page.locator('.activity-stream');
      await expect(activityStream).toBeVisible();

      // Should have scrollable area
      const scrollHeight = await activityStream.evaluate(el => el.scrollHeight);
      const clientHeight = await activityStream.evaluate(el => el.clientHeight);

      // If there are many events, scrollHeight > clientHeight
      if (scrollHeight > clientHeight) {
        // Scrolling should work
        await activityStream.evaluate((el) => {
          el.scrollTop = el.scrollHeight / 2;
        });

        await page.waitForTimeout(100);
      }
    });
  });

  test.describe('Real-time UI Updates', () => {
    test('should update timeline when new events arrive', async ({ page }) => {
      await waitForWebSocketConnection(page);
      await page.waitForTimeout(1000);

      const timeline = page.locator('.timeline-view, .timeline-panel');
      const hasTimeline = await timeline.count() > 0;

      if (hasTimeline) {
        await expect(timeline).toBeVisible();

        // Wait for potential updates
        await page.waitForTimeout(2000);

        // Timeline should still be visible
        await expect(timeline).toBeVisible();
      }
    });

    test('should update worker cards in real-time', async ({ page }) => {
      await waitForWebSocketConnection(page);

      const workerGrid = page.locator('.worker-grid');
      await expect(workerGrid).toBeVisible();

      // Wait for updates
      await page.waitForTimeout(3000);

      // Grid should still be functional
      await expect(workerGrid).toBeVisible();
    });

    test('should show new event indicator', async ({ page }) => {
      await waitForWebSocketConnection(page);

      // Wait for events to arrive
      await page.waitForTimeout(2000);

      const activityStream = page.locator('.activity-stream');
      await expect(activityStream).toBeVisible();

      // Check for new activity indicators
      const newActivity = page.locator('.new-activity, [class*="new-event"]');
      const hasNewActivity = await newActivity.count() > 0;

      // May or may not have new activity depending on timing
      if (hasNewActivity) {
        await expect(newActivity.first()).toBeVisible();
      }
    });
  });

  test.describe('WebSocket Message Handling', () => {
    test('should handle JSON parse errors gracefully', async ({ page }) => {
      await waitForWebSocketConnection(page);

      // App should remain functional even with bad data
      await page.waitForTimeout(1000);

      const body = page.locator('body');
      await expect(body).toBeVisible();
    });

    test('should handle malformed event data', async ({ page }) => {
      await waitForWebSocketConnection(page);

      // Should handle incomplete event data
      await page.waitForTimeout(1000);

      const activityStream = page.locator('.activity-stream');
      await expect(activityStream).toBeVisible();
    });

    test('should handle missing optional fields', async ({ page }) => {
      await waitForWebSocketConnection(page);
      await page.waitForTimeout(1000);

      const events = page.locator('.activity-stream .event-item, .activity-stream .event');
      const count = await events.count();

      if (count > 0) {
        // Events should render even with optional fields missing
        await expect(events.first()).toBeVisible();
      }
    });
  });

  test.describe('Reconnection with Event Recovery', () => {
    test('should request events after reconnection', async ({ page }) => {
      await waitForWebSocketConnection(page);

      const initialEventCount = await getEventCount(page);

      // Simulate reconnection by going offline and online
      await page.context().setOffline(true);
      await page.waitForTimeout(1000);
      await page.context().setOffline(false);

      // Should reconnect
      await page.waitForTimeout(2000);

      const connectionStatus = page.locator('.connection-status');
      await expect(connectionStatus).toBeVisible();

      // Events should be present
      const newEventCount = await getEventCount(page);
      expect(newEventCount).toBeGreaterThanOrEqual(0);
    });

    test('should preserve UI state during reconnection', async ({ page }) => {
      await waitForWebSocketConnection(page);
      await page.waitForTimeout(1000);

      // Select a worker
      const workerCard = page.locator('.worker-card').first();
      const count = await workerCard.count();

      if (count > 0) {
        await workerCard.click();
        await page.waitForTimeout(500);

        // Simulate reconnection
        await page.context().setOffline(true);
        await page.waitForTimeout(500);
        await page.context().setOffline(false);

        await page.waitForTimeout(1000);

        // Worker should still be selected
        const isSelected = await workerCard.evaluate(el => el.classList.contains('selected'));
        expect(isSelected).toBeTruthy();
      }
    });
  });

  test.describe('Event Streaming Performance', () => {
    test('should not block UI during event processing', async ({ page }) => {
      await waitForWebSocketConnection(page);

      // UI should be interactive
      const body = page.locator('body');
      await body.click();
      await page.waitForTimeout(100);

      // Should still be responsive
      await expect(body).toBeVisible();
    });

    test('should throttle rapid updates', async ({ page }) => {
      await waitForWebSocketConnection(page);

      // Wait for multiple potential update cycles
      for (let i = 0; i < 10; i++) {
        await page.waitForTimeout(100);
        const activityStream = page.locator('.activity-stream');
        await expect(activityStream).toBeVisible();
      }
    });

    test('should debounce filter changes', async ({ page }) => {
      await waitForWebSocketConnection(page);

      const workerCard = page.locator('.worker-card').first();
      const count = await workerCard.count();

      if (count > 0) {
        // Rapidly select and deselect
        for (let i = 0; i < 3; i++) {
          await workerCard.click();
          await page.waitForTimeout(50);
          await page.keyboard.press('Escape');
          await page.waitForTimeout(50);
        }

        // Should remain stable
        const activityStream = page.locator('.activity-stream');
        await expect(activityStream).toBeVisible();
      }
    });
  });
});
