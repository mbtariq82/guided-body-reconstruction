import {
  AlertTriangle,
  BadgeCheck,
  Box,
  CheckCircle2,
  Cpu,
  Database,
  Download,
  ImageIcon,
  RefreshCw,
  RotateCcw,
  Ruler,
  UploadCloud,
  Video,
} from "lucide-react";
import { PrimaryButton, PrimaryLink } from "@/components/ui/primary-button";
import type {
  BodyMeasurementReport,
  CapturePhaseSummary,
  CaptureQualityStatus,
  CaptureSessionSummary,
  CaptureUploadState,
  ScanState,
} from "@/types/scan";
import { cn } from "@/utils/cn";

type FinishScreenProps = {
  onExport: () => void;
  onProcess: () => void;
  onRefreshProcessing: () => void;
  onRetakePhase: (state: ScanState) => void;
  onRestart: () => void;
  onSubjectHeightChange: (heightCm: number | null) => void;
  onUpload: () => void;
  sessionSummary: CaptureSessionSummary;
  subjectHeightCm: number | null;
  uploadState: CaptureUploadState;
};

const statusStyles: Record<CaptureQualityStatus, string> = {
  ready: "bg-[#e6f7ec] text-[#12662f] ring-[#bce8ca]",
  review: "bg-[#fff4d8] text-[#7a4d00] ring-[#f1d58a]",
  missing: "bg-[#ffe8e3] text-[#8b2616] ring-[#efb9ae]",
};

const statusIcons: Record<CaptureQualityStatus, typeof CheckCircle2> = {
  ready: CheckCircle2,
  review: AlertTriangle,
  missing: AlertTriangle,
};

