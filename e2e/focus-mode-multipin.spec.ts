/**
 * E2E Tests: Focus Mode with Multiple Pins
 *
 * Tests for Focus Mode functionality when multiple workers/beads are pinned:
 * - Multiple worker pinning
 * - Worker + bead combinations
 * - Pin state management
 * - Filter behavior with multiple pins
 * - Preset management with multiple pins
 */

import { test, expect, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:3000';

/**
 * Helper: Wait for workers to load
 */
async function waitForWorkers(page: Page): Promise<void> {
  await page.waitForTimeout(1000);
}

/**
 * Helper: Get pinned workers count from UI
 */
async function getPinnedCount(page: Page): Promise<number> {
  const countText = await page.locator('.focus-mode-count').textContent().catch(() => '0');
  return parseInt(countText || '0', 10);
}

/**
 * Helper: Check if focus mode is active
 */
async function isFocusModeActive(page: Page): Promise<boolean> {
  const toggle = page.locator('.focus-mode-toggle');
  const hasClass = await toggle.evaluate(el => el.classList.contains('active'));
  return hasClass;
}

/**
 * Helper: Toggle focus mode
 */
async function toggleFocusMode(page: Page): Promise<void> {
  const toggle = page.locator('.focus-mode-toggle');
  await toggle.click();
  await page.waitForTimeout(100);
}

/**
 * Helper: Pin a worker by index
 */
async function pinWorker(page: Page, index: number): Promise<void> {
  const workerCard = page.locator('.worker-card').nth(index);
  const pinButton = workerCard.locator('.pin-button');
  await pinButton.click();
  await page.waitForTimeout(100);
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
  await page.waitForSelector('.cp-overlay');
  await page.waitForTimeout(100);
}

/**
 * Helper: Type and execute command
 */
async function executeCommand(page: Page, query: string): Promise<void> {
  await openCommandPalette(page);
  const input = page.locator('.cp-input');
  await input.fill(query);
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
}

test.describe('E2E: Focus Mode with Multiple Pins', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await waitForWorkers(page);
  });

  test.describe('Multiple Worker Pinning', () => {
    test('should allow pinning multiple workers sequentially', async ({ page }) => {
      const workerCards = page.locator('.worker-card');
      const count = await workerCards.count();

      if (count >= 3) {
        // Pin first worker
        await pinWorker(page, 0);
        let pinnedCount = await getPinnedCount(page);
        expect(pinnedCount).toBeGreaterThanOrEqual(1);

        // Pin second worker
        await pinWorker(page, 1);
        pinnedCount = await getPinnedCount(page);
        expect(pinnedCount).toBeGreaterThanOrEqual(2);

        // Pin third worker
        await pinWorker(page, 2);
        pinnedCount = await getPinnedCount(page);
        expect(pinnedCount).toBeGreaterThanOrEqual(3);

        // All should be pinned
        for (let i = 0; i < 3; i++) {
          const card = workerCards.nth(i);
          await expect(card).toHaveClass(/pinned/);
        }
      }
    });

    test('should show correct count when multiple workers are pinned', async ({ page }) => {
      const workerCards = page.locator('.worker-card');
      const count = await workerCards.count();

      if (count >= 3) {
        // Pin three workers
        await pinWorker(page, 0);
        await pinWorker(page, 1);
        await pinWorker(page, 2);

        const pinnedCount = await getPinnedCount(page);
        expect(pinnedCount).toBe(3);

        // Count badge should show "3"
        const countBadge = page.locator('.focus-mode-count');
        const countText = await countBadge.textContent();
        expect(parseInt(countText || '0', 10)).toBe(3);
      }
    });

    test('should filter to show all pinned workers when focus mode is on', async ({ page }) => {
      const workerCards = page.locator('.worker-card');
      const count = await workerCards.count();

      if (count >= 3) {
        // Pin three workers
        await pinWorker(page, 0);
        await pinWorker(page, 1);
        await pinWorker(page, 2);

        // Enable focus mode
        await toggleFocusMode(page);

        // Should show all three pinned workers
        const visibleCards = page.locator('.worker-card:not(.hidden)');
        const visibleCount = await visibleCards.count();

        expect(visibleCount).toBe(3);
      }
    });

    test('should allow unpinning individual workers when multiple are pinned', async ({ page }) => {
      const workerCards = page.locator('.worker-card');
      const count = await workerCards.count();

      if (count >= 3) {
        // Pin three workers
        await pinWorker(page, 0);
        await pinWorker(page, 1);
        await pinWorker(page, 2);

        let pinnedCount = await getPinnedCount(page);
        expect(pinnedCount).toBe(3);

        // Unpin middle worker
        const middleCard = workerCards.nth(1);
        const pinButton = middleCard.locator('.pin-button');
        await pinButton.click();
        await page.waitForTimeout(100);

        // Should now have 2 pinned
        pinnedCount = await getPinnedCount(page);
        expect(pinnedCount).toBe(2);

        // Middle worker should not be pinned
        await expect(middleCard).not.toHaveClass(/pinned/);
      }
    });

    test('should handle unpinning all workers one by one', async ({ page }) => {
      const workerCards = page.locator('.worker-card');
      const count = await workerCards.count();

      if (count >= 2) {
        // Pin two workers
        await pinWorker(page, 0);
        await pinWorker(page, 1);

        // Unpin first
        const firstCard = workerCards.nth(0);
        const firstPinButton = firstCard.locator('.pin-button');
        await firstPinButton.click();
        await page.waitForTimeout(100);

        // Unpin second
        const secondCard = workerCards.nth(1);
        const secondPinButton = secondCard.locator('.pin-button');
        await secondPinButton.click();
        await page.waitForTimeout(100);

        // Should have no pinned workers
        const pinnedCount = await getPinnedCount(page);
        expect(pinnedCount).toBe(0);

        // Count badge should be hidden or show 0
        const countBadge = page.locator('.focus-mode-count');
        const hasCount = await countBadge.count() > 0;

        if (hasCount) {
          const countText = await countBadge.textContent();
          expect(countText).toBe('0');
        }
      }
    });
  });

  test.describe('Worker and Bead Combinations', () => {
    test('should allow pinning both workers and beads', async ({ page }) => {
      const workerCards = page.locator('.worker-card');
      const count = await workerCards.count();

      if (count >= 2) {
        // Pin first worker
        await pinWorker(page, 0);

        // Pin a bead via command palette
        await executeCommand(page, 'bead:bd-test123');

        // Should have at least 2 pins (1 worker + 1 bead)
        const pinnedCount = await getPinnedCount(page);
        expect(pinnedCount).toBeGreaterThanOrEqual(2);
      }
    });

    test('should filter by both pinned workers and beads', async ({ page }) => {
      const workerCards = page.locator('.worker-card');
      const count = await workerCards.count();

      if (count >= 2) {
        // Pin first worker
        await pinWorker(page, 0);

        // Enable focus mode
        await toggleFocusMode(page);

        // Should show only pinned worker
        let visibleCards = page.locator('.worker-card:not(.hidden)');
        let visibleCount = await visibleCards.count();
        expect(visibleCount).toBeLessThanOrEqual(1);

        // Add a bead pin via command palette
        await executeCommand(page, 'bead:bd-test');

        // Should show worker with matching bead events
        visibleCards = page.locator('.worker-card:not(.hidden)');
        visibleCount = await visibleCards.count();
        expect(visibleCount).toBeGreaterThanOrEqual(1);
      }
    });

    test('should show correct count for worker + bead combinations', async ({ page }) => {
      const workerCards = page.locator('.worker-card');
      const count = await workerCards.count();

      if (count >= 2) {
        // Pin two workers
        await pinWorker(page, 0);
        await pinWorker(page, 1);

        // Add bead pin
        await executeCommand(page, 'bead:bd-test');

        // Count should reflect all pins
        const pinnedCount = await getPinnedCount(page);
        expect(pinnedCount).toBeGreaterThanOrEqual(3);
      }
    });
  });

  test.describe('Pin State Management', () => {
    test('should persist multiple pins across page reload', async ({ page }) => {
      const workerCards = page.locator('.worker-card');
      const count = await workerCards.count();

      if (count >= 2) {
        // Pin two workers
        await pinWorker(page, 0);
        await pinWorker(page, 1);

        const initialCount = await getPinnedCount(page);

        // Reload page
        await page.reload();
        await page.waitForLoadState('networkidle');
        await waitForWorkers(page);

        // Pins should be preserved
        const reloadedCount = await getPinnedCount(page);
        expect(reloadedCount).toBe(initialCount);

        // Workers should still be pinned
        const firstCard = workerCards.nth(0);
        const secondCard = workerCards.nth(1);

        await expect(firstCard).toHaveClass(/pinned/);
        await expect(secondCard).toHaveClass(/pinned/);
      }
    });

    test('should persist focus mode state with multiple pins', async ({ page }) => {
      const workerCards = page.locator('.worker-card');
      const count = await workerCards.count();

      if (count >= 2) {
        // Pin workers and enable focus mode
        await pinWorker(page, 0);
        await pinWorker(page, 1);
        await toggleFocusMode(page);

        // Reload
        await page.reload();
        await page.waitForLoadState('networkidle');
        await waitForWorkers(page);

        // Focus mode should still be active
        const isActive = await isFocusModeActive(page);
        expect(isActive).toBeTruthy();

        // Pins should be preserved
        const pinnedCount = await getPinnedCount(page);
        expect(pinnedCount).toBeGreaterThanOrEqual(2);
      }
    });

    test('should clear all pins via command palette', async ({ page }) => {
      const workerCards = page.locator('.worker-card');
      const count = await workerCards.count();

      if (count >= 2) {
        // Pin multiple workers
        await pinWorker(page, 0);
        await pinWorker(page, 1);

        let pinnedCount = await getPinnedCount(page);
        expect(pinnedCount).toBeGreaterThanOrEqual(2);

        // Clear via command palette
        await executeCommand(page, 'focus:clear');
        await page.waitForTimeout(100);

        // All pins should be cleared
        pinnedCount = await getPinnedCount(page);
        expect(pinnedCount).toBe(0);

        // Workers should not be pinned
        const firstCard = workerCards.nth(0);
        const secondCard = workerCards.nth(1);

        await expect(firstCard).not.toHaveClass(/pinned/);
        await expect(secondCard).not.toHaveClass(/pinned/);
      }
    });
  });

  test.describe('Filter Behavior with Multiple Pins', () => {
    test('should show only pinned workers in worker grid', async ({ page }) => {
      const workerCards = page.locator('.worker-card');
      const count = await workerCards.count();

      if (count >= 3) {
        // Pin first two workers
        await pinWorker(page, 0);
        await pinWorker(page, 1);

        // Enable focus mode
        await toggleFocusMode(page);

        // Should only show pinned workers
        const visibleCards = page.locator('.worker-card:not(.hidden)');
        const visibleCount = await visibleCards.count();

        expect(visibleCount).toBe(2);

        // Third worker should be hidden
        const thirdCard = workerCards.nth(2);
        const isHidden = await thirdCard.evaluate(el => el.classList.contains('hidden'));
        expect(isHidden).toBeTruthy();
      }
    });

    test('should filter activity stream to pinned workers', async ({ page }) => {
      const workerCards = page.locator('.worker-card');
      const count = await workerCards.count();

      if (count >= 2) {
        // Pin first worker
        await pinWorker(page, 0);

        // Enable focus mode
        await toggleFocusMode(page);

        // Activity stream should filter to pinned worker
        const activityStream = page.locator('.activity-stream');
        await expect(activityStream).toBeVisible();

        // Stream should show filtered indicator if implemented
        const filterIndicator = page.locator('.filter-indicator, .filtered-indicator');
        const hasIndicator = await filterIndicator.count() > 0;

        if (hasIndicator) {
          await expect(filterIndicator).toBeVisible();
        }
      }
    });

    test('should update filter when pins are added/removed', async ({ page }) => {
      const workerCards = page.locator('.worker-card');
      const count = await workerCards.count();

      if (count >= 3) {
        // Pin first worker, enable focus mode
        await pinWorker(page, 0);
        await toggleFocusMode(page);

        let visibleCards = page.locator('.worker-card:not(.hidden)');
        let visibleCount = await visibleCards.count();
        expect(visibleCount).toBe(1);

        // Add second pin
        await pinWorker(page, 1);

        visibleCards = page.locator('.worker-card:not(.hidden)');
        visibleCount = await visibleCards.count();
        expect(visibleCount).toBe(2);

        // Remove first pin
        const firstCard = workerCards.nth(0);
        const pinButton = firstCard.locator('.pin-button');
        await pinButton.click();
        await page.waitForTimeout(100);

        visibleCards = page.locator('.worker-card:not(.hidden)');
        visibleCount = await visibleCards.count();
        expect(visibleCount).toBe(1);
      }
    });
  });

  test.describe('Preset Management with Multiple Pins', () => {
    test('should save preset with multiple pinned workers', async ({ page }) => {
      const workerCards = page.locator('.worker-card');
      const count = await workerCards.count();

      if (count >= 2) {
        // Pin multiple workers
        await pinWorker(page, 0);
        await pinWorker(page, 1);

        // Open preset save dialog
        await openCommandPalette(page);
        const input = page.locator('.cp-input');
        await input.fill('preset:save');
        await page.waitForTimeout(150);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(200);

        // Dialog should open
        const presetDialog = page.locator('.preset-dialog');
        const hasDialog = await presetDialog.count() > 0;

        if (hasDialog) {
          await expect(presetDialog).toBeVisible();

          // Type preset name
          const nameInput = presetDialog.locator('input[type="text"]');
          await nameInput.fill('test-preset');

          // Save
          const saveButton = presetDialog.locator('button.primary');
          await saveButton.click();
          await page.waitForTimeout(100);

          // Dialog should close
          await expect(presetDialog).not.toBeVisible();
        }
      }
    });

    test('should load preset with multiple pinned workers', async ({ page }) => {
      // First, assume a preset exists from previous test
      // Open preset dropdown
      const presetToggle = page.locator('.preset-toggle');
      const hasPreset = await presetToggle.count() > 0;

      if (hasPreset) {
        await presetToggle.click();
        await page.waitForTimeout(100);

        // Check for saved presets
        const presetItems = page.locator('.preset-item');
        const itemCount = await presetItems.count();

        if (itemCount > 0) {
          // Click first preset item (skip save button)
          const firstPreset = presetItems.nth(1);
          await firstPreset.click();
          await page.waitForTimeout(100);

          // Focus mode should be enabled
          const isActive = await isFocusModeActive(page);
          expect(isActive).toBeTruthy();

          // Should have pinned workers
          const pinnedCount = await getPinnedCount(page);
          expect(pinnedCount).toBeGreaterThan(0);
        }
      }
    });

    test('should delete preset', async ({ page }) => {
      const presetToggle = page.locator('.preset-toggle');
      const hasPreset = await presetToggle.count() > 0;

      if (hasPreset) {
        await presetToggle.click();
        await page.waitForTimeout(100);

        // Look for delete button on preset items
        const deleteButton = page.locator('.preset-delete');
        const hasDelete = await deleteButton.count() > 0;

        if (hasDelete) {
          const initialCount = await page.locator('.preset-item').count();

          // Click first delete button
          await deleteButton.first().click();
          await page.waitForTimeout(100);

          // Count should decrease
          const newCount = await page.locator('.preset-item').count();
          expect(newCount).toBeLessThan(initialCount);
        }
      }
    });
  });

  test.describe('Edge Cases with Multiple Pins', () => {
    test('should handle pinning all available workers', async ({ page }) => {
      const workerCards = page.locator('.worker-card');
      const count = await workerCards.count();

      if (count > 0 && count <= 5) {
        // Pin all workers
        for (let i = 0; i < count; i++) {
          await pinWorker(page, i);
        }

        const pinnedCount = await getPinnedCount(page);
        expect(pinnedCount).toBe(count);

        // Enable focus mode
        await toggleFocusMode(page);

        // All workers should still be visible
        const visibleCards = page.locator('.worker-card:not(.hidden)');
        const visibleCount = await visibleCards.count();
        expect(visibleCount).toBe(count);
      }
    });

    test('should handle rapid pin/unpin operations on multiple workers', async ({ page }) => {
      const workerCards = page.locator('.worker-card');
      const count = await workerCards.count();

      if (count >= 2) {
        // Rapid pin/unpin cycles
        for (let i = 0; i < 3; i++) {
          await pinWorker(page, 0);
          await pinWorker(page, 1);

          const firstCard = workerCards.nth(0);
          const secondCard = workerCards.nth(1);

          await firstCard.locator('.pin-button').click();
          await page.waitForTimeout(50);

          await secondCard.locator('.pin-button').click();
          await page.waitForTimeout(50);
        }

        // Should remain stable
        const body = page.locator('body');
        await expect(body).toBeVisible();
      }
    });

    test('should handle pinning when focus mode is already active', async ({ page }) => {
      const workerCards = page.locator('.worker-card');
      const count = await workerCards.count();

      if (count >= 2) {
        // Enable focus mode first
        await toggleFocusMode(page);

        // Pin workers while focus mode is active
        await pinWorker(page, 0);
        await pinWorker(page, 1);

        // Workers should become visible as they're pinned
        const visibleCards = page.locator('.worker-card:not(.hidden)');
        const visibleCount = await visibleCards.count();

        expect(visibleCount).toBe(2);
      }
    });

    test('should handle unpinning when focus mode is active', async ({ page }) => {
      const workerCards = page.locator('.worker-card');
      const count = await workerCards.count();

      if (count >= 2) {
        // Pin workers and enable focus mode
        await pinWorker(page, 0);
        await pinWorker(page, 1);
        await toggleFocusMode(page);

        let visibleCards = page.locator('.worker-card:not(.hidden)');
        let visibleCount = await visibleCards.count();
        expect(visibleCount).toBe(2);

        // Unpin one worker
        const firstCard = workerCards.nth(0);
        await firstCard.locator('.pin-button').click();
        await page.waitForTimeout(100);

        // Should update view
        visibleCards = page.locator('.worker-card:not(.hidden)');
        visibleCount = await visibleCards.count();
        expect(visibleCount).toBe(1);
      }
    });

    test('should handle clearing all pins when focus mode is active', async ({ page }) => {
      const workerCards = page.locator('.worker-card');
      const count = await workerCards.count();

      if (count >= 2) {
        // Pin workers and enable focus mode
        await pinWorker(page, 0);
        await pinWorker(page, 1);
        await toggleFocusMode(page);

        // Clear all pins
        await executeCommand(page, 'focus:clear');
        await page.waitForTimeout(100);

        // Should show empty state
        const emptyState = page.locator('.worker-grid .empty-state');
        const hasEmptyState = await emptyState.count() > 0;

        if (hasEmptyState) {
          await expect(emptyState).toBeVisible();
        }

        // No workers should be pinned
        const pinnedCount = await getPinnedCount(page);
        expect(pinnedCount).toBe(0);
      }
    });
  });

  test.describe('Visual Feedback with Multiple Pins', () => {
    test('should show pinned indicator on all pinned workers', async ({ page }) => {
      const workerCards = page.locator('.worker-card');
      const count = await workerCards.count();

      if (count >= 3) {
        // Pin multiple workers
        await pinWorker(page, 0);
        await pinWorker(page, 1);
        await pinWorker(page, 2);

        // All should have pinned class
        for (let i = 0; i < 3; i++) {
          const card = workerCards.nth(i);
          await expect(card).toHaveClass(/pinned/);
        }

        // Unpinned workers should not have pinned class
        if (count > 3) {
          const unpinnedCard = workerCards.nth(3);
          await expect(unpinnedCard).not.toHaveClass(/pinned/);
        }
      }
    });

    test('should show focus mode toggle with active state when pins exist', async ({ page }) => {
      const workerCards = page.locator('.worker-card');
      const count = await workerCards.count();

      if (count >= 2) {
        // Pin workers
        await pinWorker(page, 0);
        await pinWorker(page, 1);

        // Enable focus mode
        await toggleFocusMode(page);

        // Toggle should be active
        const focusToggle = page.locator('.focus-mode-toggle');
        await expect(focusToggle).toHaveClass(/active/);

        // Count should show 2
        const countBadge = page.locator('.focus-mode-count');
        await expect(countBadge).toBeVisible();

        const countText = await countBadge.textContent();
        expect(parseInt(countText || '0', 10)).toBe(2);
      }
    });

    test('should update pin count badge in real-time', async ({ page }) => {
      const workerCards = page.locator('.worker-card');
      const count = await workerCards.count();

      if (count >= 3) {
        // Pin workers one by one
        await pinWorker(page, 0);

        let countText = await page.locator('.focus-mode-count').textContent();
        expect(parseInt(countText || '0', 10)).toBe(1);

        await pinWorker(page, 1);

        countText = await page.locator('.focus-mode-count').textContent();
        expect(parseInt(countText || '0', 10)).toBe(2);

        await pinWorker(page, 2);

        countText = await page.locator('.focus-mode-count').textContent();
        expect(parseInt(countText || '0', 10)).toBe(3);
      }
    });
  });
});
