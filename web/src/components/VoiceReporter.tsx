import { useSpeech } from "../hooks/useSpeech";

type VoiceReporterProps = {
  onSubmitReport: (text: string) => void;
};

export default function VoiceReporter({ onSubmitReport }: VoiceReporterProps) {
  const { isListening, transcript, startListening, stopListening, setTranscript, permissionState } = useSpeech();

  const handleSubmit = () => {
    if (transcript.trim()) {
      onSubmitReport(transcript.trim());
      setTranscript("");
    }
  };

  const micUnavailable = permissionState === 'unsupported' || permissionState === 'denied';

  return (
    <div className="voice-reporter">
      <div className="voice-reporter__header">
        <span className="citizen-card__label">Voice Report</span>
        <h3>Hold to Speak</h3>
        <p>Describe the emergency clearly. Your voice is transcribed live and sent to the AI triage pipeline.</p>
        {permissionState === 'denied' && (
          <p style={{ color: '#ff6b57', fontSize: '0.85rem', marginTop: '8px' }}>
            ⚠ Microphone access denied. Please enable it in browser settings and reload.
          </p>
        )}
        {permissionState === 'unsupported' && (
          <p style={{ color: '#ffc857', fontSize: '0.85rem', marginTop: '8px' }}>
            ⚠ Speech recognition is not supported in this browser. Use Chrome or Edge.
          </p>
        )}
        {permissionState === 'prompt' && (
          <p style={{ color: '#7cc6ff', fontSize: '0.85rem', marginTop: '8px' }}>
            🎤 Click the button below to grant microphone access.
          </p>
        )}
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
          onMouseLeave={() => { if (isListening) stopListening(); }}
          onTouchStart={(e) => { e.preventDefault(); startListening(); }}
          onTouchEnd={(e) => { e.preventDefault(); stopListening(); }}
          type="button"
          disabled={micUnavailable}
          style={micUnavailable ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
        >
          {isListening ? "🎙️ LISTENING..." : micUnavailable ? "🎙️ MIC UNAVAILABLE" : "🎙️ HOLD TO SPEAK"}
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
