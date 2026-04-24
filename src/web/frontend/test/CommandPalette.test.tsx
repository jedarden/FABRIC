/**
 * Tests for CommandPalette component
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import CommandPalette from '../src/components/CommandPalette';
import { WorkerInfo, LogEvent } from '../src/types';

// jsdom does not implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

const RECENT_KEY = 'fabric-recent-commands';

const makeWorker = (overrides: Partial<WorkerInfo> = {}): WorkerInfo => ({
  id: 'worker-alpha',
  lastSeen: new Date().toISOString(),
  eventCount: 5,
  status: 'active',
  recentEvents: [],
  ...overrides,
});

const makeEvent = (overrides: Partial<LogEvent> = {}): LogEvent => ({
  timestamp: '2026-03-05T14:00:00.000Z',
  level: 'info',
  worker: 'worker-alpha',
  message: 'test message',
  raw: '{}',
  ...overrides,
});

const defaultProps = {
  visible: true,
  onClose: vi.fn(),
  onCommand: vi.fn(),
  workers: [],
  events: [],
};

describe('CommandPalette', () => {
  beforeEach(() => {
    localStorage.clear();
    defaultProps.onClose.mockClear();
    defaultProps.onCommand.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  describe('visibility', () => {
    it('renders when visible=true', () => {
      render(<CommandPalette {...defaultProps} visible={true} />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('renders nothing when visible=false', () => {
      render(<CommandPalette {...defaultProps} visible={false} />);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  describe('input field', () => {
    it('renders the search input with placeholder', () => {
      render(<CommandPalette {...defaultProps} />);
      const input = screen.getByPlaceholderText(/search commands/i);
      expect(input).toBeInTheDocument();
    });

    it('updates query as user types', () => {
      render(<CommandPalette {...defaultProps} />);
      const input = screen.getByPlaceholderText(/search commands/i);
      fireEvent.change(input, { target: { value: 'theme' } });
      expect((input as HTMLInputElement).value).toBe('theme');
    });
  });

  describe('default commands list', () => {
    it('shows commands when query is empty', () => {
      render(<CommandPalette {...defaultProps} />);
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      // Default commands include filter, view, focus, theme entries
      expect(screen.getByText('Clear all filters')).toBeInTheDocument();
      expect(screen.getByText('Toggle theme')).toBeInTheDocument();
    });

    it('shows category headers', () => {
      render(<CommandPalette {...defaultProps} />);
      expect(screen.getByText('Commands')).toBeInTheDocument();
    });
  });

  describe('fuzzy search', () => {
    it('filters commands to matching results', () => {
      render(<CommandPalette {...defaultProps} />);
      const input = screen.getByPlaceholderText(/search commands/i);
      fireEvent.change(input, { target: { value: 'theme' } });
      expect(screen.getByText('Toggle theme')).toBeInTheDocument();
      expect(screen.getByText('Dark theme')).toBeInTheDocument();
      expect(screen.queryByText('Clear all filters')).not.toBeInTheDocument();
    });

    it('shows empty state when no results match', () => {
      render(<CommandPalette {...defaultProps} />);
      const input = screen.getByPlaceholderText(/search commands/i);
      fireEvent.change(input, { target: { value: 'xyzxyzxyz' } });
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(screen.getByText(/no results/i)).toBeInTheDocument();
    });

    it('searches across workers', () => {
      const workers = [makeWorker({ id: 'worker-bravo', status: 'idle' })];
      render(<CommandPalette {...defaultProps} workers={workers} />);
      const input = screen.getByPlaceholderText(/search commands/i);
      fireEvent.change(input, { target: { value: 'bravo' } });
      // label text may be split by fuzzy highlight marks — match by element textContent
      expect(
        screen.getByText((_, el) => el?.textContent === 'worker-bravo'),
      ).toBeInTheDocument();
    });

    it('searches across beads from events', () => {
      const events = [makeEvent({ bead: 'bd-1234' })];
      render(<CommandPalette {...defaultProps} events={events} />);
      const input = screen.getByPlaceholderText(/search commands/i);
      fireEvent.change(input, { target: { value: 'bd-1234' } });
      expect(screen.getByText('bd-1234')).toBeInTheDocument();
    });

    it('searches across log message text', () => {
      const events = [makeEvent({ message: 'compiling typescript files' })];
      render(<CommandPalette {...defaultProps} events={events} />);
      const input = screen.getByPlaceholderText(/search commands/i);
      fireEvent.change(input, { target: { value: 'typescript' } });
      // label text may be split by fuzzy highlight marks — match by element textContent
      expect(
        screen.getByText((_, el) => el?.textContent === 'compiling typescript files'),
      ).toBeInTheDocument();
    });

    it('shows files from worker activeFiles', () => {
      const workers = [makeWorker({ activeFiles: ['src/auth/login.ts'] })];
      render(<CommandPalette {...defaultProps} workers={workers} />);
      const input = screen.getByPlaceholderText(/search commands/i);
      fireEvent.change(input, { target: { value: 'login' } });
      // label text may be split by fuzzy highlight marks — match by element textContent
      expect(
        screen.getByText((_, el) => el?.textContent === 'src/auth/login.ts'),
      ).toBeInTheDocument();
    });
  });

  describe('keyboard navigation', () => {
    it('closes on Escape key', () => {
      const onClose = vi.fn();
      render(<CommandPalette {...defaultProps} onClose={onClose} />);
      const input = screen.getByPlaceholderText(/search commands/i);
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes on Ctrl+K', () => {
      const onClose = vi.fn();
      render(<CommandPalette {...defaultProps} onClose={onClose} />);
      const input = screen.getByPlaceholderText(/search commands/i);
      fireEvent.keyDown(input, { key: 'k', ctrlKey: true });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes on Cmd+K (metaKey)', () => {
      const onClose = vi.fn();
      render(<CommandPalette {...defaultProps} onClose={onClose} />);
      const input = screen.getByPlaceholderText(/search commands/i);
      fireEvent.keyDown(input, { key: 'k', metaKey: true });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('moves selection down on ArrowDown', () => {
      render(<CommandPalette {...defaultProps} />);
      const input = screen.getByPlaceholderText(/search commands/i);
      // First item should be selected (index 0)
      const list = screen.getByRole('listbox');
      const firstItem = list.querySelector('[aria-selected="true"]');
      expect(firstItem).toBeInTheDocument();

      fireEvent.keyDown(input, { key: 'ArrowDown' });
      // After one down, second item selected
      const items = list.querySelectorAll('[role="option"]');
      expect(items[1]).toHaveAttribute('aria-selected', 'true');
    });

    it('moves selection up on ArrowUp', () => {
      render(<CommandPalette {...defaultProps} />);
      const input = screen.getByPlaceholderText(/search commands/i);
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'ArrowUp' });
      const list = screen.getByRole('listbox');
      const items = list.querySelectorAll('[role="option"]');
      expect(items[1]).toHaveAttribute('aria-selected', 'true');
    });

    it('does not go above index 0 on ArrowUp at top', () => {
      render(<CommandPalette {...defaultProps} />);
      const input = screen.getByPlaceholderText(/search commands/i);
      fireEvent.keyDown(input, { key: 'ArrowUp' });
      const list = screen.getByRole('listbox');
      const items = list.querySelectorAll('[role="option"]');
      expect(items[0]).toHaveAttribute('aria-selected', 'true');
    });

    it('executes selected command on Enter', () => {
      const onCommand = vi.fn();
      const onClose = vi.fn();
      render(<CommandPalette {...defaultProps} onCommand={onCommand} onClose={onClose} />);
      const input = screen.getByPlaceholderText(/search commands/i);
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onCommand).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('mouse interaction', () => {
    it('executes command on item click', () => {
      const onCommand = vi.fn();
      const onClose = vi.fn();
      render(<CommandPalette {...defaultProps} onCommand={onCommand} onClose={onClose} />);
      // Click the first option
      const items = screen.getAllByRole('option');
      fireEvent.click(items[0]);
      expect(onCommand).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('updates selected index on mouse enter', () => {
      render(<CommandPalette {...defaultProps} />);
      const items = screen.getAllByRole('option');
      fireEvent.mouseEnter(items[2]);
      expect(items[2]).toHaveAttribute('aria-selected', 'true');
    });

    it('closes on overlay backdrop click', () => {
      const onClose = vi.fn();
      render(<CommandPalette {...defaultProps} onClose={onClose} />);
      const overlay = screen.getByRole('dialog');
      fireEvent.click(overlay);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not close when clicking inside the modal', () => {
      const onClose = vi.fn();
      render(<CommandPalette {...defaultProps} onClose={onClose} />);
      const input = screen.getByPlaceholderText(/search commands/i);
      fireEvent.click(input);
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('recent commands', () => {
    it('tracks recently executed commands in localStorage', () => {
      const onCommand = vi.fn();
      render(<CommandPalette {...defaultProps} onCommand={onCommand} />);
      const items = screen.getAllByRole('option');
      fireEvent.click(items[0]);

      const saved = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
      expect(Array.isArray(saved)).toBe(true);
      expect(saved.length).toBeGreaterThan(0);
    });

    it('shows recent command first when query is empty', () => {
      // Pre-seed a recent command for 'refresh'
      localStorage.setItem(RECENT_KEY, JSON.stringify(['refresh']));

      render(<CommandPalette {...defaultProps} />);
      const items = screen.getAllByRole('option');
      // The first item should be 'Refresh connection'
      expect(items[0].textContent).toContain('Refresh connection');
    });

    it('boosts recently used commands in fuzzy search ranking', () => {
      localStorage.setItem(RECENT_KEY, JSON.stringify(['theme:dark']));

      render(<CommandPalette {...defaultProps} />);
      const input = screen.getByPlaceholderText(/search commands/i);
      fireEvent.change(input, { target: { value: 'dark' } });

      const items = screen.getAllByRole('option');
      // Dark theme should appear (boosted by recency)
      expect(items[0].textContent).toContain('Dark theme');
    });

    it('caps recent commands at 10', () => {
      const onCommand = vi.fn();
      // Pre-seed 10 commands
      const existing = Array.from({ length: 10 }, (_, i) => `cmd-${i}`);
      localStorage.setItem(RECENT_KEY, JSON.stringify(existing));

      render(<CommandPalette {...defaultProps} onCommand={onCommand} />);
      const items = screen.getAllByRole('option');
      fireEvent.click(items[0]);

      const saved = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
      expect(saved.length).toBeLessThanOrEqual(10);
    });

    it('does not add log entry actions to recent commands', () => {
      const events = [makeEvent({ message: 'deploy started', worker: 'worker-alpha' })];
      render(<CommandPalette {...defaultProps} events={events} onCommand={vi.fn()} />);
      const input = screen.getByPlaceholderText(/search commands/i);
      fireEvent.change(input, { target: { value: 'deploy' } });

      const items = screen.getAllByRole('option');
      fireEvent.click(items[0]);

      const saved = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
      // log: actions should not be persisted
      expect(saved.every((a: string) => !a.startsWith('log:'))).toBe(true);
    });
  });

  describe('dynamic suggestions from props', () => {
    it('shows worker entry per worker', () => {
      const workers = [
        makeWorker({ id: 'worker-alpha' }),
        makeWorker({ id: 'worker-bravo', status: 'idle' }),
      ];
      render(<CommandPalette {...defaultProps} workers={workers} />);
      const input = screen.getByPlaceholderText(/search commands/i);
      fireEvent.change(input, { target: { value: 'worker' } });
      expect(screen.getByText('worker-alpha')).toBeInTheDocument();
      expect(screen.getByText('worker-bravo')).toBeInTheDocument();
    });

    it('shows unique beads from events', () => {
      const events = [
        makeEvent({ bead: 'bd-001' }),
        makeEvent({ bead: 'bd-001' }), // duplicate
        makeEvent({ bead: 'bd-002' }),
      ];
      render(<CommandPalette {...defaultProps} events={events} />);
      const input = screen.getByPlaceholderText(/search commands/i);
      fireEvent.change(input, { target: { value: 'bd-' } });
      const items = screen.getAllByRole('option').filter(
        el => el.textContent?.includes('bd-'),
      );
      // Should have exactly 2 unique beads
      expect(items).toHaveLength(2);
    });

    it('shows log entries category header when log events match', () => {
      const events = [makeEvent({ message: 'something happened' })];
      render(<CommandPalette {...defaultProps} events={events} />);
      const input = screen.getByPlaceholderText(/search commands/i);
      fireEvent.change(input, { target: { value: 'happened' } });
      expect(screen.getByText('Log Entries')).toBeInTheDocument();
    });
  });

  describe('command execution', () => {
    it('calls onCommand with the action string', () => {
      const onCommand = vi.fn();
      render(<CommandPalette {...defaultProps} onCommand={onCommand} />);
      const input = screen.getByPlaceholderText(/search commands/i);
      fireEvent.change(input, { target: { value: 'heatmap' } });
      const items = screen.getAllByRole('option');
      fireEvent.click(items[0]);
      expect(onCommand).toHaveBeenCalledWith('show:heatmap');
    });

    it('calls onClose after executing a command', () => {
      const onClose = vi.fn();
      render(<CommandPalette {...defaultProps} onClose={onClose} />);
      const items = screen.getAllByRole('option');
      fireEvent.click(items[0]);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('accessibility', () => {
    it('has role=dialog on the overlay', () => {
      render(<CommandPalette {...defaultProps} />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('has aria-modal on the overlay', () => {
      render(<CommandPalette {...defaultProps} />);
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal');
    });

    it('has aria-label on the overlay', () => {
      render(<CommandPalette {...defaultProps} />);
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Command Palette');
    });

    it('has role=listbox on the results list', () => {
      render(<CommandPalette {...defaultProps} />);
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('has role=option on result items', () => {
      render(<CommandPalette {...defaultProps} />);
      const options = screen.getAllByRole('option');
      expect(options.length).toBeGreaterThan(0);
    });

    it('marks selected item with aria-selected=true', () => {
      render(<CommandPalette {...defaultProps} />);
      const selected = screen.getAllByRole('option').filter(
        el => el.getAttribute('aria-selected') === 'true',
      );
      expect(selected).toHaveLength(1);
    });
  });

  describe('footer keyboard hints', () => {
    it('renders navigation hints', () => {
      render(<CommandPalette {...defaultProps} />);
      expect(screen.getByText(/navigate/i)).toBeInTheDocument();
      expect(screen.getByText(/execute/i)).toBeInTheDocument();
      expect(screen.getByText(/close/i)).toBeInTheDocument();
    });

    it('mentions Cmd+K / Ctrl+K in footer', () => {
      render(<CommandPalette {...defaultProps} />);
      expect(screen.getByText(/Cmd\+K/i)).toBeInTheDocument();
    });
  });

  describe('CSS structure', () => {
    it('renders cp-overlay class', () => {
      const { container } = render(<CommandPalette {...defaultProps} />);
      expect(container.querySelector('.cp-overlay')).toBeInTheDocument();
    });

    it('renders cp-modal class', () => {
      const { container } = render(<CommandPalette {...defaultProps} />);
      expect(container.querySelector('.cp-modal')).toBeInTheDocument();
    });

    it('renders cp-input class', () => {
      const { container } = render(<CommandPalette {...defaultProps} />);
      expect(container.querySelector('.cp-input')).toBeInTheDocument();
    });

    it('renders cp-list class', () => {
      const { container } = render(<CommandPalette {...defaultProps} />);
      expect(container.querySelector('.cp-list')).toBeInTheDocument();
    });

    it('renders cp-item class for each result', () => {
      const { container } = render(<CommandPalette {...defaultProps} />);
      const items = container.querySelectorAll('.cp-item');
      expect(items.length).toBeGreaterThan(0);
    });

    it('applies cp-item--selected to the active item', () => {
      const { container } = render(<CommandPalette {...defaultProps} />);
      expect(container.querySelector('.cp-item--selected')).toBeInTheDocument();
    });

    it('renders cp-footer class', () => {
      const { container } = render(<CommandPalette {...defaultProps} />);
      expect(container.querySelector('.cp-footer')).toBeInTheDocument();
    });
  });

  describe('fuzzy highlight rendering', () => {
    it('renders cp-highlight marks when label uniquely matches query', () => {
      const { container } = render(<CommandPalette {...defaultProps} />);
      const input = container.querySelector('.cp-input')!;
      // "by" appears in label "Filter by worker" but not in action "filter:worker:"
      // so labelIndices will be non-empty and highlights will render
      fireEvent.change(input, { target: { value: 'by' } });
      const highlights = container.querySelectorAll('.cp-highlight');
      expect(highlights.length).toBeGreaterThan(0);
    });
  });
});
