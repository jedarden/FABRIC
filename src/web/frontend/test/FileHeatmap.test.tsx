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
});
