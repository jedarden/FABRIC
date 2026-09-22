import React, { useState, useEffect, useCallback } from 'react';

// ── API shapes (mirror src/factoryPanel.ts) ──────────────────

interface FactoryGroupStats {
  key: string;
  attempts: number;
  verified: number;
  decomposed: number;
  uncosted: number;
  eligibleAttempts: number;
  yieldPerAttempt: number;
  costTotal: number;
  decomposedSpend: number;
  eligibleSpend: number;
  costPerVerifiedClosure: number;
  yieldPerDollar: number;
  unverifiedSpend: number;
  unverifiedSpendShare: number;
  tokens: number;
  lastAttemptTs: number | null;
}

interface FactoryRoutingView {
  decision: string;
  scope: string;
  ts: number;
  workspace?: string;
  adapter?: string;
  reason?: string;
}

interface FactoryDegradedProviderView {
  provider: string;
  sinceTs: number;
  reason?: string;
}

interface FactoryExperimentStopView {
  experiment: string;
  scope?: string;
  ts: number;
}

interface FactoryPanelData {
  windowMs: number;
  generatedAt: number;
  totals: FactoryGroupStats;
  adapters: FactoryGroupStats[];
  workspaces: FactoryGroupStats[];
  latestRouting: FactoryRoutingView | null;
  recentRoutings: FactoryRoutingView[];
  degradedProviders: FactoryDegradedProviderView[];
  lastExperimentStops: FactoryExperimentStopView[];
  excludedFixtureEvents: number;
  restoredRows: number;
}

interface FactoryPanelProps {
  visible: boolean;
  onClose: () => void;
}

const WINDOW_CHOICES: { label: string; value: string }[] = [
  { label: '1h', value: '1h' },
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
];

const pct = (share: number): string => `${(share * 100).toFixed(1)}%`;
const usd = (n: number): string => `$${n.toFixed(n < 10 ? 4 : 2)}`;
const ratio = (n: number): string => n.toFixed(3);
const timeOf = (ts: number): string => new Date(ts).toLocaleTimeString();

/**
 * Factory panel — verified-closure yield, cost per verified closure, and
 * provider/routing health, aggregated per adapter and per workspace over a
 * rolling window. Restored from FABRIC's on-disk store across restarts.
 */
