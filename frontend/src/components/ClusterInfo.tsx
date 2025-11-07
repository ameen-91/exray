import type { FC, JSX } from "react";
import { useEffect, useState } from "react";

interface ServiceHealth {
  status: string;
  message: string;
}

interface ClusterNodeDetail {
  name: string;
  ready: boolean;
  cpu_capacity: number;
  cpu_allocatable: number;
  memory_capacity_gb: number;
  memory_allocatable_gb: number;
  kubelet_version?: string | null;
}

interface ClusterResources {
  nodes: number;
  total_cpu: number;
  total_memory_gb: number;
  allocatable_cpu: number;
  allocatable_memory_gb: number;
  node_details?: ClusterNodeDetail[];
}

interface HealthResponse {
  overall_status: string;
  services: {
    argo?: ServiceHealth;
    minio?: ServiceHealth;
  };
  cluster?: ClusterResources | null;
}

export const ClusterInfo: FC = (): JSX.Element => {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const response = await fetch("/health");
        if (!response.ok) {
          throw new Error("Failed to fetch health status");
        }
        const data = await response.json();
        setHealth(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load cluster info");
      } finally {
        setLoading(false);
      }
    };

    fetchHealth();
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status: string): string => {
    switch (status) {
      case "healthy":
      case "connected":
        return "#10b981";
      case "warning":
      case "degraded":
        return "#f59e0b";
      case "error":
      case "unhealthy":
        return "#ef4444";
      default:
        return "#6b7280";
    }
  };

  const getStatusIcon = (status: string): string => {
    switch (status) {
      case "healthy":
      case "connected":
        return "OK";
      case "warning":
      case "degraded":
        return "!";
      case "error":
      case "unhealthy":
        return "X";
      default:
        return "?";
    }
  };

  const formatValue = (value?: number | null): string => {
    if (value === undefined || value === null || Number.isNaN(value)) {
      return "0";
    }
    return Number.isInteger(value) ? value.toString() : value.toFixed(1);
  };

  if (loading) {
    return (
      <div className="cluster-info">
        <h3>Cluster Status</h3>
        <p className="muted">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="cluster-info">
        <h3>Cluster Status</h3>
        <p style={{ color: "#ef4444" }}>{error}</p>
      </div>
    );
  }

  if (!health) {
    return (
      <div className="cluster-info">
        <h3>Cluster Status</h3>
        <p className="muted">No data available</p>
      </div>
    );
  }

  return (
    <div className="cluster-info">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
          <h3>Cluster Status</h3>
          <div className="services-grid">
            {health.services.argo && (
              <div className="service-status">
                <span
                  style={{
                    display: "inline-block",
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    backgroundColor: getStatusColor(health.services.argo.status),
                  }}
                />
                <strong>Argo</strong>
              </div>
            )}

            {health.services.minio && (
              <div className="service-status">
                <span
                  style={{
                    display: "inline-block",
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    backgroundColor: getStatusColor(health.services.minio.status),
                  }}
                />
                <strong>MinIO</strong>
              </div>
            )}
            
            {health.cluster && (
              <>
                <div style={{ width: "1px", height: "16px", backgroundColor: "#e2e8f0" }} />
                <div className="service-status">
                  <strong>{health.cluster.nodes} {health.cluster.nodes === 1 ? "node" : "nodes"}</strong>
                </div>
                <div className="service-status">
                  <strong>{formatValue(health.cluster.allocatable_cpu)} CPU cores</strong>
                </div>
                <div className="service-status">
                  <strong>{formatValue(health.cluster.allocatable_memory_gb)} GB RAM</strong>
                </div>
              </>
            )}
          </div>
        </div>
        
        <span
          style={{
            color: getStatusColor(health.overall_status),
            fontSize: "0.875rem",
            fontWeight: 500,
          }}
        >
          {getStatusIcon(health.overall_status)} {health.overall_status}
        </span>
      </div>

      {health.cluster?.node_details && health.cluster.node_details.length > 0 && (
        <div className="cluster-node-list">
          {health.cluster.node_details.map((node) => (
            <div key={node.name} className="cluster-node-card">
              <div className="node-card-header">
                <span className={`node-status ${node.ready ? "ready" : "not-ready"}`} />
                <span className="node-name">{node.name}</span>
                <span className={`node-ready ${node.ready ? "ready" : "not-ready"}`}>
                  {node.ready ? "Ready" : "Not Ready"}
                </span>
              </div>
              {node.kubelet_version && (
                <div className="node-meta">kubelet {node.kubelet_version}</div>
              )}
              <div className="node-metrics">
                <span>
                  CPU <strong>{formatValue(node.cpu_allocatable)}</strong> / {formatValue(node.cpu_capacity)} cores
                </span>
                <span>
                  Memory <strong>{formatValue(node.memory_allocatable_gb)}</strong> / {formatValue(node.memory_capacity_gb)} GB
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {health.cluster && (!health.cluster.node_details || health.cluster.node_details.length === 0) && (
        <p className="muted" style={{ marginTop: "0.75rem" }}>
          Node resource details are not available right now.
        </p>
      )}
    </div>
  );
};
