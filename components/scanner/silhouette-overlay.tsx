import type { ScanState } from "@/types/scan";
import { cn } from "@/utils/cn";

type SilhouetteOverlayProps = {
  state: ScanState;
};

export function SilhouetteOverlay({ state }: SilhouetteOverlayProps) {
  const isSide = state === "side-view" || state === "right-side-view";
  const isBack = state === "back-view";
  const isIdentityDetail = state === "identity-detail";

  if (isIdentityDetail) {
    return (
      <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center px-6 py-24">
        <div className="relative h-[min(60vh,560px)] w-[min(86vw,520px)]">
          <div className="absolute left-1/2 top-[4%] h-[44%] w-[38%] -translate-x-1/2 rounded-[46%] border-2 border-white/64 bg-white/[0.02]" />
          <div className="absolute bottom-[5%] left-1/2 h-[52%] w-[68%] -translate-x-1/2 rounded-t-[46%] border-x-2 border-t-2 border-white/58" />
          <div className="absolute bottom-[30%] left-[1%] h-[22%] w-[18%] rounded-[42%] border-2 border-[#9eb8ff]/80" />
          <div className="absolute bottom-[30%] right-[1%] h-[22%] w-[18%] rounded-[42%] border-2 border-[#9eb8ff]/80" />
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center px-6 py-24">
      <div className="relative h-[min(68vh,680px)] w-[min(48vw,330px)] min-w-[210px]">
        <div className="absolute inset-0 rounded-full border border-white/22 shadow-[0_0_0_1px_rgba(110,160,255,0.24),0_0_60px_rgba(67,124,255,0.2)]" />
        <div className="absolute left-1/2 top-[6%] h-[14%] w-[28%] -translate-x-1/2 rounded-full border-2 border-white/62 bg-white/[0.02]" />
        <div
          className={cn(
            "absolute left-1/2 top-[22%] h-[41%] -translate-x-1/2 rounded-[48%] border-2 border-white/62 bg-white/[0.02]",
            isSide ? "w-[28%]" : "w-[46%]",
            isBack && "border-[#9eb8ff]/80",
          )}
        />
        <div
          className={cn(
            "absolute left-1/2 top-[31%] h-[2px] -translate-x-1/2 bg-white/58",
            isSide ? "w-[34%]" : "w-[68%]",
          )}
        />
        <div className="absolute left-[33%] top-[61%] h-[30%] w-[2px] rotate-6 bg-white/58" />
        <div className="absolute right-[33%] top-[61%] h-[30%] w-[2px] -rotate-6 bg-white/58" />
        <div className="absolute bottom-2 left-1/2 h-[1px] w-[76%] -translate-x-1/2 bg-[#87a9ff]/70" />
      </div>
    </div>
  );
}
