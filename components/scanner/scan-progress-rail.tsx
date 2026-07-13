import { SCAN_SEQUENCE, SCAN_STEPS } from "@/lib/scan-machine";
import type { ScanState } from "@/types/scan";
import { cn } from "@/utils/cn";

type ScanProgressRailProps = {
  activeState: ScanState;
  phaseProgress: number;
};

const visibleStates = SCAN_SEQUENCE.filter(
  (state) => !["introduction", "camera-permission", "finish"].includes(state),
);

export function ScanProgressRail({ activeState, phaseProgress }: ScanProgressRailProps) {
  const activeIndex = visibleStates.indexOf(activeState);

  return (
    <div className="pointer-events-none">
      <div className="mb-2 hidden items-center justify-between sm:flex">
        <p className="text-xs font-semibold uppercase text-white/48">Progress</p>
        <p className="text-xs font-semibold text-white/66">
          {Math.max(0, activeIndex + 1)} / {visibleStates.length}
        </p>
      </div>
      <div
        className="grid gap-1 rounded-full bg-black/16 p-1.5 ring-1 ring-white/12 backdrop-blur"
        style={{ gridTemplateColumns: `repeat(${visibleStates.length}, minmax(0, 1fr))` }}
      >
        {visibleStates.map((state, index) => {
          const isActive = state === activeState;
          const isComplete = index < activeIndex;

          return (
            <div key={state} className="min-w-0">
              <div className="h-1.5 overflow-hidden rounded-full bg-white/18">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-200",
                    isComplete && "w-full bg-[#7bf0a3]",
                    isActive && "bg-[#87a9ff]",
                    !isComplete && !isActive && "w-0 bg-white/20",
                  )}
                  style={isActive ? { width: `${Math.max(8, phaseProgress)}%` } : undefined}
                />
              </div>
              <p className="mt-2 hidden truncate text-[11px] font-medium text-white/54 sm:block">
                {SCAN_STEPS[state].shortLabel}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
