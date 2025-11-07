import type { FC, JSX } from "react";
import { useEffect, useState } from "react";
import { fetchRunLogs, requestResultUrl } from "../api/client";
import { RunRecord } from "../types";
import { RunStatusBadge } from "./RunStatusBadge";

interface Props {
  run: RunRecord;
}

interface PodLog {
  podName: string;
  displayName: string;
  phase: string;
  logs: string;
}

function parsePodLogs(rawLogs: string): PodLog[] {
  try {
    const lines = rawLogs.trim().split('\n');
    const podMap = new Map<string, string[]>();
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      try {
        const parsed = JSON.parse(line);
        if (parsed.result?.podName && parsed.result?.content) {
          const podName = parsed.result.podName;
          if (!podMap.has(podName)) {
            podMap.set(podName, []);
          }
          podMap.get(podName)!.push(parsed.result.content);
        }
      } catch {
        continue;
      }
    }
    
    if (podMap.size > 0) {
      return Array.from(podMap.entries()).map(([podName, logLines]) => ({
        podName,
        displayName: podName.split('-').slice(0, -1).join('-') || podName,
        phase: 'Running',
        logs: logLines.join('\n'),
      }));
    }
  } catch {
  }
  
  const sections: PodLog[] = [];
  const regex = /=== (.+?) \[(.+?)\] \(phase: (.+?)\) ===\n([\s\S]*?)(?=\n=== |$)/g;
  
  let match;
  while ((match = regex.exec(rawLogs)) !== null) {
    sections.push({
      displayName: match[1],
      podName: match[2],
      phase: match[3],
      logs: match[4].trim(),
    });
  }
  
  if (sections.length === 0 && rawLogs.trim()) {
    sections.push({
      displayName: "Workflow",
      podName: "main",
      phase: "Unknown",
      logs: rawLogs.trim(),
    });
  }
  
  return sections;
}

