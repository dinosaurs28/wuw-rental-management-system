import { useEffect, useState } from "react";

/**
 * Date.now(), refreshed every minute while `enabled` — re-renders live
 * durations (e.g. "overdue 3h 20m") without refetching. The value can lag the
 * real clock by up to a minute; callers clamp elapsed time at zero.
 */
export function useMinuteTick(enabled = true): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [enabled]);

  return now;
}
