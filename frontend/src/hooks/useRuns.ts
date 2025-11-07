import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RunRecord } from "../types";
import { listRuns } from "../api/client";

const DEFAULT_REFRESH_MS = 20000;

export function useRuns(autoRefresh: boolean) {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const fetchRuns = useCallback(async (refresh = true) => {
    setLoading((prev) => {
      if (prev) return prev;
      return true;
    });
    try {
      const data = await listRuns(refresh);
      setRuns(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load runs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRuns(true);
    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
      }
    };
  }, [fetchRuns]);

  useEffect(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (autoRefresh) {
      const id = window.setInterval(() => fetchRuns(true), DEFAULT_REFRESH_MS);
      timerRef.current = id;
    }
  }, [autoRefresh, fetchRuns]);

  const sortedRuns = useMemo(() => {
    return [...runs].sort((a, b) => {
      const left = a?.created_at ? Date.parse(a.created_at) : 0;
      const right = b?.created_at ? Date.parse(b.created_at) : 0;
      return right - left;
    });
  }, [runs]);

  return {
    runs: sortedRuns,
    loading,
    error,
    refresh: fetchRuns,
  };
}
