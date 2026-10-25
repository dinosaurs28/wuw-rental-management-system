import { useEffect, useRef, useState } from "react";

const RETRY_DELAYS_MS = [800, 2500];

/**
 * Loading state of a drop-screen photo (Oct 25 2026, "pickup photos not
 * loading during drop"): the ~1200 px display copy first; if it fails, the
 * original right away; the original is retried twice with backoff; then
 * `status` = "error" and `retry()` starts over from the display copy.
 */
export function usePhotoFallback(url: string, displayUrl?: string | null) {
  const display = displayUrl || url;
  const first = display !== url ? "display" : "original";
  const [stage, setStage] = useState<"display" | "original">(first);
  const [attempt, setAttempt] = useState(0);
  const [failures, setFailures] = useState(0);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clearTimer, []);
  // A different photo starts over
  useEffect(() => {
    clearTimer();
    setStage(first);
    setFailures(0);
    setStatus("loading");
  }, [url, display, first]);

  const onError = () => {
    if (stage === "display") {
      setStage("original");
      setAttempt((n) => n + 1);
      return;
    }
    const next = failures + 1;
    setFailures(next);
    const delay = RETRY_DELAYS_MS[next - 1];
    if (delay == null) {
      setStatus("error");
      return;
    }
    timer.current = setTimeout(() => setAttempt((n) => n + 1), delay);
  };
  const retry = () => {
    clearTimer();
    setStage(first);
    setFailures(0);
    setStatus("loading");
    setAttempt((n) => n + 1);
  };

  return {
    src: stage === "display" ? display : url,
    /** Showing the display copy (the original can be offered through srcset) */
    usingDisplay: stage === "display",
    /** Changes on every new attempt: use as the <img> key to reload it */
    attempt,
    status,
    onLoad: () => setStatus("loaded"),
    onError,
    retry,
  };
}
