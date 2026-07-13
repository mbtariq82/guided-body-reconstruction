"use client";

import { useEffect, useMemo, useState } from "react";
import { getGuidanceForState, getMockMetricsForState } from "@/lib/mock-vision";
import type { ScanMetric, ScanState } from "@/types/scan";

export function useMockGuidance(state: ScanState, active: boolean) {
  const guidance = useMemo(() => getGuidanceForState(state), [state]);
  const metrics = useMemo<ScanMetric[]>(() => getMockMetricsForState(state), [state]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [state]);

  useEffect(() => {
    if (!active || guidance.length <= 1) {
      return;
    }

    const timer = window.setInterval(() => {
      setIndex((currentIndex) => (currentIndex + 1) % guidance.length);
    }, 2300);

    return () => window.clearInterval(timer);
  }, [active, guidance.length]);

  return {
    instruction: guidance[index] ?? guidance[0] ?? "",
    metrics,
  };
}
