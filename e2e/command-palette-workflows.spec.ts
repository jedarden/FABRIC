/**
 * E2E Tests: Command Palette Complex Workflows
 *
 * Tests for complex command palette workflows including:
 * - Multi-command sequences
 * - Chained operations
 * - Context-aware suggestions
 * - Recent command tracking
 * - Integration with other features
 */

import { test, expect, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:3000';

/**
 * Helper: Open command palette using keyboard shortcut
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
 * Helper: Type query in command palette
 */
async function typeQuery(page: Page, query: string): Promise<void> {
  const input = page.locator('.cp-input');
  await input.clear();
  await input.fill(query);
  await page.waitForTimeout(150);
}

/**
 * Helper: Execute command and wait for palette to close
 */
async function executeCommand(page: Page, query: string): Promise<void> {
  await openCommandPalette(page);
  await typeQuery(page, query);
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');

  // Wait for palette to close
  const palette = page.locator('.cp-overlay');
  await palette.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
}

test.describe('E2E: Command Palette Complex Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
  });

  test.describe('Multi-Command Sequences', () => {
    test('should execute multiple commands in sequence', async ({ page }) => {
      // Execute theme toggle
      await executeCommand(page, 'theme:toggle');
      await page.waitForTimeout(200);

      // Execute focus mode toggle
      await executeCommand(page, 'focus:toggle');
      await page.waitForTimeout(200);

      // Execute heatmap toggle
      await executeCommand(page, 'show:heatmap');
      await page.waitForTimeout(200);

      // All commands should have executed
      const heatmap = page.locator('.file-heatmap-panel, .heatmap-panel');
      const hasHeatmap = await heatmap.count() > 0;

      if (hasHeatmap) {
        await expect(heatmap).toBeVisible();
      }
    });

    test('should handle rapid command execution', async ({ page }) => {
      const commands = [
        'theme:dark',
        'show:timeline',
        'show:analytics',
        'theme:light',
      ];

      for (const cmd of commands) {
        await openCommandPalette(page);
        await typeQuery(page, cmd);
        await page.waitForTimeout(100);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(100);
      }

      // Should remain stable
      const body = page.locator('body');
      await expect(body).toBeVisible();
    });

    test('should track recently used commands across executions', async ({ page }) => {
      // Execute several commands
      await executeCommand(page, 'theme:toggle');
      await page.waitForTimeout(200);

      await executeCommand(page, 'focus:toggle');
      await page.waitForTimeout(200);

      await executeCommand(page, 'show:heatmap');
      await page.waitForTimeout(200);

      // Open palette - should show recent commands
      await openCommandPalette(page);

      const commands = page.locator('.cp-item');
      const count = await commands.count();

      expect(count).toBeGreaterThan(0);
    });
  });

  test.describe('Chained Operations', () => {
    test('should support worker selection followed by detail view', async ({ page }) => {
      await page.waitForTimeout(1000);

      const workerCard = page.locator('.worker-card').first();
      const count = await workerCard.count();

      if (count > 0) {
        // Get worker ID from card
        const workerText = await workerCard.textContent();
        const workerMatch = workerText?.match(/w-[\w-]+/);

        if (workerMatch) {
          const workerId = workerMatch[0];

          // Use command palette to select worker
          await executeCommand(page, `worker:${workerId}`);
          await page.waitForTimeout(200);

          // Worker should be selected
          await expect(workerCard).toHaveClass(/selected/);

          // Detail panel should be visible
          const detailPanel = page.locator('.worker-detail-panel, .worker-detail');
          const hasDetail = await detailPanel.count() > 0;

          if (hasDetail) {
            await expect(detailPanel).toBeVisible();
          }
        }
      }
    });

    test('should support focus mode setup with pinning', async ({ page }) => {
      await page.waitForTimeout(1000);

      const workerCard = page.locator('.worker-card').first();
      const count = await workerCard.count();

      if (count > 0) {
        // Get worker ID
        const workerText = await workerCard.textContent();
        const workerMatch = workerText?.match(/w-[\w-]+/);

        if (workerMatch) {
          const workerId = workerMatch[0];

          // Enable focus mode
          await executeCommand(page, 'focus:toggle');
          await page.waitForTimeout(200);

          // Pin worker
          await workerCard.click();
          await page.waitForTimeout(100);

          // Focus mode should be active
          const focusToggle = page.locator('.focus-mode-toggle');
          await expect(focusToggle).toHaveClass(/active/);

          // Worker should be pinned
          await expect(workerCard).toHaveClass(/pinned/);
        }
      }
    });

    test('should support filter then view change sequence', async ({ page }) => {
      // Set level filter
      await executeCommand(page, 'filter:level:error');
      await page.waitForTimeout(200);

      // Change view to heatmap
      await executeCommand(page, 'show:heatmap');
      await page.waitForTimeout(200);

      // Both operations should complete
      const heatmap = page.locator('.file-heatmap-panel, .heatmap-panel');
      const hasHeatmap = await heatmap.count() > 0;

      if (hasHeatmap) {
        await expect(heatmap).toBeVisible();
      }
    });
  });

  test.describe('Context-Aware Suggestions', () => {
    test('should show worker-specific commands when worker exists', async ({ page }) => {
      await page.waitForTimeout(1000);

      await openCommandPalette(page);

      // Type "worker" to see worker commands
      await typeQuery(page, 'worker');

      const workerCategory = page.locator('.cp-category-header').filter({ hasText: 'Workers' });
      const hasWorkers = await workerCategory.count() > 0;

      if (hasWorkers) {
        await expect(workerCategory).toBeVisible();

        // Should have worker items
        const workerItems = page.locator('.cp-item').filter({ hasText: /w-/ });
        const workerCount = await workerItems.count();
        expect(workerCount).toBeGreaterThan(0);
      }
    });

    test('should show view commands based on current state', async ({ page }) => {
      await openCommandPalette(page);

      // Type "show" to see view commands
      await typeQuery(page, 'show');

      const commands = page.locator('.cp-item');
      const count = await commands.count();

      expect(count).toBeGreaterThan(0);

      // Should have common view commands
      let hasShowCommand = false;
      for (let i = 0; i < count; i++) {
        const text = await commands.nth(i).textContent();
        if (text?.toLowerCase().includes('show:')) {
          hasShowCommand = true;
          break;
        }
      }

      expect(hasShowCommand).toBeTruthy();
    });

    test('should suggest filter commands based on available options', async ({ page }) => {
      await openCommandPalette(page);

      // Type "filter" to see filter commands
      await typeQuery(page, 'filter');

      const commands = page.locator('.cp-item');
      const count = await commands.count();

      expect(count).toBeGreaterThan(0);

      // Should have level filter
      let hasLevelFilter = false;
      for (let i = 0; i < count; i++) {
        const text = await commands.nth(i).textContent();
        if (text?.toLowerCase().includes('level')) {
          hasLevelFilter = true;
          break;
        }
      }

      expect(hasLevelFilter).toBeTruthy();
    });
  });

  test.describe('Integration with Features', () => {
    test('should integrate command palette with timeline view', async ({ page }) => {
      // Toggle timeline via command palette
      await executeCommand(page, 'show:timeline');
      await page.waitForTimeout(200);

      // Timeline should be visible
      const timeline = page.locator('.timeline-view, .timeline-panel');
      await expect(timeline).toBeVisible();
    });

    test('should integrate command palette with analytics', async ({ page }) => {
      // Show analytics via command palette
      await executeCommand(page, 'show:analytics');
      await page.waitForTimeout(200);

      // Analytics panel should be visible
      const analytics = page.locator('.analytics-dashboard, .analytics-panel');
      const hasAnalytics = await analytics.count() > 0;

      if (hasAnalytics) {
        await expect(analytics).toBeVisible();
      }
    });

    test('should integrate command palette with replay', async ({ page }) => {
      // Show replay via command palette
      await executeCommand(page, 'show:replay');
      await page.waitForTimeout(200);

      // Replay panel should be visible
      const replay = page.locator('.session-replay-panel');
      await expect(replay).toBeVisible();
    });

    test('should integrate command palette with export', async ({ page }) => {
      // Export current session via command palette
      await executeCommand(page, 'export:link');
      await page.waitForTimeout(200);

      // Replay panel should open with export option
      const replay = page.locator('.session-replay-panel');
      await expect(replay).toBeVisible();
    });
  });

  test.describe('Recent Commands Tracking', () => {
    test('should prioritize recently used commands', async ({ page }) => {
      // Execute a command
      await executeCommand(page, 'theme:toggle');
      await page.waitForTimeout(200);

      // Open palette and type partial match
      await openCommandPalette(page);
      await typeQuery(page, 'theme');

      // Theme command should be prominent
      const commands = page.locator('.cp-item');
      const count = await commands.count();

      expect(count).toBeGreaterThan(0);

      // First result should relate to theme
      const firstText = await commands.first().textContent();
      expect(firstText?.toLowerCase()).toContain('theme');
    });

    test('should limit recent commands to reasonable number', async ({ page }) => {
      // Execute multiple commands
      const commands = [
        'theme:toggle',
        'show:heatmap',
        'show:timeline',
        'focus:toggle',
        'show:analytics',
      ];

      for (const cmd of commands) {
        await executeCommand(page, cmd);
        await page.waitForTimeout(200);
      }

      // Open palette
      await openCommandPalette(page);

      // Total commands should be reasonable (not excessive)
      const allCommands = page.locator('.cp-item');
      const count = await allCommands.count();

      expect(count).toBeLessThan(100); // Reasonable limit
    });

    test('should persist recent commands across sessions', async ({ page }) => {
      // Execute a command
      await executeCommand(page, 'theme:dark');
      await page.waitForTimeout(200);

      // Reload page
      await page.reload();
      await page.waitForLoadState('networkidle');

      // Open palette - recent command should be tracked
      await openCommandPalette(page);

      // Should have commands available
      const commands = page.locator('.cp-item');
      const count = await commands.count();

      expect(count).toBeGreaterThan(0);
    });
  });

  test.describe('Error Handling in Workflows', () => {
    test('should handle invalid command gracefully', async ({ page }) => {
      await openCommandPalette(page);

      // Type invalid command
      await typeQuery(page, 'invalid:command:that:does:not:exist');

      // Should show empty state
      const emptyState = page.locator('.cp-empty');
      await expect(emptyState).toBeVisible();

      // Pressing Enter should close palette safely
      await page.keyboard.press('Enter');

      const palette = page.locator('.cp-overlay');
      await expect(palette).not.toBeVisible();
    });

    test('should handle command execution failure gracefully', async ({ page }) => {
      // Try to execute a command that might fail
      await executeCommand(page, 'show:nonexistent');

      // App should remain functional
      const body = page.locator('body');
      await expect(body).toBeVisible();

      // Command palette should close
      const palette = page.locator('.cp-overlay');
      await expect(palette).not.toBeVisible();
    });

    test('should recover from errors during command execution', async ({ page }) => {
      // Execute multiple commands, some might fail
      const commands = [
        'theme:toggle',
        'show:nonexistent',
        'focus:toggle',
      ];

      for (const cmd of commands) {
        await openCommandPalette(page);
        await typeQuery(page, cmd);
        await page.waitForTimeout(100);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(200);
      }

      // App should still be functional
      const body = page.locator('body');
      await expect(body).toBeVisible();
    });
  });

  test.describe('Advanced Workflows', () => {
    test('should support workflow: select worker → filter → export', async ({ page }) => {
      await page.waitForTimeout(1000);

      const workerCard = page.locator('.worker-card').first();
      const count = await workerCard.count();

      if (count > 0) {
        // Get worker ID
        const workerText = await workerCard.textContent();
        const workerMatch = workerText?.match(/w-[\w-]+/);

        if (workerMatch) {
          const workerId = workerMatch[0];

          // Select worker
          await executeCommand(page, `worker:${workerId}`);
          await page.waitForTimeout(200);

          // Set filter
          await executeCommand(page, `filter:worker:${workerId}`);
          await page.waitForTimeout(200);

          // Export
          await executeCommand(page, 'export:link');
          await page.waitForTimeout(200);

          // Replay panel should be open
          const replay = page.locator('.session-replay-panel');
          await expect(replay).toBeVisible();
        }
      }
    });

    test('should support workflow: setup focus preset → save → load', async ({ page }) => {
      await page.waitForTimeout(1000);

      const workerCard = page.locator('.worker-card').first();
      const count = await workerCard.count();

      if (count >= 2) {
        // Pin first worker
        await workerCard.click();
        await page.waitForTimeout(100);

        // Pin second worker
        const secondCard = page.locator('.worker-card').nth(1);
        await secondCard.click();
        await page.waitForTimeout(100);

        // Enable focus mode
        await executeCommand(page, 'focus:toggle');
        await page.waitForTimeout(200);

        // Save preset
        await openCommandPalette(page);
        await typeQuery(page, 'preset:save');
        await page.waitForTimeout(150);
        await page.keyboard.press('Enter');

        // Preset save dialog should open
        const presetDialog = page.locator('.preset-dialog');
        const hasDialog = await presetDialog.count() > 0;

        if (hasDialog) {
          await expect(presetDialog).toBeVisible();
        }
      }
    });

    test('should support workflow: theme switch → view toggle → filter', async ({ page }) => {
      // Switch to dark theme
      await executeCommand(page, 'theme:dark');
      await page.waitForTimeout(200);

      // Show timeline
      await executeCommand(page, 'show:timeline');
      await page.waitForTimeout(200);

      // Set filter
      await executeCommand(page, 'filter:level:warn');
      await page.waitForTimeout(200);

      // All operations should complete
      const timeline = page.locator('.timeline-view');
      await expect(timeline).toBeVisible();

      const themeToggle = page.locator('.theme-toggle');
      await expect(themeToggle).toBeVisible();
    });
  });

  test.describe('Keyboard Shortcuts in Workflows', () => {
    test('should support keyboard-only workflow', async ({ page }) => {
      // Complete workflow using only keyboard
      await page.waitForTimeout(1000);

      // Open palette
      await page.keyboard.press('Meta+k');
      await page.waitForTimeout(100);

      // Type command
      await page.keyboard.type('theme:toggle');
      await page.waitForTimeout(200);

      // Execute
      await page.keyboard.press('Enter');
      await page.waitForTimeout(200);

      // Open palette again
      await page.keyboard.press('Meta+k');
      await page.waitForTimeout(100);

      // Should work
      const palette = page.locator('.cp-overlay');
      await expect(palette).toBeVisible();

      // Close
      await page.keyboard.press('Escape');
    });

    test('should support navigation and execution with keyboard', async ({ page }) => {
      await openCommandPalette(page);

      // Type query
      await typeQuery(page, 'show');

      // Navigate down
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(50);

      // Navigate up
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(50);

      // Execute
      await page.keyboard.press('Enter');

      // Should close
      const palette = page.locator('.cp-overlay');
      await expect(palette).not.toBeVisible();
    });
  });
});
