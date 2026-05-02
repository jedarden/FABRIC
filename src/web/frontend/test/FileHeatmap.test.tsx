/**
 * @jest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import FileHeatmap from '../src/components/FileHeatmap';
import { FileHeatmapEntry, FileHeatmapStats } from '../src/types';

// Helper to create mock Response objects
const createMockResponse = <T,>(data: T): { ok: boolean; json: () => Promise<T> } => ({
  ok: true,
  json: () => Promise.resolve(data),
});

// Mock fetch for API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('FileHeatmap Component', () => {
  const mockStats: FileHeatmapStats = {
    totalFiles: 10,
    totalModifications: 50,
    collisionFiles: 2,
    activeFiles: 5,
    heatDistribution: { cold: 4, warm: 3, hot: 2, critical: 1 },
    mostActiveDirectory: '/src/components',
    avgModificationsPerFile: 5,
  };

  const mockEntries: FileHeatmapEntry[] = [
    {
      path: '/src/components/Button.tsx',
      modifications: 15,
      heatLevel: 'critical',
      workers: [
        { workerId: 'w-alpha', modifications: 10, lastModified: Date.now(), percentage: 67 },
        { workerId: 'w-beta', modifications: 5, lastModified: Date.now(), percentage: 33 },
      ],
      firstModified: Date.now() - 100000,
      lastModified: Date.now(),
      hasCollision: true,
      activeWorkers: 2,
      avgModificationInterval: 5000,
    },
    {
      path: '/src/utils/helpers.ts',
      modifications: 8,
      heatLevel: 'hot',
      workers: [
        { workerId: 'w-alpha', modifications: 8, lastModified: Date.now(), percentage: 100 },
      ],
      firstModified: Date.now() - 50000,
      lastModified: Date.now(),
      hasCollision: false,
      activeWorkers: 1,
      avgModificationInterval: 3000,
    },
    {
      path: '/src/types.ts',
      modifications: 3,
      heatLevel: 'warm',
      workers: [
        { workerId: 'w-gamma', modifications: 3, lastModified: Date.now(), percentage: 100 },
      ],
      firstModified: Date.now() - 30000,
      lastModified: Date.now(),
      hasCollision: false,
      activeWorkers: 1,
      avgModificationInterval: 10000,
    },
  ];

  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  describe('Rendering', () => {
    it('should render heatmap panel when visible', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse(mockEntries))
        .mockResolvedValueOnce(createMockResponse(mockStats));

      render(<FileHeatmap visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('File Heatmap')).toBeInTheDocument();
      });
    });

    it('should not render when not visible', () => {
      render(<FileHeatmap visible={false} onClose={() => {}} />);

      expect(screen.queryByText('File Heatmap')).not.toBeInTheDocument();
    });

    it('should render stats section', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse(mockEntries))
        .mockResolvedValueOnce(createMockResponse(mockStats));

      render(<FileHeatmap visible={true} onClose={() => {}} />);

      await waitFor(() => {
        // Check for stats section
        expect(document.querySelector('.file-heatmap-stats')).toBeTruthy();
      });
    });

    it('should render file entries', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse(mockEntries))
        .mockResolvedValueOnce(createMockResponse(mockStats));

      render(<FileHeatmap visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('/src/components/Button.tsx')).toBeInTheDocument();
        expect(screen.getByText('/src/utils/helpers.ts')).toBeInTheDocument();
        expect(screen.getByText('/src/types.ts')).toBeInTheDocument();
      });
    });

    it('should show collision class on collision entries', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse(mockEntries))
        .mockResolvedValueOnce(createMockResponse(mockStats));

      render(<FileHeatmap visible={true} onClose={() => {}} />);

      await waitFor(() => {
        // Look for collision entry class
        const entries = document.querySelectorAll('.heatmap-entry.collision');
        expect(entries.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Interactions', () => {
    it('should call onClose when close button clicked', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse(mockEntries))
        .mockResolvedValueOnce(createMockResponse(mockStats));

      const onClose = vi.fn();
      render(<FileHeatmap visible={true} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getByText('File Heatmap')).toBeInTheDocument();
      });

      // Close button has × symbol
      const closeButton = document.querySelector('.file-heatmap-close');
      expect(closeButton).toBeTruthy();
      fireEvent.click(closeButton!);

      expect(onClose).toHaveBeenCalled();
    });

    it('should have collision toggle button', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse(mockEntries))
        .mockResolvedValueOnce(createMockResponse(mockStats));

      render(<FileHeatmap visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('File Heatmap')).toBeInTheDocument();
      });

      const collisionToggle = screen.getByRole('button', { name: /collisions/i });
      expect(collisionToggle).toBeTruthy();
    });

    it('should have sort button', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse(mockEntries))
        .mockResolvedValueOnce(createMockResponse(mockStats));

      render(<FileHeatmap visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('File Heatmap')).toBeInTheDocument();
      });

      const sortButton = screen.getByRole('button', { name: /sort.*modifications/i });
      expect(sortButton).toBeTruthy();
    });

    it('should have filter input', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse(mockEntries))
        .mockResolvedValueOnce(createMockResponse(mockStats));

      render(<FileHeatmap visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('File Heatmap')).toBeInTheDocument();
      });

      const filterInput = screen.getByPlaceholderText(/filter|directory/i);
      expect(filterInput).toBeTruthy();
    });

    it('should select entry for detail view', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse(mockEntries))
        .mockResolvedValueOnce(createMockResponse(mockStats));

      render(<FileHeatmap visible={true} onClose={() => {}} />);

      // Wait for entries to render
      await waitFor(() => {
        expect(screen.getByText('/src/components/Button.tsx')).toBeInTheDocument();
      });

      // Click on an entry
      const entry = screen.getByText('/src/components/Button.tsx');
      fireEvent.click(entry);

      // Should show detail panel
      await waitFor(() => {
        const detailPanel = document.querySelector('.file-heatmap-detail');
        expect(detailPanel).toBeTruthy();
      });
    });
  });

  describe('Error handling', () => {
    it('should show error message when fetch fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      render(<FileHeatmap visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText(/error/i)).toBeInTheDocument();
      });
    });

    it('should show loading state', () => {
      mockFetch.mockImplementationOnce(() => new Promise(() => {})); // Never resolves

      render(<FileHeatmap visible={true} onClose={() => {}} />);

      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });

    it('should show empty state when no entries', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse([]))
        .mockResolvedValueOnce(createMockResponse(mockStats));

      render(<FileHeatmap visible={true} onClose={() => {}} />);

      // Wait for loading to complete and empty state to show
      await waitFor(() => {
        const emptyState = document.querySelector('.heatmap-empty');
        expect(emptyState).toBeTruthy();
      });
    });
  });

  describe('Heat levels', () => {
    it('should render heat bar fills', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse(mockEntries))
        .mockResolvedValueOnce(createMockResponse(mockStats));

      render(<FileHeatmap visible={true} onClose={() => {}} />);

      await waitFor(() => {
        // Check for heat bar fills
        const heatBars = document.querySelectorAll('.heat-bar-fill');
        expect(heatBars.length).toBeGreaterThan(0);
      });
    });

    it('should show heat distribution in stats', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse(mockEntries))
        .mockResolvedValueOnce(createMockResponse(mockStats));

      render(<FileHeatmap visible={true} onClose={() => {}} />);

      await waitFor(() => {
        // Check heat distribution section exists
        const distribution = document.querySelector('.heat-distribution');
        expect(distribution).toBeTruthy();
      });
    });
  });

  describe('Treemap view', () => {
    it('should have view mode toggle buttons', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse(mockEntries))
        .mockResolvedValueOnce(createMockResponse(mockStats));

      render(<FileHeatmap visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('File Heatmap')).toBeInTheDocument();
      });

      const listButton = screen.getByRole('button', { name: /list/i });
      const treemapButton = screen.getByRole('button', { name: /treemap/i });
      expect(listButton).toBeTruthy();
      expect(treemapButton).toBeTruthy();
    });

    it('should switch to treemap view when treemap button clicked', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse(mockEntries))
        .mockResolvedValueOnce(createMockResponse(mockStats));

      render(<FileHeatmap visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('File Heatmap')).toBeInTheDocument();
      });

      const treemapButton = screen.getByRole('button', { name: /treemap/i });
      fireEvent.click(treemapButton);

      await waitFor(() => {
        const treemapContainer = document.querySelector('.heatmap-treemap-container');
        expect(treemapContainer).toBeTruthy();
      });
    });

    it('should render treemap nodes', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse(mockEntries))
        .mockResolvedValueOnce(createMockResponse(mockStats));

      render(<FileHeatmap visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('File Heatmap')).toBeInTheDocument();
      });

      const treemapButton = screen.getByRole('button', { name: /treemap/i });
      fireEvent.click(treemapButton);

      await waitFor(() => {
        const treemapNodes = document.querySelectorAll('.treemap-node');
        expect(treemapNodes.length).toBe(mockEntries.length);
      });
    });

    it('should hide sort button in treemap mode', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse(mockEntries))
        .mockResolvedValueOnce(createMockResponse(mockStats));

      render(<FileHeatmap visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('File Heatmap')).toBeInTheDocument();
      });

      // Sort button should be visible in list mode
      const sortButton = screen.getByRole('button', { name: /sort.*modifications/i });
      expect(sortButton).toBeTruthy();

      const treemapButton = screen.getByRole('button', { name: /treemap/i });
      fireEvent.click(treemapButton);

      // Sort button should be hidden in treemap mode
      await waitFor(() => {
        const sortButtonAfter = document.querySelector('button[title="Cycle sort mode"]');
        expect(sortButtonAfter).toBeFalsy();
      });
    });

    it('should show tooltip when hovering treemap node', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse(mockEntries))
        .mockResolvedValueOnce(createMockResponse(mockStats));

      render(<FileHeatmap visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('File Heatmap')).toBeInTheDocument();
      });

      const treemapButton = screen.getByRole('button', { name: /treemap/i });
      fireEvent.click(treemapButton);

      await waitFor(() => {
        const treemapNodes = document.querySelectorAll('.treemap-node');
        expect(treemapNodes.length).toBeGreaterThan(0);
      });

      const firstNode = document.querySelector('.treemap-node');
      expect(firstNode).toBeTruthy();

      // Trigger mouse enter
      fireEvent.mouseEnter(firstNode!);

      await waitFor(() => {
        const tooltip = document.querySelector('.treemap-tooltip');
        expect(tooltip).toBeTruthy();
      });

      // Trigger mouse leave
      fireEvent.mouseLeave(firstNode!);

      await waitFor(() => {
        const tooltip = document.querySelector('.treemap-tooltip');
        expect(tooltip).toBeFalsy();
      });
    });
  });

  describe('Timelapse animation', () => {
    const mockTimelapse = {
      startTimestamp: Date.now() - 100000,
      endTimestamp: Date.now(),
      interval: 2000,
      totalSnapshots: 5,
      snapshots: [
        {
          timestamp: Date.now() - 100000,
          entries: [
            {
              path: '/src/early.ts',
              modifications: 2,
              heatLevel: 'cold' as const,
              workers: [{ workerId: 'w-alpha', modifications: 2, lastModified: Date.now() - 90000, percentage: 100 }],
              firstModified: Date.now() - 100000,
              lastModified: Date.now() - 90000,
              hasCollision: false,
              activeWorkers: 1,
              avgModificationInterval: 5000,
            },
          ],
          stats: {
            totalFiles: 1,
            totalModifications: 2,
            collisionFiles: 0,
            activeFiles: 1,
            heatDistribution: { cold: 1, warm: 0, hot: 0, critical: 0 },
            mostActiveDirectory: '/src',
            avgModificationsPerFile: 2,
          },
        },
        {
          timestamp: Date.now() - 50000,
          entries: [
            {
              path: '/src/early.ts',
              modifications: 5,
              heatLevel: 'warm' as const,
              workers: [{ workerId: 'w-alpha', modifications: 5, lastModified: Date.now() - 50000, percentage: 100 }],
              firstModified: Date.now() - 100000,
              lastModified: Date.now() - 50000,
              hasCollision: false,
              activeWorkers: 1,
              avgModificationInterval: 10000,
            },
            {
              path: '/src/mid.ts',
              modifications: 3,
              heatLevel: 'warm' as const,
              workers: [{ workerId: 'w-beta', modifications: 3, lastModified: Date.now() - 50000, percentage: 100 }],
              firstModified: Date.now() - 60000,
              lastModified: Date.now() - 50000,
              hasCollision: false,
              activeWorkers: 1,
              avgModificationInterval: 5000,
            },
          ],
          stats: {
            totalFiles: 2,
            totalModifications: 8,
            collisionFiles: 0,
            activeFiles: 2,
            heatDistribution: { cold: 0, warm: 2, hot: 0, critical: 0 },
            mostActiveDirectory: '/src',
            avgModificationsPerFile: 4,
          },
        },
      ],
    };

    it('should have timelapse view mode button', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse(mockEntries))
        .mockResolvedValueOnce(createMockResponse(mockStats));

      render(<FileHeatmap visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('File Heatmap')).toBeInTheDocument();
      });

      const timelapseButton = screen.getByRole('button', { name: /timelapse/i });
      expect(timelapseButton).toBeTruthy();
    });

    it('should switch to timelapse view when timelapse button clicked', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse(mockEntries))
        .mockResolvedValueOnce(createMockResponse(mockStats))
        .mockResolvedValueOnce(createMockResponse(mockTimelapse));

      render(<FileHeatmap visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('File Heatmap')).toBeInTheDocument();
      });

      const timelapseButton = screen.getByRole('button', { name: /timelapse/i });
      fireEvent.click(timelapseButton);

      // Should show timelapse controls after switching
      await waitFor(() => {
        const controls = document.querySelector('.timelapse-controls');
        expect(controls).toBeTruthy();
      });
    });

    it('should fetch timelapse data when entering timelapse mode', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse(mockEntries))
        .mockResolvedValueOnce(createMockResponse(mockStats))
        .mockResolvedValueOnce(createMockResponse(mockTimelapse));

      render(<FileHeatmap visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('File Heatmap')).toBeInTheDocument();
      });

      const timelapseButton = screen.getByRole('button', { name: /timelapse/i });
      fireEvent.click(timelapseButton);

      // Should show timelapse controls after data loads
      await waitFor(() => {
        const controls = document.querySelector('.timelapse-controls');
        expect(controls).toBeTruthy();
      });
    });

    it('should display timelapse playback controls when data loaded', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse(mockEntries))
        .mockResolvedValueOnce(createMockResponse(mockStats))
        .mockResolvedValueOnce(createMockResponse(mockTimelapse));

      const { container } = render(<FileHeatmap visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('File Heatmap')).toBeInTheDocument();
      });

      const timelapseButton = screen.getByRole('button', { name: /timelapse/i });
      fireEvent.click(timelapseButton);

      await waitFor(() => {
        const playbackControls = container.querySelector('.timelapse-playback');
        expect(playbackControls).toBeTruthy();
      });
    });

    it('should have play/pause button in timelapse mode', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse(mockEntries))
        .mockResolvedValueOnce(createMockResponse(mockStats))
        .mockResolvedValueOnce(createMockResponse(mockTimelapse));

      const { container } = render(<FileHeatmap visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('File Heatmap')).toBeInTheDocument();
      });

      const timelapseButton = screen.getByRole('button', { name: /timelapse/i });
      fireEvent.click(timelapseButton);

      await waitFor(() => {
        const playButton = container.querySelector('.timelapse-playback button');
        expect(playButton).toBeTruthy();
      });
    });

    it('should have speed controls in timelapse mode', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse(mockEntries))
        .mockResolvedValueOnce(createMockResponse(mockStats))
        .mockResolvedValueOnce(createMockResponse(mockTimelapse));

      const { container } = render(<FileHeatmap visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('File Heatmap')).toBeInTheDocument();
      });

      const timelapseButton = screen.getByRole('button', { name: /timelapse/i });
      fireEvent.click(timelapseButton);

      await waitFor(() => {
        const speedControls = container.querySelector('.timelapse-speed');
        expect(speedControls).toBeTruthy();
      });
    });

    it('should have timeline slider in timelapse mode', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse(mockEntries))
        .mockResolvedValueOnce(createMockResponse(mockStats))
        .mockResolvedValueOnce(createMockResponse(mockTimelapse));

      const { container } = render(<FileHeatmap visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('File Heatmap')).toBeInTheDocument();
      });

      const timelapseButton = screen.getByRole('button', { name: /timelapse/i });
      fireEvent.click(timelapseButton);

      await waitFor(() => {
        const timelapseSlider = container.querySelector('.timelapse-slider');
        expect(timelapseSlider).toBeTruthy();
      });
    });

    it('should have loop checkbox in timelapse mode', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse(mockEntries))
        .mockResolvedValueOnce(createMockResponse(mockStats))
        .mockResolvedValueOnce(createMockResponse(mockTimelapse));

      const { container } = render(<FileHeatmap visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('File Heatmap')).toBeInTheDocument();
      });

      const timelapseButton = screen.getByRole('button', { name: /timelapse/i });
      fireEvent.click(timelapseButton);

      await waitFor(() => {
        const loopLabel = container.querySelector('.timelapse-loop');
        expect(loopLabel).toBeTruthy();
      });
    });

    it('should show timeline labels with time and progress', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse(mockEntries))
        .mockResolvedValueOnce(createMockResponse(mockStats))
        .mockResolvedValueOnce(createMockResponse(mockTimelapse));

      const { container } = render(<FileHeatmap visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('File Heatmap')).toBeInTheDocument();
      });

      const timelapseButton = screen.getByRole('button', { name: /timelapse/i });
      fireEvent.click(timelapseButton);

      await waitFor(() => {
        const timelapseLabels = container.querySelector('.timelapse-labels');
        expect(timelapseLabels).toBeTruthy();
      });
    });

    it('should display loading state while fetching timelapse data', async () => {
      let resolveFetch: (value: unknown) => void;
      const fetchPromise = new Promise(resolve => {
        resolveFetch = resolve;
      });

      mockFetch
        .mockResolvedValueOnce(createMockResponse(mockEntries))
        .mockResolvedValueOnce(createMockResponse(mockStats))
        .mockReturnValueOnce(fetchPromise as any);

      render(<FileHeatmap visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('File Heatmap')).toBeInTheDocument();
      });

      const timelapseButton = screen.getByRole('button', { name: /timelapse/i });
      fireEvent.click(timelapseButton);

      await waitFor(() => {
        expect(screen.getByText(/generating timelapse/i)).toBeInTheDocument();
      });

      // Resolve the fetch
      resolveFetch!(createMockResponse(mockTimelapse));

      await waitFor(() => {
        expect(screen.queryByText(/generating timelapse/i)).not.toBeInTheDocument();
      });
    });

    it('should display error message on timelapse fetch failure', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse(mockEntries))
        .mockResolvedValueOnce(createMockResponse(mockStats))
        .mockRejectedValueOnce(new Error('Failed to fetch timelapse'));

      render(<FileHeatmap visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('File Heatmap')).toBeInTheDocument();
      });

      const timelapseButton = screen.getByRole('button', { name: /timelapse/i });
      fireEvent.click(timelapseButton);

      await waitFor(() => {
        expect(screen.getByText(/failed to fetch timelapse/i)).toBeInTheDocument();
      });
    });
  });
});
