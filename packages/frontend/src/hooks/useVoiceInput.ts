import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/services/api';

/**
 * Push-to-talk dictation for the composers.
 *
 * Records with MediaRecorder and posts the clip to the server, which forwards
 * it to the configured Whisper-compatible service. Availability is probed once:
 * without `TRANSCRIBE_URL` on the server, or without microphone support in the
 * browser, callers simply hide the button.
 */
export function useVoiceInput(onText: (text: string) => void) {
  const [available, setAvailable] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    let cancelled = false;
    const supported =
      typeof window !== 'undefined' &&
      typeof window.MediaRecorder !== 'undefined' &&
      Boolean(navigator.mediaDevices?.getUserMedia);
    if (!supported) return;

    api
      .get<{ success: boolean; data: { available: boolean } }>('/api/transcribe/status')
      .then((response) => {
        if (!cancelled) setAvailable(Boolean(response.data.data?.available));
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
    setRecording(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        // Release the mic immediately; the upload does not need it.
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size === 0) return;

        setBusy(true);
        try {
          const form = new FormData();
          form.append('audio', blob, 'speech.webm');
          const response = await api.post<{ success: boolean; data: { text: string } }>(
            '/api/transcribe',
            form
          );
          const text = response.data.data?.text?.trim();
          if (text) onText(text);
          else setError('Nothing was recognised.');
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Transcription failed');
        } finally {
          setBusy(false);
        }
      };

      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Microphone unavailable');
    }
  }, [onText]);

  const toggle = useCallback(() => {
    if (recording) stop();
    else void start();
  }, [recording, start, stop]);

  return { available, recording, busy, error, toggle };
}
