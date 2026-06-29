"use client";

import { useEffect, useState } from "react";

function format(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function Countdown({ untilMs }: { untilMs: number }) {
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, untilMs - Date.now()));

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRemainingMs(Math.max(0, untilMs - Date.now()));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [untilMs]);

  return <span>{format(remainingMs)}</span>;
}
