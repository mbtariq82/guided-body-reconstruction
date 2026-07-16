import type { ScanState } from "@/types/scan";
import { cn } from "@/utils/cn";

type SilhouetteOverlayProps = {
  state: ScanState;
};

export function SilhouetteOverlay({ state }: SilhouetteOverlayProps) {
  const isSide = state === "side-view" || state === "right-side-view";
  const isBack = state === "back-view";
  const isIdentityDetail = state === "identity-detail";
  const isHandDetail = state === "hand-detail";

  if (isHandDetail) {
    return (
      <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center px-6 py-24">
        <div className="relative h-[min(54vh,520px)] w-[min(88vw,620px)]">
          <div className="absolute left-[2%] top-[14%] h-[64%] w-[38%] rounded-[42%] border-2 border-[#9eb8ff]/80 bg-white/[0.02]" />
          <div className="absolute right-[2%] top-[14%] h-[64%] w-[38%] rounded-[42%] border-2 border-[#9eb8ff]/80 bg-white/[0.02]" />
          <div className="absolute bottom-[2%] left-[18%] h-[20%] w-[6%] border-x-2 border-white/55" />
          <div className="absolute bottom-[2%] right-[18%] h-[20%] w-[6%] border-x-2 border-white/55" />
        </div>
      </div>
    );
  }

  if (isIdentityDetail) {
    return (
      <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center px-6 py-24">
        <div className="relative h-[min(60vh,560px)] w-[min(86vw,520px)]">
          <div className="absolute left-1/2 top-[4%] h-[44%] w-[38%] -translate-x-1/2 rounded-[46%] border-2 border-white/64 bg-white/[0.02]" />
          <div className="absolute bottom-[5%] left-1/2 h-[52%] w-[68%] -translate-x-1/2 rounded-t-[46%] border-x-2 border-t-2 border-white/58" />
        </div>
      </div>
    );
  }

  if (state === "arm-span" || state === "overhead-reach" || state === "wide-stance") {
    const isOverhead = state === "overhead-reach";
    const isWideStance = state === "wide-stance";

    return (
      <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center px-4 py-24">
        <div className="relative h-[min(70vh,700px)] w-[min(88vw,700px)]">
          <div className="absolute left-1/2 top-[5%] h-[12%] w-[11%] -translate-x-1/2 rounded-full border-2 border-white/64 bg-white/[0.02]" />
          <div className="absolute left-1/2 top-[19%] h-[42%] w-[20%] -translate-x-1/2 rounded-[46%] border-2 border-white/62 bg-white/[0.02]" />
          {!isWideStance ? (
            <>
              <div
                className={cn(
                  "absolute h-[2px] origin-right bg-[#9eb8ff]/80",
                  isOverhead
                    ? "left-[12%] top-[19%] w-[37%] rotate-[48deg]"
                    : "left-[7%] top-[27%] w-[42%]",
                )}
              />
              <div
                className={cn(
                  "absolute h-[2px] origin-left bg-[#9eb8ff]/80",
                  isOverhead
                    ? "right-[12%] top-[19%] w-[37%] -rotate-[48deg]"
                    : "right-[7%] top-[27%] w-[42%]",
                )}
              />
            </>
          ) : null}
          <div
            className={cn(
              "absolute top-[59%] h-[34%] w-[2px] origin-top bg-white/62",
              isWideStance ? "left-[42%] rotate-[12deg]" : "left-[46%] rotate-[4deg]",
            )}
          />
          <div
            className={cn(
              "absolute top-[59%] h-[34%] w-[2px] origin-top bg-white/62",
              isWideStance ? "right-[42%] -rotate-[12deg]" : "right-[46%] -rotate-[4deg]",
            )}
          />
          <div className="absolute bottom-2 left-1/2 h-[1px] w-[78%] -translate-x-1/2 bg-[#87a9ff]/70" />
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
