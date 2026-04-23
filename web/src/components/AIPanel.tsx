import type { AIAnalysis } from "../../../shared/crisis";

type Props = {
  data?: AIAnalysis;
  status?: "raw" | "queued" | "processing" | "refined" | "fallback";
  queuePosition?: number | null;
};

export default function AIPanel({ data, status = "raw", queuePosition = null }: Props) {
  const isPending = !data && status !== "fallback" && status !== "refined";
  const isFallback = Boolean(data?.isFallback);
  const pendingNote =
    status === "processing"
      ? "Gemini is actively processing this report in the background."
      : status === "queued"
        ? `This report is waiting in the AI queue${queuePosition ? ` at position ${queuePosition}` : ""}.`
        : "This report has entered the system and is waiting for AI refinement.";

  return (
    <div className="ai-panel">
      <div className="ai-panel__title">AI STRUCTURED OUTPUT</div>
      <pre>
        {JSON.stringify(
          data ?? {
            status,
            note: pendingNote
          },
          null,
          2
        )}
      </pre>
      {isPending ? <div className="ai-panel__hint">Status: {status === "processing" ? "AI processing..." : "queued for analysis"}</div> : null}
      {isFallback ? <div className="ai-panel__hint">Status: fallback classification (Gemini failed or returned invalid JSON)</div> : null}
    </div>
  );
}
