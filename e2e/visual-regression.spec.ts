import { test, expect, Page } from '@playwright/test';

const FIXED_NOW = Date.parse('2026-11-08T17:00:00.000Z');
const FIXED_NOW_ISO = new Date(FIXED_NOW).toISOString();

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 667 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

const THEMES = ['light', 'dark'] as const;
const STANDARD_SECTORS = ['core', 'secondary', 'tertiary'] as const;
type StandardSector = (typeof STANDARD_SECTORS)[number];

interface TestEvent {
  timestamp: string;
  ts: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  worker: string;
  tool?: string;
  message: string;
  raw: string;
  bead?: string;
  sequence: number;
}

interface TestWorker {
  id: string;
  lastSeen: string;
  lastActivity: number;
  eventCount: number;
  beadsCompleted: number;
  currentBead: string | null;
  status: 'active' | 'idle' | 'error';
  needleState: 'WORKING' | 'SELECTING' | 'STOPPED';
  currentTool?: string;
  recentEvents: TestEvent[];
  host: string;
  rssKb: number;
  peakRssKb: number;
  rssLimitBytes: number;
  rssPercent: number;
  swapKb: number;
}

function makeEvent(
  worker: string,
  secondsAgo: number,
  level: TestEvent['level'],
  message: string,
  sequence: number,
  options: Pick<TestEvent, 'tool' | 'bead'> = {},
): TestEvent {
  const ts = FIXED_NOW - secondsAgo * 1000;
  return {
    timestamp: new Date(ts).toISOString(),
    ts,
    level,
    worker,
    message,
    raw: message,
    sequence,
    ...options,
  };
}

const events: TestEvent[] = [
  makeEvent('alpha', 540, 'info', 'Claimed dashboard visual regression bead', 1, { tool: 'bead', bead: 'fabric-visual' }),
  makeEvent('alpha', 420, 'debug', 'Reading src/web/frontend/src/App.tsx', 2, { tool: 'Read', bead: 'fabric-visual' }),
  makeEvent('alpha', 280, 'info', 'Implementing deterministic screenshot fixture', 3, { tool: 'Edit', bead: 'fabric-visual' }),
  makeEvent('alpha', 45, 'info', 'Running browser checks', 4, { tool: 'Playwright', bead: 'fabric-visual' }),
  makeEvent('bravo', 500, 'info', 'Reviewing responsive layout', 5, { tool: 'Grep', bead: 'fabric-layout' }),
  makeEvent('bravo', 310, 'warn', 'Narrow viewport needs a second pass', 6, { tool: 'Test', bead: 'fabric-layout' }),
  makeEvent('bravo', 150, 'info', 'Updated visual baseline', 7, { tool: 'Write', bead: 'fabric-layout' }),
  makeEvent('charlie', 460, 'error', 'A snapshot differs from the expected baseline', 8, { tool: 'Expect', bead: 'fabric-layout' }),
  makeEvent('charlie', 220, 'info', 'Captured the corrected screenshot', 9, { tool: 'Screenshot', bead: 'fabric-layout' }),
];

const workers: TestWorker[] = [
  {
    id: 'alpha',
    lastSeen: FIXED_NOW_ISO,
    lastActivity: FIXED_NOW - 45_000,
    eventCount: 4,
    beadsCompleted: 12,
    currentBead: 'fabric-visual',
    status: 'active',
    needleState: 'WORKING',
    currentTool: 'Playwright',
    recentEvents: events.filter(event => event.worker === 'alpha'),
    host: 'codinghome',
    rssKb: 128_000,
    peakRssKb: 154_000,
    rssLimitBytes: 512 * 1024 * 1024,
    rssPercent: 24,
    swapKb: 0,
  },
  {
    id: 'bravo',
    lastSeen: new Date(FIXED_NOW - 150_000).toISOString(),
    lastActivity: FIXED_NOW - 150_000,
    eventCount: 3,
    beadsCompleted: 8,
    currentBead: 'fabric-layout',
    status: 'idle',
    needleState: 'SELECTING',
    currentTool: 'Test',
    recentEvents: events.filter(event => event.worker === 'bravo'),
    host: 'codinghome',
    rssKb: 96_000,
    peakRssKb: 110_000,
    rssLimitBytes: 512 * 1024 * 1024,
    rssPercent: 18,
    swapKb: 0,
  },
  {
    id: 'charlie',
    lastSeen: new Date(FIXED_NOW - 220_000).toISOString(),
    lastActivity: FIXED_NOW - 220_000,
    eventCount: 2,
    beadsCompleted: 5,
    currentBead: null,
    status: 'error',
    needleState: 'STOPPED',
    currentTool: 'Screenshot',
    recentEvents: events.filter(event => event.worker === 'charlie'),
    host: 'codinghome',
    rssKb: 84_000,
    peakRssKb: 102_000,
    rssLimitBytes: 512 * 1024 * 1024,
    rssPercent: 16,
    swapKb: 0,
  },
];