export const RunCard: FC<Props> = ({ run }): JSX.Element => {
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string>("");
  const [expandedPods, setExpandedPods] = useState<Set<string>>(new Set());

  const runId = run?.run_id ?? "unknown";
  const hasRunId = Boolean(run?.run_id);
  const workflowLabel = run?.workflow ? `${String(run.workflow).toUpperCase()}` : "Workflow";
  const createdAt = run?.created_at ? new Date(run.created_at).toLocaleString() : "Unknown";
  const updatedAt = run?.updated_at ? new Date(run.updated_at).toLocaleString() : null;

  const podLogs = parsePodLogs(logs);

  useEffect(() => {
    if (!showLogs || !hasRunId) {
      return undefined;
    }

    let cancelled = false;
    let timer: number | undefined;
    let isLoading = false;

    const loadLogs = async () => {
      if (isLoading) return;
      
      isLoading = true;
      setLogsLoading(true);
      try {
        const text = await fetchRunLogs(runId);
        if (!cancelled) {
          setLogs(text);
          setLogsError(null);
        }
      } catch (err) {
        if (!cancelled) {
          const errorMsg = err instanceof Error ? err.message : "Failed to fetch logs";
          if (errorMsg.includes('timed out')) {
            setLogsError("Log request timed out. Logs may be large or server is slow. Will retry...");
          } else {
            setLogsError(errorMsg);
          }
        }
      } finally {
        if (!cancelled) {
          setLogsLoading(false);
        }
        isLoading = false;
      }
    };

    loadLogs();
    timer = window.setInterval(loadLogs, 12000);

    return () => {
      cancelled = true;
      if (timer) {
        window.clearInterval(timer);
      }
    };
  }, [showLogs, hasRunId, runId]);

  useEffect(() => {
    setDownloadUrl(null);
    setError(null);
  }, [runId]);

  const handleDownload = async () => {
    if (!hasRunId) {
      setError("Run identifier missing; refresh the page and try again.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await requestResultUrl(runId);
      setDownloadUrl(result.download_url);
      window.open(result.download_url, "_blank", "noopener,noreferrer");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not fetch download link";
      let friendlyMessage = message;
      
      if (message.includes('timed out')) {
        friendlyMessage = "Download request timed out. The workflow may still be processing or the server is slow.";
      } else {
        try {
          const parsed = JSON.parse(message);
          friendlyMessage = parsed.detail || parsed.message || message;
        } catch {
          friendlyMessage = message;
        }
      }
      setError(friendlyMessage);
    } finally {
      setBusy(false);
    }
  };

  const togglePod = (podName: string) => {
    setExpandedPods((prev) => {
      const next = new Set(prev);
      if (next.has(podName)) {
        next.delete(podName);
      } else {
        next.add(podName);
      }
      return next;
    });
  };

  return (
    <article className="card run-card-horizontal">
      <div className="run-card-main">
        <div className="run-card-header">
          <div>
            <h3 style={{ margin: 0, marginBottom: "0.25rem" }}>{workflowLabel}</h3>
            <p className="muted" style={{ margin: 0, fontSize: "0.75rem" }}>
              <code style={{ fontSize: "0.75rem", background: "#f1f5f9", padding: "0.125rem 0.375rem", borderRadius: "3px" }}>{runId}</code>
            </p>
          </div>
          <RunStatusBadge status={run.status} />
        </div>
        
        <div className="run-card-meta">
          <div>
            <span className="meta-label">Created</span>
            <span className="meta-value">{createdAt}</span>
          </div>
          {updatedAt && (
            <div>
              <span className="meta-label">Updated</span>
              <span className="meta-value">{updatedAt}</span>
            </div>
          )}
          {run.original_filename && (
            <div>
              <span className="meta-label">File</span>
              <span className="meta-value">{run.original_filename}</span>
            </div>
          )}
        </div>
        
        <div className="run-card-actions">
          <button className="primary" onClick={handleDownload} disabled={busy || !hasRunId}>
            {busy ? "Fetching..." : "Download Result"}
          </button>
          <button
            className="secondary"
            onClick={() => setShowLogs((current) => !current)}
            disabled={!hasRunId}
          >
            {showLogs ? "Hide Logs" : "Show Logs"}
          </button>
          {run.parameters && (
            <details className="parameters-block">
              <summary>Parameters</summary>
              <pre>{JSON.stringify(run.parameters, null, 2)}</pre>
            </details>
          )}
        </div>
        
        {error && <p className="error" style={{ marginTop: "0.75rem" }}>{error}</p>}
        {downloadUrl && (
          <p style={{ marginTop: "0.5rem", fontSize: "0.875rem" }}>
            <a href={downloadUrl} target="_blank" rel="noreferrer">
              → Open download link
            </a>
          </p>
        )}
      </div>

      {showLogs && (
        <div className="run-card-logs">
          {logsLoading && <small className="muted">Loading logs…</small>}
          {logsError && <p className="error">{logsError}</p>}
          {!logsError && podLogs.length > 0 && (
            <div className="pod-logs-container">
              {podLogs.map((pod) => (
                <div key={pod.podName} className="pod-log-section">
                  <div
                    className="pod-log-header"
                    onClick={() => togglePod(pod.podName)}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span className="toggle-icon">{expandedPods.has(pod.podName) ? "▼" : "▶"}</span>
                      <strong>{pod.displayName}</strong>
                      <code className="pod-name">{pod.podName}</code>
                      <span className={`pod-phase phase-${pod.phase.toLowerCase()}`}>{pod.phase}</span>
                    </div>
                  </div>
                  {expandedPods.has(pod.podName) && (
                    <pre className="pod-log-content">{pod.logs || "No logs available"}</pre>
                  )}
                </div>
              ))}
            </div>
          )}
          {!logsError && podLogs.length === 0 && !logsLoading && (
            <p className="muted">No logs yet.</p>
          )}
        </div>
      )}
    </article>
  );
};
