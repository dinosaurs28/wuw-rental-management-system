import { useState, useEffect, useRef } from "react";
import { Clock } from "lucide-react";

interface HoldCountdownTimerProps {
  expiresAt: string;
  onExpired: () => void;
}

export const HoldCountdownTimer = ({ expiresAt, onExpired }: HoldCountdownTimerProps) => {
  const [seconds, setSeconds] = useState(() =>
    Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)),
  );
  const onExpiredRef = useRef(onExpired);
  onExpiredRef.current = onExpired;

  useEffect(() => {
    if (seconds <= 0) {
      onExpiredRef.current();
      return;
    }

    const id = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          clearInterval(id);
          onExpiredRef.current();
          return 0;
        }
        return s - 1;
      });
    }, 1000);

    return () => clearInterval(id);
  }, [expiresAt]);

  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const formatted = `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

  const colorClass =
    seconds <= 0
      ? "text-red-600"
      : seconds < 60
        ? "text-red-600"
        : seconds < 180
          ? "text-amber-600"
          : "text-green-600";

  if (seconds <= 0) {
    return (
      <div className="inline-flex items-center gap-1.5 text-sm font-medium text-red-600">
        <Clock className="size-4" />
        <span>Hold Expired</span>
      </div>
    );
  }

  return (
    <div className={`inline-flex items-center gap-1.5 text-sm font-medium ${colorClass}`}>
      <Clock className="size-4" />
      <span>Hold expires in {formatted}</span>
    </div>
  );
};
