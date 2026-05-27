import React from 'react';
import { WorkerInfo, NeedleState } from '../types';

interface FleetSummaryBarProps {
  workers: WorkerInfo[];
}

const FleetSummaryBar: React.FC<FleetSummaryBarProps> = ({ workers }) => {
  const summary = React.useMemo(() => {
    const stateCounts: Partial<Record<NeedleState, number>> = {};
    let stuckCount = 0;
    let totalBeadsCompleted = 0;

    for (const worker of workers) {
      if (worker.needleState) {
        stateCounts[worker.needleState] = (stateCounts[worker.needleState] || 0) + 1;
      }
      if (worker.stuck) {
        stuckCount++;
      }
      totalBeadsCompleted += (worker as any).beadsCompleted || 0;
    }

    return {
      working: (stateCounts.WORKING || 0) + (stateCounts.BUILDING || 0) + (stateCounts.DISPATCHING || 0) + (stateCounts.EXECUTING || 0) + (stateCounts.HANDLING || 0) + (stateCounts.LOGGING || 0),
      selecting: stateCounts.SELECTING || 0,
      exhausted: (stateCounts.EXHAUSTED_IDLE || 0) + (stateCounts.STOPPED || 0),
      beadsToday: totalBeadsCompleted,
      stuck: stuckCount,
    };
  }, [workers]);

  return (
    <div className="fleet-summary-bar">
      <span className="fleet-summary-item working">
        {summary.working} WORKING
      </span>
      <span className="fleet-summary-separator">•</span>
      <span className="fleet-summary-item selecting">
        {summary.selecting} SELECTING
      </span>
      <span className="fleet-summary-separator">•</span>
      <span className="fleet-summary-item exhausted">
        {summary.exhausted} EXHAUSTED
      </span>
      <span className="fleet-summary-separator">•</span>
      <span className="fleet-summary-item beads-today">
        {summary.beadsToday} beads today
      </span>
      <span className="fleet-summary-separator">•</span>
      <span className={`fleet-summary-item stuck ${summary.stuck > 0 ? 'has-stuck' : ''}`}>
        {summary.stuck} stuck
      </span>
    </div>
  );
};

export default FleetSummaryBar;