export function FinishScreen({
  onExport,
  onProcess,
  onRefreshProcessing,
  onRetakePhase,
  onRestart,
  onSubjectHeightChange,
  onUpload,
  sessionSummary,
  subjectHeightCm,
  uploadState,
}: FinishScreenProps) {
  const hasValidHeight = isValidSubjectHeight(subjectHeightCm);
  const summaryItems = [
    {
      icon: BadgeCheck,
      label: "Capture states",
      value: `${sessionSummary.capturedStates.length} completed`,
    },
    { icon: Database, label: "Dataset", value: `${sessionSummary.frameCount} approved frames` },
    {
      icon: Video,
      label: "Temporal capture",
      value: getVideoSummaryLabel(sessionSummary),
    },
    {
      icon: Box,
      label: "Ready for",
      value: sessionSummary.isExportReady ? "ZIP export" : "Retake review",
    },
    {
      icon: Ruler,
      label: "Height",
      value: hasValidHeight ? `${subjectHeightCm} cm` : "Required",
    },
  ];
  const canExport = sessionSummary.isExportReady;
  const canUpload =
    canExport &&
    hasValidHeight &&
    !uploadState.job &&
    uploadState.status !== "uploading" &&
    uploadState.status !== "processing";
  const canProcessLocally =
    uploadState.job?.status === "queued" && uploadState.status !== "processing";
  const canRefreshProcessing =
    Boolean(uploadState.job) &&
    uploadState.status !== "uploading" &&
    uploadState.status !== "processing";
  const reconstructionHref = uploadState.sessionId
    ? `/sessions/${encodeURIComponent(uploadState.sessionId)}`
    : "/sessions";
  const canOpenReconstruction =
    uploadState.job?.status === "completed" && Boolean(uploadState.measurementReport);
  const passedValidationChecks =
    uploadState.validationReport?.checks.filter((check) => check.status === "passed").length ??
    0;
  const ReviewStatusIcon = statusIcons[sessionSummary.reviewStatus];

  return (
    <main className="grid min-h-svh place-items-center bg-[#f5f5f2] px-5 py-8 text-[#111312]">
      <section className="w-full max-w-6xl">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#111312] text-white">
          <BadgeCheck size={28} />
        </div>
        <p className="mt-8 text-center text-sm font-semibold uppercase text-[#68706a]">
          Scan complete
        </p>
        <h1 className="mx-auto mt-4 max-w-2xl text-center text-balance text-4xl font-semibold leading-tight sm:text-5xl">
          The reconstruction dataset is ready.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-center text-pretty text-lg leading-8 text-[#59615b]">
          Quality-approved frames, temporal video, camera metadata, segmentation, pose evidence, and the metric height anchor are ready for processing.
        </p>

        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {summaryItems.map((item) => (
            <article
              key={item.label}
              className="rounded-[8px] border border-black/8 bg-white p-5 shadow-[0_18px_60px_rgba(20,24,22,0.08)]"
            >
              <item.icon className="h-5 w-5 text-[#1e5cff]" />
              <p className="mt-8 text-sm text-[#68706a]">{item.label}</p>
              <p className="mt-1 text-lg font-semibold text-[#171918]">{item.value}</p>
            </article>
          ))}
        </div>

        <div className="mx-auto mt-6 max-w-xl rounded-[8px] border border-black/8 bg-white px-5 py-4 text-center text-sm leading-6 text-[#59615b]">
          Session <span className="font-semibold text-[#171918]">{sessionSummary.id}</span>
        </div>

        <section className="mx-auto mt-5 grid max-w-3xl gap-4 rounded-[8px] border border-black/8 bg-white p-5 shadow-[0_18px_60px_rgba(20,24,22,0.08)] sm:grid-cols-[1fr_220px] sm:items-center">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-[#171918]">
              <Ruler size={18} />
              Measurement calibration
            </div>
            <p className="mt-2 text-sm leading-6 text-[#59615b]">
              Height anchors the local estimator to real-world scale before upload.
            </p>
          </div>
          <label className="block">
            <span className="text-xs font-semibold uppercase text-[#68706a]">
              Height in cm
            </span>
            <input
              className={cn(
                "mt-2 h-12 w-full rounded-[8px] border bg-[#f5f5f2] px-4 text-base font-semibold text-[#171918] outline-none ring-0 transition focus:border-[#1e5cff]",
                hasValidHeight ? "border-black/10" : "border-[#d9903d]",
              )}
              inputMode="decimal"
              max={230}
              min={120}
              onChange={(event) => {
                const nextValue = Number.parseFloat(event.target.value);
                onSubjectHeightChange(Number.isFinite(nextValue) ? nextValue : null);
              }}
              placeholder="178"
              type="number"
              value={subjectHeightCm ?? ""}
            />
            <span
              className={cn(
                "mt-2 block text-xs font-medium",
                hasValidHeight ? "text-[#68706a]" : "text-[#8b4b0a]",
              )}
            >
              Required for local measurement extraction.
            </span>
          </label>
        </section>

        <section className="mt-10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase text-[#68706a]">Quality review</p>
              <h2 className="mt-2 text-2xl font-semibold text-[#171918]">
                Check the captured phases before export.
              </h2>
            </div>
            <span
              className={cn(
                "inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold ring-1",
                statusStyles[sessionSummary.reviewStatus],
              )}
            >
              <ReviewStatusIcon size={17} />
              {sessionSummary.reviewStatus === "ready"
                ? "Export ready"
                : "Retake recommended"}
            </span>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {sessionSummary.phaseSummaries.map((phase) => (
              <PhaseReviewCard
                key={phase.state}
                onRetake={() => onRetakePhase(phase.state)}
                phase={phase}
              />
            ))}
          </div>
        </section>

        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <PrimaryButton onClick={onRestart}>
            <RotateCcw size={18} />
            Run Another Scan
          </PrimaryButton>
          <PrimaryButton disabled={!canExport} onClick={onExport} variant="dark">
            Export Session
            <Download size={18} />
          </PrimaryButton>
          <PrimaryButton disabled={!canUpload} onClick={onUpload} variant="dark">
            {uploadState.status === "uploaded"
              ? "Uploaded"
              : uploadState.status === "uploading"
                ? "Uploading..."
                : "Upload Session"}
            <UploadCloud size={18} />
          </PrimaryButton>
          <PrimaryButton
            disabled={!canProcessLocally}
            onClick={onProcess}
            variant="dark"
          >
            {uploadState.status === "processing" ? "Processing..." : "Process Locally"}
            <Cpu size={18} />
          </PrimaryButton>
          <PrimaryButton
            disabled={!canRefreshProcessing}
            onClick={onRefreshProcessing}
            variant="dark"
          >
            Refresh Status
            <RefreshCw size={18} />
          </PrimaryButton>
          {canOpenReconstruction ? (
            <PrimaryLink href={reconstructionHref} native variant="dark">
              Open Reconstruction
              <Box size={18} />
            </PrimaryLink>
          ) : null}
          <PrimaryLink href="/sessions" native variant="dark">
            Sessions
            <Database size={18} />
          </PrimaryLink>
        </div>

        {uploadState.status !== "idle" ? (
          <div className="mx-auto mt-4 max-w-xl rounded-[8px] border border-black/8 bg-white px-4 py-3 text-center text-sm leading-6 text-[#59615b] shadow-[0_18px_60px_rgba(20,24,22,0.08)]">
            <p>{uploadState.message}</p>
            {uploadState.job ? (
              <p className="mt-1 font-semibold text-[#171918]">
                Job {uploadState.job.id}: {uploadState.job.status} / {uploadState.job.stage}
              </p>
            ) : null}
            {uploadState.validationReport ? (
              <div className="mt-4 border-t border-black/8 pt-4 text-left">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase text-[#68706a]">
                    Validation report
                  </p>
                  <span
                    className={cn(
                      "inline-flex min-h-7 items-center rounded-full px-3 text-xs font-semibold ring-1",
                      uploadState.validationReport.status === "passed"
                        ? "bg-[#e6f7ec] text-[#12662f] ring-[#bce8ca]"
                        : "bg-[#ffe8e3] text-[#8b2616] ring-[#efb9ae]",
                    )}
                  >
                    {uploadState.validationReport.status}
                  </span>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <ReportStat
                    label="Checks"
                    value={`${passedValidationChecks}/${uploadState.validationReport.checks.length}`}
                  />
                  <ReportStat
                    label="Frames"
                    value={String(uploadState.validationReport.summary.frameCount)}
                  />
                  <ReportStat
                    label="Camera"
                    value={uploadState.validationReport.summary.cameraMode}
                  />
                </div>
                {uploadState.validationReport.blockingIssues.length > 0 ? (
                  <p className="mt-3 rounded-[8px] bg-[#fff4d8] px-3 py-2 text-sm text-[#7a4d00]">
                    {uploadState.validationReport.blockingIssues[0]}
                  </p>
                ) : null}
              </div>
            ) : null}
            {uploadState.measurementReport ? (
              <MeasurementReportPanel report={uploadState.measurementReport} />
            ) : null}
            {canOpenReconstruction ? (
              <div className="mt-4 rounded-[8px] bg-[#111312] p-4 text-left text-white">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Video size={18} />
                  Reconstruction workbench is ready
                </div>
                <p className="mt-2 text-sm leading-6 text-white/68">
                  Inspect the recovered human surface, silhouette, topology, geometry counts, measurements, and source model assets.
                </p>
                <PrimaryLink className="mt-4 w-full" href={reconstructionHref} native variant="light">
                  Open Reconstruction
                  <Box size={18} />
                </PrimaryLink>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}

function getVideoSummaryLabel(summary: CaptureSessionSummary) {
  if (summary.videoCount > 0) {
    return `${Math.max(1, Math.round(summary.videoDurationMs / 1000))}s guided video`;
  }

  if (summary.videoStatus === "finalizing" || summary.videoStatus === "recording") {
    return "Finalizing";
  }

  if (summary.videoStatus === "not-applicable") {
    return "Mock frames only";
  }

  return "Frames available";
}

function MeasurementReportPanel({ report }: { report: BodyMeasurementReport }) {
  return (
    <div className="mt-4 border-t border-black/8 pt-4 text-left">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase text-[#68706a]">
          Measurement output
        </p>
        <span
          className={cn(
            "inline-flex min-h-7 items-center rounded-full px-3 text-xs font-semibold ring-1",
            report.status === "estimated"
              ? "bg-[#e6f7ec] text-[#12662f] ring-[#bce8ca]"
              : "bg-[#fff4d8] text-[#7a4d00] ring-[#f1d58a]",
          )}
        >
          {report.status}
        </span>
      </div>
      {report.measurements.length > 0 ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {report.measurements.map((measurement) => (
            <ReportStat
              key={measurement.key}
              label={measurement.label}
              value={`${measurement.valueCm} cm`}
            />
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm leading-6 text-[#59615b]">
          Measurement extraction did not have enough calibrated geometry.
        </p>
      )}
      {report.warnings[0] ? (
        <p className="mt-3 rounded-[8px] bg-[#fff4d8] px-3 py-2 text-sm text-[#7a4d00]">
          {report.warnings[0]}
        </p>
      ) : null}
    </div>
  );
}

function ReportStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] bg-[#f5f5f2] px-3 py-2">
      <p className="text-xs font-semibold uppercase text-[#68706a]">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-[#171918]">{value}</p>
    </div>
  );
}

function isValidSubjectHeight(heightCm: number | null): heightCm is number {
  return typeof heightCm === "number" && heightCm >= 120 && heightCm <= 230;
}

function PhaseReviewCard({
  onRetake,
  phase,
}: {
  onRetake: () => void;
  phase: CapturePhaseSummary;
}) {
  const StatusIcon = statusIcons[phase.status];

  return (
    <article className="overflow-hidden rounded-[8px] border border-black/8 bg-white shadow-[0_18px_60px_rgba(20,24,22,0.08)]">
      <div className="relative aspect-[4/5] bg-[#171918]">
        {phase.thumbnailDataUrl ? (
          <img
            alt={`${phase.label} capture`}
            className="h-full w-full object-cover"
            src={phase.thumbnailDataUrl}
          />
        ) : (
          <div className="grid h-full place-items-center text-white/45">
            <ImageIcon size={30} />
          </div>
        )}
        <span
          className={cn(
            "absolute left-3 top-3 inline-flex min-h-8 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-semibold ring-1",
            statusStyles[phase.status],
          )}
        >
          <StatusIcon size={14} />
          {phase.statusLabel}
        </span>
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-[#171918]">{phase.label}</h3>
            <p className="mt-1 text-sm text-[#68706a]">
              {phase.frameCount} / {phase.minimumFrameCount}+ min · target {phase.targetFrameCount}
            </p>
          </div>
        </div>

        <p className="mt-4 min-h-10 text-sm leading-5 text-[#59615b]">
          {phase.issues.length > 0 ? phase.issues.join(", ") : "Coverage looks consistent."}
        </p>

        <button
          aria-label={`Retake ${phase.label}`}
          className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-full bg-[#111312] px-4 text-sm font-semibold text-white transition hover:bg-black"
          onClick={onRetake}
          type="button"
        >
          <RotateCcw size={16} />
          Retake
        </button>
      </div>
    </article>
  );
}
