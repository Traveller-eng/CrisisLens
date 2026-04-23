import { useSpeech } from "../hooks/useSpeech";

type VoiceReporterProps = {
  onSubmitReport: (text: string) => void;
};

export default function VoiceReporter({ onSubmitReport }: VoiceReporterProps) {
  const { isListening, transcript, startListening, stopListening, setTranscript, supported } = useSpeech();

  if (!supported) return null;

  const handleSubmit = () => {
    if (transcript.trim()) {
      onSubmitReport(transcript.trim());
      setTranscript("");
    }
  };

  return (
    <div className="voice-reporter">
      <div className="voice-reporter__header">
        <span className="citizen-card__label">Voice Report</span>
        <h3>Hold to Speak</h3>
        <p>Describe the emergency clearly. Your voice is transcribed live and sent to the AI triage pipeline.</p>
      </div>

      <div className="voice-reporter__transcript">
        <p className={transcript ? "voice-reporter__text" : "voice-reporter__placeholder"}>
          {transcript || "Press and hold the red button below, then describe what you see..."}
        </p>
      </div>

      <div className="voice-reporter__actions">
        <button
          className={`voice-reporter__mic ${isListening ? "voice-reporter__mic--active" : ""}`}
          onMouseDown={startListening}
          onMouseUp={stopListening}
          onMouseLeave={stopListening}
          onTouchStart={(e) => { e.preventDefault(); startListening(); }}
          onTouchEnd={(e) => { e.preventDefault(); stopListening(); }}
          type="button"
        >
          {isListening ? "🎙️ LISTENING..." : "🎙️ HOLD TO SPEAK"}
        </button>

        <button
          className="voice-reporter__send"
          onClick={handleSubmit}
          disabled={!transcript.trim() || isListening}
          type="button"
        >
          SEND TO AI
        </button>
      </div>
    </div>
  );
}
