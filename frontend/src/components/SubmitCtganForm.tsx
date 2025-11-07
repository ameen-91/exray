import { ChangeEvent, FormEvent, useState } from "react";
import { submitCtgan } from "../api/client";
import { RunRecord } from "../types";

interface Props {
  onSubmitted: (run: RunRecord) => void;
}

export function SubmitCtganForm({ onSubmitted }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [discreteColumns, setDiscreteColumns] = useState("");
  const [epochs, setEpochs] = useState(5);
  const [samples, setSamples] = useState(1000);
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

    setBusy(true);
    setError(null);
    try {
      const run = await submitCtgan({
        file,
        discrete_columns: discreteColumns,
        no_of_epochs: epochs,
        no_of_samples: samples,
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
      <h3>Launch CTGAN</h3>
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
        Discrete columns (comma separated)
        <input
          type="text"
          value={discreteColumns}
          placeholder="species,category"
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            setDiscreteColumns(event.target.value)
          }
        />
      </label>
      <label>
        Epochs
        <input
          type="number"
          min={1}
          value={epochs}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            setEpochs(Number(event.target.value))
          }
        />
      </label>
      <label>
        Samples
        <input
          type="number"
          min={1}
          value={samples}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            setSamples(Number(event.target.value))
          }
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
        {busy ? "Submitting..." : "Submit CTGAN run"}
      </button>
    </form>
  );
}
