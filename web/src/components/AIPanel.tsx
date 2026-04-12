import type { AIAnalysis } from "../../../shared/crisis";

export default function AIPanel({ data }: { data?: AIAnalysis }) {
  return (
    <div className="ai-panel">
      <div className="ai-panel__title">AI STRUCTURED OUTPUT</div>
      <pre>{JSON.stringify(data ?? { status: "pending" }, null, 2)}</pre>
    </div>
  );
}
