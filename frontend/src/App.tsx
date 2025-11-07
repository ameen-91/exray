import { useState } from "react";
import { RunRecord } from "./types";
import { ClusterInfo } from "./components/ClusterInfo";
import { RunsDashboard } from "./components/RunsDashboard";
import { SubmitCtganForm } from "./components/SubmitCtganForm";
import { SubmitLlmForm } from "./components/SubmitLlmForm";
import { SubmitCustomForm } from "./components/SubmitCustomForm";

function App() {
  const [recentRun, setRecentRun] = useState<RunRecord | null>(null);

  const handleSubmitted = (run: RunRecord) => {
    setRecentRun(run);
  };

  return (
    <div className="app-shell">
      <header style={{ marginBottom: "2rem" }}>
        <h1>Workflow Launcher</h1>
      </header>

      <ClusterInfo />

      <section>
        <h2>Submit a workflow</h2>
        <div className="card-grid">
          <SubmitCtganForm onSubmitted={handleSubmitted} />
          <SubmitLlmForm onSubmitted={handleSubmitted} />
          <SubmitCustomForm onSubmitted={handleSubmitted} />
        </div>
      </section>

      <RunsDashboard recentRun={recentRun ?? undefined} />
    </div>
  );
}

export default App;
