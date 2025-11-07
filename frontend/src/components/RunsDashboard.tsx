import { ChangeEvent, useEffect, useState } from "react";
import { RunRecord } from "../types";
import { useRuns } from "../hooks/useRuns";
import { RunCard } from "./RunCard";

interface Props {
  recentRun?: RunRecord | null;
}

export function RunsDashboard({ recentRun }: Props) {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const { runs, loading, error, refresh } = useRuns(autoRefresh);

  useEffect(() => {
    if (recentRun) {
      refresh(true);
    }
  }, [recentRun, refresh]);

  return (
    <section>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h2>Runs</h2>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setAutoRefresh(event.target.checked)
              }
            />
            Auto refresh
          </label>
          <button className="secondary" onClick={() => refresh(true)} disabled={loading}>
            {loading ? "Refreshing" : "Refresh"}
          </button>
        </div>
      </header>

      {recentRun && (
        <p>
          Latest submission: <strong>{recentRun.run_id}</strong> ({recentRun.workflow})
        </p>
      )}

      {error && <p className="error">{error}</p>}

      {runs.length === 0 && !loading && <p>No runs yet. Submit a dataset to get started.</p>}

      <div className="runs-list">
        {runs.map((run: RunRecord, index) => (
          <RunCard key={run?.run_id ?? `run-${index}`} run={run} />
        ))}
      </div>
    </section>
  );
}
