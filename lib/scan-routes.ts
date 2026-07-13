import { SCAN_SEQUENCE } from "@/lib/scan-machine";
import type { ScanState } from "@/types/scan";

export type AppView = "landing" | ScanState;

const appViews = new Set<AppView>(["landing", ...SCAN_SEQUENCE]);

export function getStepHref(view: AppView): string {
  if (view === "landing") {
    return "/";
  }

  return `/?step=${view}`;
}

export function isAppView(value: string): value is AppView {
  return appViews.has(value as AppView);
}

export function getAppViewFromStepParam(
  step: string | string[] | undefined,
): AppView {
  const normalizedStep = Array.isArray(step) ? step[0] : step;

  if (!normalizedStep || !isAppView(normalizedStep)) {
    return "landing";
  }

  return normalizedStep;
}
