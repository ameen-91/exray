import { ChangeEvent, FormEvent, useState } from "react";
import { submitLlm } from "../api/client";
import { RunRecord } from "../types";

interface Props {
  onSubmitted: (run: RunRecord) => void;
}

export function SubmitLlmForm({ onSubmitted }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [labels, setLabels] = useState("");
  const [model, setModel] = useState("qwen2.5:0.5b");
  const [parallelism, setParallelism] = useState(1);
  const [cpu, setCpu] = useState("");
  const [memory, setMemory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file) {
      setError("Please choose a CSV file");
      return;
    }
    if (!labels.trim()) {
      setError("Provide at least one label");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const run = await submitLlm({
        file,
        labels,
        model,
        parallelism,
        cpu_limit: cpu || undefined,
        memory_limit: memory || undefined,
      });
      onSubmitted(run);
      setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit run");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card form-grid" onSubmit={handleSubmit}>
      <h3>Launch LLM classification</h3>
      <label>
        Dataset (CSV)
        <input
          type="file"
          accept=".csv"
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            setFile(event.target.files?.[0] ?? null)
          }
          required
        />
      </label>
      <label>
        Labels
        <input
          type="text"
          placeholder="positive,negative,neutral"
          value={labels}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            setLabels(event.target.value)
          }
          required
        />
      </label>
      <label>
        Model
        <input
          type="text"
          value={model}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setModel(event.target.value)}
          required
        />
      </label>
      <label>
        Parallelism
        <input
          type="number"
          min={1}
          value={parallelism}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            setParallelism(Number(event.target.value))
          }
          required
        />
      </label>

      <div style={{ gridColumn: "1 / -1", borderTop: "1px solid #e0e0e0", paddingTop: "1rem", marginTop: "0.5rem" }}>
        <strong style={{ fontSize: "0.9rem", color: "#666" }}>Optional Resource Limits</strong>
      </div>

      <label>
        CPU limit (optional)
        <input
          type="text"
          placeholder="2"
          value={cpu}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setCpu(event.target.value)}
        />
      </label>
      <label>
        Memory limit (optional)
        <input
          type="text"
          placeholder="4Gi"
          value={memory}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            setMemory(event.target.value)
          }
        />
      </label>

      {error && <p className="error" style={{ gridColumn: "1 / -1" }}>{error}</p>}
      <button className="primary" type="submit" disabled={busy} style={{ gridColumn: "1 / -1" }}>
        {busy ? "Submitting..." : "Submit LLM run"}
      </button>
    </form>
  );
}
