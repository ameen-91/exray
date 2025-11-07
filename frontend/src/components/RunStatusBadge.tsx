import { RunStatus } from "../types";

function normalizePhase(phase?: string): string {
  if (!phase) {
    return "Unknown";
  }
  return phase.charAt(0).toUpperCase() + phase.slice(1).toLowerCase();
}

function statusClass(phase?: string): string {
  const normalized = phase?.toLowerCase();
  if (!normalized) {
    return "run-status";
  }
  if (["succeeded", "completed"].includes(normalized)) {
    return "run-status succeeded";
  }
  if (["failed", "error"].includes(normalized)) {
    return "run-status failed";
  }
  if (["running", "pending", "submitted"].includes(normalized)) {
    return "run-status running";
  }
  return "run-status";
}

export function RunStatusBadge({ status }: { status?: RunStatus }) {
  const label = normalizePhase(status?.phase);
  return <span className={statusClass(status?.phase)}>{label}</span>;
}
