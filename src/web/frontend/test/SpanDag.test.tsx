/**
 * Tests for SpanDag component
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import SpanDag from '../src/components/SpanDag';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock span DAG data
const mockSpanDag = {
  roots: [
    {
      span_id: 'span-1',
      name: 'HTTP GET /api/users',
      status: 'ok',
      trace_id: 'trace-abc',
      worker_id: 'w-alpha',
      bead_id: 'bd-123',
      parent_span_id: null,
      duration_ms: 1250,
      attributes: {
        'http.method': 'GET',
        'http.url': '/api/users',
        'http.status_code': '200',
      },
      children: [
        {
          span_id: 'span-2',
          name: 'DB Query: SELECT * FROM users',
          status: 'ok',
          trace_id: 'trace-abc',
          worker_id: 'w-alpha',
          bead_id: 'bd-123',
          parent_span_id: 'span-1',
          duration_ms: 450,
          attributes: {
            'db.system': 'postgresql',
            'db.statement': 'SELECT * FROM users',
          },
          children: [],
        },
        {
          span_id: 'span-3',
          name: 'JSON Serialize',
          status: 'ok',
          trace_id: 'trace-abc',
          worker_id: 'w-alpha',
          bead_id: 'bd-123',
          parent_span_id: 'span-1',
          duration_ms: 15,
          attributes: {
            'serialization.format': 'json',
          },
          children: [],
        },
      ],
    },
    {
      span_id: 'span-4',
      name: 'HTTP POST /api/logs',
      status: 'error',
      trace_id: 'trace-def',
      worker_id: 'w-bravo',
      bead_id: 'bd-124',
      parent_span_id: null,
      duration_ms: 3200,
      attributes: {
        'http.method': 'POST',
        'http.url': '/api/logs',
        'http.status_code': '500',
      },
      children: [],
    },
  ],
  traces: [
    { trace_id: 'trace-abc', span_count: 3 },
    { trace_id: 'trace-def', span_count: 1 },
  ],
  totalSpans: 4,
  generatedAt: Date.now(),
};

// Helper to set up successful mock
const setupSuccessMock = (times: number = 1) => {
  for (let i = 0; i < times; i++) {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockSpanDag),
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

describe('SpanDag Component', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('Visibility', () => {
    it('should not render when visible is false', () => {
      render(<SpanDag visible={false} onClose={() => {}} />);
      expect(screen.queryByText('Span DAG')).not.toBeInTheDocument();
    });

    it('should render when visible is true', async () => {
      setupSuccessMock();
      render(<SpanDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('Span DAG')).toBeInTheDocument();
      });
    });
  });

  describe('Data Loading', () => {
    it('should fetch span DAG on mount', async () => {
      setupSuccessMock();
      render(<SpanDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/spans/dag?');
      });
    });

    it('should display loading state', async () => {
      setupSuccessMock();
      render(<SpanDag visible={true} onClose={() => {}} />);

      expect(screen.getByText('Loading span DAG...')).toBeInTheDocument();
    });

    it('should display error state on fetch failure', async () => {
      setupErrorMock();
      render(<SpanDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText(/Error:/i)).toBeInTheDocument();
      });
    });

    it('should refresh when refresh button clicked', async () => {
      setupSuccessMock(2);
      render(<SpanDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('Trace Filter', () => {
    it('should show trace filter when multiple traces exist', async () => {
      setupSuccessMock();
      render(<SpanDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('All (4)')).toBeInTheDocument();
      });
    });

    it('should filter by trace when trace button clicked', async () => {
      setupSuccessMock(2);
      render(<SpanDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('All (4)')).toBeInTheDocument();
      });

      // Click on a specific trace
      const traceButtons = screen.getAllByText(/trace-/i);
      if (traceButtons.length > 0) {
        fireEvent.click(traceButtons[0]);

        await waitFor(() => {
          expect(mockFetch).toHaveBeenCalledTimes(2);
        });
      }
    });

    it('should show all traces when "All" button clicked', async () => {
      setupSuccessMock(3);
      render(<SpanDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /All Traces/i })).toBeInTheDocument();
      });

      // First click a specific trace to change the filter
      const traceButtons = screen.getAllByText(/trace-/i);
      if (traceButtons.length > 0) {
        fireEvent.click(traceButtons[0]);

        await waitFor(() => {
          expect(mockFetch).toHaveBeenCalledTimes(2);
        });

        // Then click "All Traces" to reset the filter
        fireEvent.click(screen.getByRole('button', { name: /All Traces/i }));

        await waitFor(() => {
          expect(mockFetch).toHaveBeenCalledTimes(3);
        });
      }
    });
  });

  describe('Span Tree Display', () => {
    it('should display span nodes in tree format', async () => {
      setupSuccessMock();
      render(<SpanDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('HTTP GET /api/users')).toBeInTheDocument();
      });
    });

    it('should display span status icons', async () => {
      setupSuccessMock();
      render(<SpanDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('HTTP GET /api/users')).toBeInTheDocument();
      });

      // Check for success indicator
      const successSpans = screen.getAllByText('●');
      expect(successSpans.length).toBeGreaterThan(0);
    });

    it('should display child spans with indentation', async () => {
      setupSuccessMock();
      render(<SpanDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('DB Query: SELECT * FROM users')).toBeInTheDocument();
      });
    });

    it('should display span duration', async () => {
      setupSuccessMock();
      render(<SpanDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('1.3s')).toBeInTheDocument();
      });
    });
  });

  describe('Span Detail Panel', () => {
    it('should show detail panel when span clicked', async () => {
      setupSuccessMock();
      render(<SpanDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('HTTP GET /api/users')).toBeInTheDocument();
      });

      // Click on a span node
      const spanNode = screen.getByText('HTTP GET /api/users');
      fireEvent.click(spanNode);

      await waitFor(() => {
        expect(screen.getByText('Span Detail')).toBeInTheDocument();
      });
    });

    it('should display span attributes in detail panel', async () => {
      setupSuccessMock();
      render(<SpanDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('HTTP GET /api/users')).toBeInTheDocument();
      });

      const spanNode = screen.getByText('HTTP GET /api/users');
      fireEvent.click(spanNode);

      await waitFor(() => {
        expect(screen.getByText('Attributes:')).toBeInTheDocument();
      });
    });
  });

  describe('Stats Bar', () => {
    it('should display stats bar', async () => {
      setupSuccessMock();
      render(<SpanDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('Total Spans:')).toBeInTheDocument();
      });
    });

    it('should display total spans count', async () => {
      setupSuccessMock();
      render(<SpanDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('Total Spans:')).toBeInTheDocument();
        const statsValue = screen.getByText('4', { selector: '.dag-stats-value' });
        expect(statsValue).toBeInTheDocument();
      });
    });

    it('should display trace count', async () => {
      setupSuccessMock();
      render(<SpanDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('Traces:')).toBeInTheDocument();
      });
    });
  });

  describe('Close Button', () => {
    it('should call onClose when close button clicked', async () => {
      setupSuccessMock();
      const onClose = vi.fn();
      render(<SpanDag visible={true} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /close/i }));
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('Zoom and Pan', () => {
    it('should have zoom controls available', async () => {
      setupSuccessMock();
      render(<SpanDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('Span DAG')).toBeInTheDocument();
      });

      // Check for zoom buttons
      const zoomOutBtn = screen.getByTitle('Zoom out (- or − key)');
      const zoomInBtn = screen.getByTitle('Zoom in (+ or = key)');
      expect(zoomOutBtn).toBeInTheDocument();
      expect(zoomInBtn).toBeInTheDocument();
    });

    it('should display current zoom level', async () => {
      setupSuccessMock();
      render(<SpanDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('100%')).toBeInTheDocument();
      });
    });

    it('should zoom in when zoom in button clicked', async () => {
      setupSuccessMock();
      render(<SpanDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('100%')).toBeInTheDocument();
      });

      const zoomInBtn = screen.getByTitle('Zoom in (+ or = key)');
      fireEvent.click(zoomInBtn);

      await waitFor(() => {
        expect(screen.getByText('125%')).toBeInTheDocument();
      });
    });

    it('should zoom out when zoom out button clicked', async () => {
      setupSuccessMock();
      render(<SpanDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('100%')).toBeInTheDocument();
      });

      const zoomOutBtn = screen.getByTitle('Zoom out (- or − key)');
      fireEvent.click(zoomOutBtn);

      await waitFor(() => {
        expect(screen.getByText('75%')).toBeInTheDocument();
      });
    });

    it('should respect minimum zoom limit (25%)', async () => {
      setupSuccessMock();
      render(<SpanDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('Span DAG')).toBeInTheDocument();
      });

      const zoomOutBtn = screen.getByTitle('Zoom out (- or − key)');

      // Click zoom out many times to hit minimum
      for (let i = 0; i < 10; i++) {
        fireEvent.click(zoomOutBtn);
      }

      // Should not go below 25%
      await waitFor(() => {
        expect(screen.getByText('25%')).toBeInTheDocument();
      });

      // Button should be disabled at minimum
      expect(zoomOutBtn).toBeDisabled();
    });

    it('should respect maximum zoom limit (400%)', async () => {
      setupSuccessMock();
      render(<SpanDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('Span DAG')).toBeInTheDocument();
      });

      const zoomInBtn = screen.getByTitle('Zoom in (+ or = key)');

      // Click zoom in many times to hit maximum (12 clicks: 100% + 12*25% = 400%)
      for (let i = 0; i < 12; i++) {
        fireEvent.click(zoomInBtn);
      }

      // Should not exceed 400%
      await waitFor(() => {
        expect(screen.getByText('400%')).toBeInTheDocument();
      });

      // Button should be disabled at maximum
      expect(zoomInBtn).toBeDisabled();
    });

    it('should show reset button when zoomed or panned', async () => {
      setupSuccessMock();
      render(<SpanDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('Span DAG')).toBeInTheDocument();
      });

      // Reset button should not be visible initially
      expect(screen.queryByTitle('Reset zoom and pan (0 key)')).not.toBeInTheDocument();

      // Zoom in
      const zoomInBtn = screen.getByTitle('Zoom in (+ or = key)');
      fireEvent.click(zoomInBtn);

      // Reset button should appear
      await waitFor(() => {
        expect(screen.getByTitle('Reset zoom and pan (0 key)')).toBeInTheDocument();
      });
    });

    it('should reset zoom and pan when reset button clicked', async () => {
      setupSuccessMock();
      render(<SpanDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('Span DAG')).toBeInTheDocument();
      });

      // Zoom in
      const zoomInBtn = screen.getByTitle('Zoom in (+ or = key)');
      fireEvent.click(zoomInBtn);

      await waitFor(() => {
        expect(screen.getByText('125%')).toBeInTheDocument();
      });

      // Click reset
      const resetBtn = screen.getByTitle('Reset zoom and pan (0 key)');
      fireEvent.click(resetBtn);

      // Should return to 100%
      await waitFor(() => {
        expect(screen.getByText('100%')).toBeInTheDocument();
      });

      // Reset button should disappear
      expect(screen.queryByTitle('Reset zoom and pan (0 key)')).not.toBeInTheDocument();
    });

    it('should zoom on mouse wheel', async () => {
      setupSuccessMock();
      render(<SpanDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('Span DAG')).toBeInTheDocument();
      });

      const treeContainer = screen.getByText('HTTP GET /api/users').closest('.dag-tree-container');
      expect(treeContainer).toBeInTheDocument();

      if (treeContainer) {
        // Scroll up (zoom in)
        fireEvent.wheel(treeContainer, { deltaY: -100 });

        await waitFor(() => {
          expect(screen.getByText('125%')).toBeInTheDocument();
        });

        // Scroll down (zoom out)
        fireEvent.wheel(treeContainer, { deltaY: 100 });

        await waitFor(() => {
          expect(screen.getByText('100%')).toBeInTheDocument();
        });
      }
    });

    it('should start dragging on mouse down', async () => {
      setupSuccessMock();
      render(<SpanDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('HTTP GET /api/users')).toBeInTheDocument();
      });

      const treeContainer = screen.getByText('HTTP GET /api/users').closest('.dag-tree-container');
      expect(treeContainer).toBeInTheDocument();

      if (treeContainer) {
        // Mouse down should start dragging
        fireEvent.mouseDown(treeContainer, { clientX: 100, clientY: 100 });

        // Check for grab cursor (applied via inline style)
        await waitFor(() => {
          expect(treeContainer).toHaveStyle({ cursor: 'grabbing' });
        });

        // Clean up - mouse up
        fireEvent.mouseUp(treeContainer);
      }
    });

    it('should pan on mouse drag', async () => {
      setupSuccessMock();
      render(<SpanDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('HTTP GET /api/users')).toBeInTheDocument();
      });

      const treeContainer = screen.getByText('HTTP GET /api/users').closest('.dag-tree-container');
      expect(treeContainer).toBeInTheDocument();

      if (treeContainer) {
        // Mouse down
        fireEvent.mouseDown(treeContainer, { clientX: 100, clientY: 100 });

        // Mouse move should pan
        fireEvent.mouseMove(treeContainer, { clientX: 150, clientY: 120 });

        // Reset button should appear after panning
        await waitFor(() => {
          expect(screen.getByTitle('Reset zoom and pan (0 key)')).toBeInTheDocument();
        });

        // Clean up
        fireEvent.mouseUp(treeContainer);
      }
    });

    it('should stop dragging on mouse up', async () => {
      setupSuccessMock();
      render(<SpanDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('HTTP GET /api/users')).toBeInTheDocument();
      });

      const treeContainer = screen.getByText('HTTP GET /api/users').closest('.dag-tree-container');
      expect(treeContainer).toBeInTheDocument();

      if (treeContainer) {
        // Mouse down
        fireEvent.mouseDown(treeContainer, { clientX: 100, clientY: 100 });

        await waitFor(() => {
          expect(treeContainer).toHaveStyle({ cursor: 'grabbing' });
        });

        // Mouse up
        fireEvent.mouseUp(treeContainer);

        await waitFor(() => {
          expect(treeContainer).toHaveStyle({ cursor: 'default' });
        });
      }
    });

    it('should stop dragging on mouse leave', async () => {
      setupSuccessMock();
      render(<SpanDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('HTTP GET /api/users')).toBeInTheDocument();
      });

      const treeContainer = screen.getByText('HTTP GET /api/users').closest('.dag-tree-container');
      expect(treeContainer).toBeInTheDocument();

      if (treeContainer) {
        // Mouse down
        fireEvent.mouseDown(treeContainer, { clientX: 100, clientY: 100 });

        await waitFor(() => {
          expect(treeContainer).toHaveStyle({ cursor: 'grabbing' });
        });

        // Mouse leave
        fireEvent.mouseLeave(treeContainer);

        await waitFor(() => {
          expect(treeContainer).not.toHaveStyle({ cursor: 'grabbing' });
        });
      }
    });

    it('should show grab cursor when zoomed or panned', async () => {
      setupSuccessMock();
      render(<SpanDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('HTTP GET /api/users')).toBeInTheDocument();
      });

      const treeContainer = screen.getByText('HTTP GET /api/users').closest('.dag-tree-container');
      expect(treeContainer).toBeInTheDocument();

      if (treeContainer) {
        // Initially should show default cursor
        expect(treeContainer).toHaveStyle({ cursor: 'default' });

        // Zoom in
        const zoomInBtn = screen.getByTitle('Zoom in (+ or = key)');
        fireEvent.click(zoomInBtn);

        await waitFor(() => {
          expect(treeContainer).toHaveStyle({ cursor: 'grab' });
        });
      }
    });

    it('should handle middle mouse button for panning', async () => {
      setupSuccessMock();
      render(<SpanDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText('HTTP GET /api/users')).toBeInTheDocument();
      });

      const treeContainer = screen.getByText('HTTP GET /api/users').closest('.dag-tree-container');
      expect(treeContainer).toBeInTheDocument();

      if (treeContainer) {
        // Middle mouse button (button 1)
        fireEvent.mouseDown(treeContainer, { button: 1, clientX: 100, clientY: 100 });

        await waitFor(() => {
          expect(treeContainer).toHaveStyle({ cursor: 'grabbing' });
        });

        // Clean up
        fireEvent.mouseUp(treeContainer);
      }
    });
  });

  describe('Empty State', () => {
    it('should show empty state when no spans', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          roots: [],
          traces: [],
          totalSpans: 0,
          generatedAt: Date.now(),
        }),
      });

      render(<SpanDag visible={true} onClose={() => {}} />);

      await waitFor(() => {
        expect(screen.getByText(/No OTLP spans received yet/i)).toBeInTheDocument();
      });
    });
  });
});
