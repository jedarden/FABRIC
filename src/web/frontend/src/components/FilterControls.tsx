import React, { useState, useEffect } from 'react';

export interface ActivityFilter {
  workerId?: string;
  level?: 'debug' | 'info' | 'warn' | 'error';
  search?: string;
  since?: number;
  until?: number;
}

interface FilterControlsProps {
  onFilterChange: (filter: ActivityFilter) => void;
  workers: string[];
  filteredCount: number;
  totalCount: number;
}

const FILTER_STORAGE_KEY = 'fabric-activity-filter';

const FilterControls: React.FC<FilterControlsProps> = ({
  onFilterChange,
  workers,
  filteredCount,
  totalCount,
}) => {
  const [workerId, setWorkerId] = useState('');
  const [level, setLevel] = useState('');
  const [search, setSearch] = useState('');
  const [sinceInput, setSinceInput] = useState('');
  const [untilInput, setUntilInput] = useState('');

  // Load filter state from localStorage on mount
  useEffect(() => {
    const savedFilter = localStorage.getItem(FILTER_STORAGE_KEY);
    if (savedFilter) {
      try {
        const parsed = JSON.parse(savedFilter);
        setWorkerId(parsed.workerId || '');
        setLevel(parsed.level || '');
        setSearch(parsed.search || '');
        setSinceInput(parsed.sinceInput || '');
        setUntilInput(parsed.untilInput || '');
      } catch (error) {
        // Invalid saved state, ignore
      }
    }
  }, []);

  // Parse time input (HH:MM or minutes ago)
  const parseTimeInput = (input: string): number | undefined => {
    if (!input || input.trim() === '') {
      return undefined;
    }

    const trimmed = input.trim();

    // Check if it's a relative time (e.g., "5m" or "5")
    const minutesMatch = trimmed.match(/^(\d+)m?$/);
    if (minutesMatch) {
      const minutes = parseInt(minutesMatch[1], 10);
      return Date.now() - minutes * 60 * 1000;
    }

    // Check if it's HH:MM format
    const timeMatch = trimmed.match(/^(\d{1,2}):(\d{2})$/);
    if (timeMatch) {
      const hours = parseInt(timeMatch[1], 10);
      const minutes = parseInt(timeMatch[2], 10);
      const now = new Date();
      const targetTime = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        hours,
        minutes,
        0,
        0
      );
      return targetTime.getTime();
    }

    return undefined;
  };

  // Apply filter whenever any field changes
  useEffect(() => {
    const filter: ActivityFilter = {
      workerId: workerId || undefined,
      level: level as 'debug' | 'info' | 'warn' | 'error' | undefined,
      search: search || undefined,
      since: parseTimeInput(sinceInput),
      until: parseTimeInput(untilInput),
    };

    // Save to localStorage
    localStorage.setItem(
      FILTER_STORAGE_KEY,
      JSON.stringify({
        workerId,
        level,
        search,
        sinceInput,
        untilInput,
      })
    );

    onFilterChange(filter);
  }, [workerId, level, search, sinceInput, untilInput, onFilterChange]);

  const handleClearAll = () => {
    setWorkerId('');
    setLevel('');
    setSearch('');
    setSinceInput('');
    setUntilInput('');
    localStorage.removeItem(FILTER_STORAGE_KEY);
  };

  const hasActiveFilters = workerId || level || search || sinceInput || untilInput;

  return (
    <div className="filter-controls">
      <h3>Filters</h3>

      <div className="filter-group">
        <label htmlFor="worker-filter">Worker</label>
        <select
          id="worker-filter"
          value={workerId}
          onChange={(e) => setWorkerId(e.target.value)}
        >
          <option value="">All Workers</option>
          {workers.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </div>

      <div className="filter-group">
        <label htmlFor="level-filter">Level</label>
        <select
          id="level-filter"
          value={level}
          onChange={(e) => setLevel(e.target.value)}
        >
          <option value="">All Levels</option>
          <option value="debug">Debug</option>
          <option value="info">Info</option>
          <option value="warn">Warn</option>
          <option value="error">Error</option>
        </select>
      </div>

      <div className="filter-group">
        <label htmlFor="search-filter">Search</label>
        <input
          id="search-filter"
          type="text"
          placeholder="Search messages..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="filter-group">
        <label htmlFor="since-filter">
          Since
          <span className="filter-hint">(HH:MM or Xm ago)</span>
        </label>
        <input
          id="since-filter"
          type="text"
          placeholder="e.g., 10:30 or 5m"
          value={sinceInput}
          onChange={(e) => setSinceInput(e.target.value)}
        />
      </div>

      <div className="filter-group">
        <label htmlFor="until-filter">
          Until
          <span className="filter-hint">(HH:MM or Xm ago)</span>
        </label>
        <input
          id="until-filter"
          type="text"
          placeholder="e.g., 11:00 or 2m"
          value={untilInput}
          onChange={(e) => setUntilInput(e.target.value)}
        />
      </div>

      <div className="filter-actions">
        {hasActiveFilters && (
          <button onClick={handleClearAll} className="clear-filters-btn">
            Clear All Filters
          </button>
        )}
      </div>

      <div className="filter-stats">
        Showing {filteredCount} of {totalCount} events
      </div>
    </div>
  );
};

export default FilterControls;