const themeApiBody = (theme: string) => JSON.stringify({ theme });

async function prepareVisualState(page: Page, theme: (typeof THEMES)[number], viewport: typeof VIEWPORTS[number]): Promise<void> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });

  await page.addInitScript(({ theme, now }) => {
    localStorage.setItem('fabric-theme', theme);
    localStorage.removeItem('fabric-focus-mode');
    localStorage.removeItem('fabric-recent-commands');

    const originalDateNow = Date.now;
    Date.now = () => now;
    window.addEventListener('unload', () => {
      Date.now = originalDateNow;
    });
  }, { theme, now: FIXED_NOW });

  await page.route('**/api/theme', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: themeApiBody(theme),
    });
  });

  await page.route('**/api/cost/summary', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        budget: {
          limit: 100,
          spent: 20,
          percentUsed: 20,
          isOverBudget: false,
          warningLevel: 'none',
          remaining: 80,
        },
        burnRate: {
          costPerMinute: 0,
          minutesToExhaustion: null,
          timeToExhaustion: null,
          projectedTotalCost: 20,
          windowMinutes: 60,
          isHighBurnRate: false,
        },
      }),
    });
  });

  await page.route('**/api/recovery/suggestions', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '[]',
    });
  });

  await page.route('**/api/system/memory', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        cgroupUsagePercent: 42,
        cgroupUsage: 128 * 1024 * 1024,
        cgroupLimit: 512 * 1024 * 1024,
        cgroupHigh: null,
        cgroupSwapUsage: 0,
        oomKill: 0,
        underPressure: false,
        oomRisk: 'none',
        formatted: {
          cgroupUsage: '128MB',
          cgroupLimit: '512MB',
          cgroupSwapUsage: '0B',
        },
      }),
    });
  });

  await page.route('**/api/system/memory/history', async route => {
    const samples = [0, 1, 2, 3, 4].map((minutesAgo, index) => ({
      timestamp: FIXED_NOW - minutesAgo * 60_000,
      usage: (112 + index * 4) * 1024 * 1024,
      usagePercent: 36 + index * 2,
      swapUsage: 0,
    }));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ samples, count: samples.length }),
    });
  });

  await page.route('**/api/system/oom-state', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        oomKillCount: 0,
        lastOomAt: null,
        oomDetected: false,
        memoryCurrentAtOom: null,
        formattedMemoryCurrent: null,
      }),
    });
  });

  await page.routeWebSocket(/\/ws$/, ws => {
    ws.onMessage(() => {
      // The visual fixture only needs the initial dashboard state.
    });
    ws.send(JSON.stringify({
      type: 'init',
      data: { workers, recentEvents: events, alerts: [] },
    }));
  });

  await page.goto('/');
  await expect(page.locator('.connection-status.connected')).toBeVisible();
  await expect(page.locator('.worker-card')).toHaveCount(workers.length);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
      }
      #agentation-root,
      [data-agentation-root],
      [data-agentation-toolbar] {
        display: none !important;
      }
    `,
  });
  await page.evaluate(() => document.fonts?.ready);
  await expect(page.locator('.system-memory-loading')).toHaveCount(0);
  await page.waitForTimeout(100);
}

async function openSector(page: Page, sector: StandardSector): Promise<void> {
  if (sector === 'secondary') {
    await page.locator('.worker-card').filter({ hasText: 'alpha' }).click();
    await expect(page.locator('.worker-detail')).toBeVisible();
  } else if (sector === 'tertiary') {
    await page.locator('.command-palette-toggle').click();
    await expect(page.locator('.cp-overlay')).toBeVisible();
    await page.locator('.cp-input').fill('theme');
    await expect(page.locator('.cp-item')).not.toHaveCount(0);
  }
}

for (const viewport of VIEWPORTS) {
  for (const theme of THEMES) {
    for (const sector of STANDARD_SECTORS) {
      test(`${sector} sector at ${viewport.width}px in ${theme} theme`, async ({ page }) => {
        await prepareVisualState(page, theme, viewport);
        await openSector(page, sector);
        await expect(page).toHaveScreenshot(`${sector}-${theme}-${viewport.width}.png`, {
          animations: 'disabled',
          caret: 'hide',
          fullPage: true,
          maxDiffPixelRatio: 0.005,
          scale: 'css',
        });
      });
    }

    if (viewport.width === 375) {
      test(`mobile sector at ${viewport.width}px in ${theme} theme`, async ({ page }) => {
        await prepareVisualState(page, theme, viewport);
        await expect(page.locator('.main-content')).toHaveCSS('grid-template-columns', '375px');
        await expect(page).toHaveScreenshot(`mobile-sector-${theme}-${viewport.width}.png`, {
          animations: 'disabled',
          caret: 'hide',
          fullPage: true,
          maxDiffPixelRatio: 0.005,
          scale: 'css',
        });
      });
    }
  }
}
