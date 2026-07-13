import { CheckCircle2, Circle, TriangleAlert } from "lucide-react";
import type { MetricTone, ScanMetric } from "@/types/scan";
import { cn } from "@/utils/cn";

type ScanMetricsPanelProps = {
  metrics: ScanMetric[];
};

const toneIcon: Record<MetricTone, typeof CheckCircle2> = {
  good: CheckCircle2,
  warning: TriangleAlert,
  neutral: Circle,
};

export function ScanMetricsPanel({ metrics }: ScanMetricsPanelProps) {
  return (
    <div className="rounded-[8px] border border-white/14 bg-black/36 p-4 shadow-[0_22px_70px_rgba(0,0,0,0.26)] backdrop-blur-xl">
      <p className="text-xs font-semibold uppercase text-white/48">Live checks</p>
      <div className="mt-4 space-y-3">
        {metrics.map((metric) => {
          const Icon = toneIcon[metric.tone];

          return (
            <div key={metric.label} className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm text-white/54">{metric.label}</p>
                <p className="text-base font-semibold">{metric.value}</p>
              </div>
              <Icon
                className={cn(
                  "h-5 w-5",
                  metric.tone === "good" && "text-[#7bf0a3]",
                  metric.tone === "warning" && "text-[#ffd36e]",
                  metric.tone === "neutral" && "text-white/46",
                )}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
