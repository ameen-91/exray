import { ChangeEvent, FormEvent, useState } from "react";
import CodeEditor from "@uiw/react-textarea-code-editor";
import { submitCustom } from "../api/client";
import { RunRecord } from "../types";

interface Props {
  onSubmitted: (run: RunRecord) => void;
}

export function SubmitCustomForm({ onSubmitted }: Props) {
  const [dataFile, setDataFile] = useState<File | null>(null);
  const [pythonFile, setPythonFile] = useState<File | null>(null);
  const [functionName, setFunctionName] = useState("process");
  const [pipPackages, setPipPackages] = useState("");
  const [cpu, setCpu] = useState("");
  const [memory, setMemory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useEditor, setUseEditor] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [editorCode, setEditorCode] = useState(`import pandas as pd

def process(df: pd.DataFrame) -> pd.DataFrame:
    """
    Process the input DataFrame.
    
    Args:
        df: Input DataFrame from CSV
        
    Returns:
        Processed DataFrame
    """
    result = df.copy()
    
    return result
`);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dataFile) {
      setError("Please choose a CSV data file");
      return;
    }
    if (!useEditor && !pythonFile) {
      setError("Please choose a Python script file or use the code editor");
      return;
    }
    if (useEditor && !editorCode.trim()) {
      setError("Please write some code in the editor");
      return;
    }
    if (!functionName.trim()) {
      setError("Please provide a function name");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      let scriptFile = pythonFile;
      if (useEditor) {
        const blob = new Blob([editorCode], { type: "text/x-python" });
        scriptFile = new File([blob], "script.py", { type: "text/x-python" });
      }

      const run = await submitCustom({
        data_file: dataFile,
        python_file: scriptFile!,
        function_name: functionName,
        pip_packages: pipPackages || undefined,
        cpu_limit: cpu || undefined,
        memory_limit: memory || undefined,
      });
      onSubmitted(run);
      setDataFile(null);
      setPythonFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit run");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card form-grid" onSubmit={handleSubmit}>
      <h3>Launch Custom Processing</h3>

      <label>
        Dataset (CSV)
        <input
          type="file"
          accept=".csv"
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            setDataFile(event.target.files?.[0] ?? null)
          }
          required
        />
      </label>

      <label>
        Python Script (.py)
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.5rem" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
            <input
              type="radio"
              checked={!useEditor}
              onChange={() => setUseEditor(false)}
            />
            Upload File
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
            <input
              type="radio"
              checked={useEditor}
              onChange={() => setUseEditor(true)}
            />
            Write Code
          </label>
        </div>
        {!useEditor ? (
          <input
            type="file"
            accept=".py"
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setPythonFile(event.target.files?.[0] ?? null)
            }
            required={!useEditor}
          />
        ) : (
          <div>
            <button
              type="button"
              onClick={() => setShowEditor(true)}
              style={{
                padding: "0.5rem 1rem",
                backgroundColor: "#0066cc",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "0.9rem"
              }}
            >
              {editorCode.trim() ? "Edit Code" : "Write Code"}
            </button>
            {editorCode.trim() && (
              <span style={{ marginLeft: "0.5rem", color: "#666", fontSize: "0.85rem" }}>
                Code written ({editorCode.split('\n').length} lines)
              </span>
            )}
          </div>
        )}
      </label>

      <label>
        Function Name
        <input
          type="text"
          value={functionName}
          placeholder="process"
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            setFunctionName(event.target.value)
          }
          required
        />
        <small style={{ color: "#666", fontSize: "0.85rem" }}>
          Name of the function in your script to execute
        </small>
      </label>

      <label>
        Additional Pip Packages (optional)
        <input
          type="text"
          value={pipPackages}
          placeholder="requests beautifulsoup4 matplotlib"
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            setPipPackages(event.target.value)
          }
        />
        <small style={{ color: "#666", fontSize: "0.85rem" }}>
          Space separated package names (pandas, numpy, scikit-learn pre-installed)
        </small>
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
        {busy ? "Submitting..." : "Submit Custom Processing"}
      </button>

      {/* Code Editor Modal */}
      {showEditor && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "2rem"
          }}
          onClick={() => setShowEditor(false)}
        >
          <div
            style={{
              backgroundColor: "white",
              borderRadius: "8px",
              width: "90%",
              maxWidth: "900px",
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 4px 20px rgba(0, 0, 0, 0.3)"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: "1rem 1.5rem",
                borderBottom: "1px solid #e0e0e0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center"
              }}
            >
              <h3 style={{ margin: 0 }}>Python Code Editor</h3>
              <button
                type="button"
                onClick={() => setShowEditor(false)}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: "1.5rem",
                  cursor: "pointer",
                  color: "#666",
                  padding: "0 0.5rem"
                }}
              >
                ×
              </button>
            </div>
            <div style={{ padding: "1rem", fontSize: "0.85rem", color: "#666", borderBottom: "1px solid #e0e0e0" }}>
              Write your Python function below. It should accept a pandas DataFrame and return a DataFrame.
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: "1rem", backgroundColor: "#f5f5f5" }}>
              <CodeEditor
                value={editorCode}
                language="python"
                placeholder="Write your Python code here..."
                onChange={(e) => setEditorCode(e.target.value)}
                padding={15}
                style={{
                  fontSize: 14,
                  backgroundColor: "#1e1e1e",
                  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
                  minHeight: "450px",
                  borderRadius: "4px",
                  overflow: "auto"
                }}
                data-color-mode="dark"
              />
            </div>
            <div
              style={{
                padding: "1rem 1.5rem",
                borderTop: "1px solid #e0e0e0",
                display: "flex",
                justifyContent: "flex-end",
                gap: "0.5rem"
              }}
            >
              <button
                type="button"
                onClick={() => setShowEditor(false)}
                style={{
                  padding: "0.5rem 1.5rem",
                  backgroundColor: "#f0f0f0",
                  border: "1px solid #d0d0d0",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "0.9rem"
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setShowEditor(false)}
                style={{
                  padding: "0.5rem 1.5rem",
                  backgroundColor: "#0066cc",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "0.9rem"
                }}
              >
                Save Code
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
