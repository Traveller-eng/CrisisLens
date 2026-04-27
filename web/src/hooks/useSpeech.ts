import { useState, useEffect, useCallback, useRef } from 'react';

// Extend Window to bypass TypeScript compiler errors for the native Speech API
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

interface UseSpeechReturn {
  isListening: boolean;
  transcript: string;
  startListening: () => void;
  stopListening: () => void;
  setTranscript: React.Dispatch<React.SetStateAction<string>>;
  permissionState: 'prompt' | 'granted' | 'denied' | 'unsupported';
}

export const useSpeech = (): UseSpeechReturn => {
  const [isListening, setIsListening] = useState<boolean>(false);
  const [transcript, setTranscript] = useState<string>('');
  const [permissionState, setPermissionState] = useState<'prompt' | 'granted' | 'denied' | 'unsupported'>('prompt');
  const recognitionRef = useRef<any>(null);
  const finalTranscriptRef = useRef<string>('');

  // Check for SpeechRecognition support and mic permissions on mount
  useEffect(() => {
    if (typeof window === 'undefined') {
      setPermissionState('unsupported');
      return;
    }

    const hasSpeechApi = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
    if (!hasSpeechApi) {
      setPermissionState('unsupported');
      return;
    }

    // Probe microphone permission state
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'microphone' as PermissionName })
        .then((result) => {
          setPermissionState(result.state === 'granted' ? 'granted' : result.state === 'denied' ? 'denied' : 'prompt');
          result.addEventListener('change', () => {
            setPermissionState(result.state === 'granted' ? 'granted' : result.state === 'denied' ? 'denied' : 'prompt');
          });
        })
        .catch(() => {
          // permissions.query not supported for microphone — stay as 'prompt'
        });
    }
  }, []);

  // Build the recognition instance lazily so we can re-create after errors
  const ensureRecognition = useCallback(() => {
    if (recognitionRef.current) return recognitionRef.current;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return null;

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-IN';

    rec.onresult = (event: any) => {
      let finalPart = '';
      let interimPart = '';
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalPart += result[0].transcript;
        } else {
          interimPart += result[0].transcript;
        }
      }
      // Store the finalized portion so it persists
      finalTranscriptRef.current = finalPart;
      setTranscript(finalPart + interimPart);
    };

    rec.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setPermissionState('denied');
      }
      setIsListening(false);
      // Destroy the instance so we recreate a fresh one next time
      recognitionRef.current = null;
    };

    rec.onend = () => {
      // If we were listening and it auto-stopped (browser timeout), restart
      // Otherwise leave it stopped
      setIsListening(false);
    };

    recognitionRef.current = rec;
    return rec;
  }, []);

  const startListening = useCallback(() => {
    // If permission is denied, request it by calling getUserMedia
    if (permissionState === 'denied') {
      alert('Microphone access was denied. Please enable it in your browser settings and reload.');
      return;
    }

    if (permissionState === 'unsupported') {
      alert('Speech recognition is not supported in this browser. Please use Chrome or Edge.');
      return;
    }

    // Request mic permission first if needed
    const doStart = () => {
      const rec = ensureRecognition();
      if (!rec) return;
      finalTranscriptRef.current = '';
      setTranscript('');
      try {
        rec.start();
        setIsListening(true);
        setPermissionState('granted');
      } catch (e: any) {
        // If already running, abort and restart
        if (e.message?.includes('already started')) {
          rec.stop();
          setTimeout(() => {
            try {
              rec.start();
              setIsListening(true);
            } catch (e2) {
              console.error('Could not restart recognition:', e2);
            }
          }, 200);
        } else {
          console.error('Recognition start error:', e);
        }
      }
    };

    if (permissionState === 'prompt') {
      // Trigger the browser permission prompt via getUserMedia
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then((stream) => {
          // Permission granted — stop the stream (recognition uses its own)
          stream.getTracks().forEach(t => t.stop());
          setPermissionState('granted');
          doStart();
        })
        .catch(() => {
          setPermissionState('denied');
          alert('Microphone access was denied. Voice input will not work.');
        });
    } else {
      doStart();
    }
  }, [permissionState, ensureRecognition]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
    }
    setIsListening(false);
  }, []);

  return { isListening, transcript, startListening, stopListening, setTranscript, permissionState };
};
