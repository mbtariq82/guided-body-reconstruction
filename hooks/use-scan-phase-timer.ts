"use client";

import { useEffect, useRef, useState } from "react";
import { SCAN_STEPS } from "@/lib/scan-machine";
import type { ScanState } from "@/types/scan";

export function useScanPhaseTimer(
  state: ScanState,
  onComplete: () => void,
  isRunning = true,
  canComplete = true,
) {
  const step = SCAN_STEPS[state];
  const [progress, setProgress] = useState(0);
  const isRunningRef = useRef(isRunning);
  const canCompleteRef = useRef(canComplete);

  useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);

  useEffect(() => {
    canCompleteRef.current = canComplete;
  }, [canComplete]);

  useEffect(() => {
    setProgress(0);

    if (!step.autoAdvance || step.durationMs <= 0) {
      return;
    }

    let acceptedElapsedMs = 0;
    let previousTickAt = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();

      if (isRunningRef.current) {
        acceptedElapsedMs += now - previousTickAt;
      }

      previousTickAt = now;

      const rawProgress = (acceptedElapsedMs / step.durationMs) * 100;
      const nextProgress = Math.min(100, rawProgress);
      setProgress(nextProgress);

      if (nextProgress >= 100 && canCompleteRef.current) {
        window.clearInterval(timer);
        onComplete();
      }
    }, 80);

    return () => window.clearInterval(timer);
  }, [onComplete, state, step.autoAdvance, step.durationMs]);

  return progress;
}
