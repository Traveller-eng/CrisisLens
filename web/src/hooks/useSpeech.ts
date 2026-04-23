import { useState, useEffect, useCallback } from "react";

export function useSpeech() {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [recognition, setRecognition] = useState<any>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const SpeechRecognitionApi = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionApi) {
      console.warn("Speech recognition not supported in this browser.");
      return;
    }

    const rec = new SpeechRecognitionApi();
    rec.continuous = true;
    rec.interimResults = true;
    // Optimized for regional accents (Indian English) to ensure high-fidelity transcription during demo
    rec.lang = "en-IN";

    rec.onresult = (event: any) => {
      let currentTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        currentTranscript += event.results[i][0].transcript;
      }
      setTranscript(currentTranscript);
    };

    rec.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      setIsListening(false);
    };

    rec.onend = () => {
      setIsListening(false);
    };

    setRecognition(rec);
  }, []);

  const startListening = useCallback(() => {
    if (recognition) {
      setTranscript("");
      try {
        recognition.start();
        setIsListening(true);
      } catch (e) {
        console.error("Recognition failed:", e);
      }
    }
  }, [recognition]);

  const stopListening = useCallback(() => {
    if (recognition) {
      recognition.stop();
      setIsListening(false);
    }
  }, [recognition]);

  return { isListening, transcript, startListening, stopListening, setTranscript, supported: !!recognition };
}
