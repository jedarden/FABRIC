/**
 * Tests for DependencyDag component
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import DependencyDag from '../src/components/DependencyDag';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock graph data
const mockGraph = {
  components: [
    {
      nodes: [
        { id: 'bd-abc', title: 'Test bead', status: 'open', priority: 1, depth: 0, dependentCount: 2, dependencyCount: 0, isCriticalPath: true },
        { id: 'bd-def', title: 'Dependent bead', status: 'blocked', priority: 2, depth: 1, dependentCount: 0, dependencyCount: 1, isCriticalPath: false },
      ],
      edges: [{ from: 'bd-def', to: 'bd-abc', isCritical: true }],
      roots: ['bd-abc'],
      hasCycle: false,
      criticalPath: ['bd-abc'],
      maxDepth: 1,
    },
  ],
  totalNodes: 2,
  totalEdges: 1,
  totalComponents: 1,
  globalCriticalPath: ['bd-abc'],
  generatedAt: Date.now(),
};

const mockStats = {
  totalBeads: 2,
  blockedCount: 1,
  readyCount: 1,
  avgDependencies: 0.5,
  avgDependents: 1,
  maxDepth: 1,
  cycleCount: 0,
  criticalPathLength: 1,
  criticalPathBeads: 1,
};

// Helper to set up successful mock
const setupSuccessMock = (times: number = 1) => {
  for (let i = 0; i < times; i++) {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ graph: mockGraph, stats: mockStats }),
    });
  }
};

// Helper to set up error mock
const setupErrorMock = () => {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    statusText: 'Internal Server Error',
  });
};

describe('DependencyDag Component', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('Visibility', () => {
    it('should not render when visible is false', () => {
      render(<DependencyDag visible={false} onClose={() => {}} />);
      expect(screen.queryByText('Task Dependency DAG')).not.toBeInTheDocument();
    });

    it('should render when visible is true', async () => {
      setupSuccessMock();
      render(<DependencyDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('Task Dependency DAG')).toBeInTheDocument();
      });
    });
  });

  describe('View Modes', () => {
    it('should show tree view by default', async () => {
      setupSuccessMock();
      render(<DependencyDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText(/Tree View/)).toBeInTheDocument();
      });
    });

    it('should switch to blockers view when blockers button clicked', async () => {
      setupSuccessMock();
      render(<DependencyDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /blockers/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /blockers/i }));

      await waitFor(() => {
        expect(screen.getByText(/Blockers View/)).toBeInTheDocument();
      });
    });

    it('should switch to ready view when ready button clicked', async () => {
      setupSuccessMock();
      render(<DependencyDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /ready/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /ready/i }));

      await waitFor(() => {
        expect(screen.getByText(/Ready View/)).toBeInTheDocument();
      });
    });

    it('should switch to stats view when stats button clicked', async () => {
      setupSuccessMock();
      render(<DependencyDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /stats/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /stats/i }));

      await waitFor(() => {
        expect(screen.getByText(/Stats View/)).toBeInTheDocument();
      });
    });
  });

  describe('Stats View', () => {
    it('should display stats correctly', async () => {
      setupSuccessMock();
      render(<DependencyDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /stats/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /stats/i }));

      await waitFor(() => {
        expect(screen.getByText('Overview')).toBeInTheDocument();
      });
    });
  });

  describe('Close Button', () => {
    it('should call onClose when close button clicked', async () => {
      setupSuccessMock();
      const onClose = vi.fn();
      render(<DependencyDag visible={true} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /✕/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /✕/i }));
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('Refresh', () => {
    it('should call API on mount when visible', async () => {
      setupSuccessMock();
      render(<DependencyDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/dag?');
      });
    });

    it('should refresh when refresh button clicked', async () => {
      setupSuccessMock(2); // Need 2 calls - initial + refresh
      render(<DependencyDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('Error Handling', () => {
    it('should show error message when API fails', async () => {
      setupErrorMock();
      render(<DependencyDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText(/Error loading dependency graph/i)).toBeInTheDocument();
      });
    });
  });

  describe('Tree View', () => {
    it('should display critical path', async () => {
      setupSuccessMock();
      render(<DependencyDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText(/Critical path:/i)).toBeInTheDocument();
      });
    });

    it('should display bead nodes', async () => {
      setupSuccessMock();
      render(<DependencyDag visible={true} onClose={() => {}} />);

      // Look for any element containing the bead ID text
      await waitFor(() => {
        const beadElements = screen.getAllByText((content, element) => {
          return element?.classList?.contains('dag-node-id') && content.includes('bd-abc');
        });
        expect(beadElements.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Filter Options', () => {
    it('should cycle filters when filter button clicked', async () => {
      setupSuccessMock(2); // Need 2 calls - initial + filter refresh
      render(<DependencyDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /filter/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /filter/i }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });
    });
  });
});