const FactoryPanel: React.FC<FactoryPanelProps> = ({ visible, onClose }) => {
  const [data, setData] = useState<FactoryPanelData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [window, setWindow] = useState('24h');

  const fetchData = useCallback(async (w: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/factory?window=${encodeURIComponent(w)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) fetchData(window);
  }, [visible, window, fetchData]);

  if (!visible) return null;

  const t = data?.totals;

  const renderGroupTable = (rows: FactoryGroupStats[], label: string) => (
    <div className="analytics-section">
      <h3 className="analytics-section-title">{label}</h3>
      <div className="analytics-section-body">
        {rows.length === 0 ? (
          <p className="analytics-empty">No attempt.resolved events in this window.</p>
        ) : (
          <table className="factory-table">
            <thead>
              <tr>
                <th>{label === 'Per Adapter' ? 'Adapter' : 'Workspace'}</th>
                <th title="attempt.resolved events">Attempts</th>
                <th title="verified closures">Verified</th>
                <th title="verified / eligible attempts">Yield/attempt</th>
                <th title="verified closures per eligible dollar">Yield/$</th>
                <th title="eligible spend per verified closure">$/closure</th>
                <th title="spend on eligible attempts that did not verify">Unverified spend</th>
                <th title="decomposed attempts (ADR-030) — outside yield">Decomp.</th>
                <th title="costed=false attempts — outside spend math">Uncosted</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.key}>
                  <td className="factory-key">{g.key}</td>
                  <td>{g.attempts}</td>
                  <td className="factory-verified">{g.verified}</td>
                  <td>{ratio(g.yieldPerAttempt)}</td>
                  <td>{g.yieldPerDollar > 0 ? ratio(g.yieldPerDollar) : '—'}</td>
                  <td>{g.costPerVerifiedClosure > 0 ? usd(g.costPerVerifiedClosure) : '—'}</td>
                  <td>
                    {usd(g.unverifiedSpend)}
                    {g.costTotal > 0 && <span className="factory-share"> ({pct(g.unverifiedSpendShare)})</span>}
                  </td>
                  <td className={g.decomposed > 0 ? 'factory-decomposed' : ''}>{g.decomposed}</td>
                  <td className={g.uncosted > 0 ? 'factory-uncosted' : ''}>{g.uncosted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );

  return (
    <div className="analytics-panel factory-panel">
      <div className="analytics-header">
        <h3>
          Factory
          {t && (
            <span className="analytics-subtitle">
              {t.attempts} attempts · {t.verified} verified · yield {ratio(t.yieldPerAttempt)}
            </span>
          )}
        </h3>
        <div className="analytics-header-actions">
          {WINDOW_CHOICES.map((w) => (
            <button
              key={w.value}
              className={`factory-window ${window === w.value ? 'active' : ''}`}
              onClick={() => setWindow(w.value)}
            >
              {w.label}
            </button>
          ))}
          <button className="analytics-refresh" onClick={() => fetchData(window)} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <button className="close-button" onClick={onClose}>x</button>
        </div>
      </div>

      {error && <div className="analytics-error">{error}</div>}

      {data && (
        <div className="analytics-content">
          <div className="analytics-section">
            <h3 className="analytics-section-title">Fleet Totals</h3>
            <div className="analytics-section-body factory-totals">
              <div className="factory-total">
                <span className="factory-total-label">Yield / attempt</span>
                <span className="factory-total-value">{ratio(t!.yieldPerAttempt)}</span>
              </div>
              <div className="factory-total">
                <span className="factory-total-label">Yield / $</span>
                <span className="factory-total-value">{t!.yieldPerDollar > 0 ? ratio(t!.yieldPerDollar) : '—'}</span>
              </div>
              <div className="factory-total">
                <span className="factory-total-label">Cost / verified closure</span>
                <span className="factory-total-value">{t!.costPerVerifiedClosure > 0 ? usd(t!.costPerVerifiedClosure) : '—'}</span>
              </div>
              <div className="factory-total">
                <span className="factory-total-label">Unverified spend</span>
                <span className="factory-total-value">
                  {usd(t!.unverifiedSpend)}
                  {t!.costTotal > 0 ? ` (${pct(t!.unverifiedSpendShare)})` : ''}
                </span>
              </div>
              <div className="factory-total">
                <span className="factory-total-label">Decomposed (ADR-030)</span>
                <span className="factory-total-value">{t!.decomposed}</span>
              </div>
              <div className="factory-total">
                <span className="factory-total-label">costed=false</span>
                <span className="factory-total-value">{t!.uncosted}</span>
              </div>
            </div>
          </div>

          {renderGroupTable(data.adapters, 'Per Adapter')}
          {renderGroupTable(data.workspaces, 'Per Workspace')}

          <div className="analytics-section">
            <h3 className="analytics-section-title">Evidence Routing</h3>
            <div className="analytics-section-body">
              {!data.latestRouting ? (
                <p className="analytics-empty">No agent.evidence_routing events in this window.</p>
              ) : (
                <>
                  <p className="factory-latest-routing">
                    Latest: <strong>{data.latestRouting.decision}</strong>
                    {' '}· scope <strong>{data.latestRouting.scope}</strong>
                    {' '}· {timeOf(data.latestRouting.ts)}
                    {data.latestRouting.workspace && ` · ${data.latestRouting.workspace}`}
                  </p>
                  <table className="factory-table">
                    <thead>
                      <tr>
                        <th>Decision</th>
                        <th>Scope</th>
                        <th>Time</th>
                        <th>Workspace</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentRoutings.map((r, i) => (
                        <tr key={`${r.ts}-${i}`}>
                          <td>{r.decision}</td>
                          <td>{r.scope}</td>
                          <td>{timeOf(r.ts)}</td>
                          <td>{r.workspace ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          </div>

          <div className="analytics-section">
            <h3 className="analytics-section-title">Provider Health</h3>
            <div className="analytics-section-body">
              {data.degradedProviders.length === 0 ? (
                <p className="analytics-empty">All providers healthy.</p>
              ) : (
                <ul className="factory-degraded-list">
                  {data.degradedProviders.map((p) => (
                    <li key={p.provider} className="factory-degraded">
                      ⚠ {p.provider} degraded since {timeOf(p.sinceTs)}
                      {p.reason ? ` — ${p.reason}` : ''}
                    </li>
                  ))}
                </ul>
              )}
              {data.lastExperimentStops.length > 0 && (
                <p className="factory-experiment-stops">
                  Experiments stopped:{' '}
                  {data.lastExperimentStops
                    .map((e) => `${e.experiment}${e.scope ? ` (${e.scope})` : ''}`)
                    .join(', ')}
                </p>
              )}
            </div>
          </div>

          <div className="factory-footer">
            Restored {data.restoredRows} ledger rows from disk · {data.excludedFixtureEvents} fixture rows excluded
          </div>
        </div>
      )}
    </div>
  );
};

export default FactoryPanel;
