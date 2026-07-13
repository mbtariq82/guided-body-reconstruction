import { notFound } from "next/navigation";
import {
  ArrowLeft,
  BadgeCheck,
  Camera,
  Database,
  FileArchive,
  Home,
  Ruler,
  ShieldCheck,
} from "lucide-react";
import { ReconstructionAvatarViewer } from "@/components/sessions/reconstruction-avatar-viewer";
import { AvatarReconstructionPanel } from "@/components/sessions/avatar-reconstruction-panel";
import { ProcessSessionButton } from "@/components/sessions/process-session-button";
import { readAvatarReconstructionState } from "@/scripts/avatar-reconstruction-service.mjs";
import { readScanSessionDetail } from "@/scripts/process-scan-jobs.mjs";
import type {
  BodyMeasurementReport,
  ScanMetric,
  ScanSessionDetail,
  ScanSessionDetailFrame,
} from "@/types/scan";
import { cn } from "@/utils/cn";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SessionDetailPageProps = {
  params: Promise<{
    sessionId: string;
  }>;
};

export default async function SessionDetailPage({ params }: SessionDetailPageProps) {
  const { sessionId } = await params;
  const detail = await getSessionDetail(sessionId);
  const reconstructionState = await readAvatarReconstructionState(sessionId);
  const passedChecks =
    detail.session.validationReport?.checks.filter((check) => check.status === "passed")
      .length ?? 0;
  const totalChecks = detail.session.validationReport?.checks.length ?? 0;

  return (
    <main className="min-h-svh bg-[#f5f5f2] px-5 py-8 text-[#111312]">
      <section className="mx-auto w-full max-w-7xl">
        <div className="flex flex-col gap-5 border-b border-black/10 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap gap-2">
              <a
                className="inline-flex min-h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-[#171918] ring-1 ring-black/10 transition hover:bg-[#eeeeea]"
                href="/sessions"
              >
                <ArrowLeft size={16} />
                Sessions
              </a>
              <a
                className="inline-flex min-h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-[#171918] ring-1 ring-black/10 transition hover:bg-[#eeeeea]"
                href="/"
              >
                <Home size={16} />
                Home
              </a>
            </div>
            <p className="mt-8 text-sm font-semibold uppercase text-[#68706a]">
              Scan session detail
            </p>
            <h1 className="mt-3 break-words text-3xl font-semibold leading-tight sm:text-5xl">
              {detail.session.sessionId}
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-[#59615b]">
              Uploaded {formatDate(detail.session.storedAt)} with{" "}
              {detail.frames.length} extracted frames.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusPill
              label="job"
              status={detail.session.processingJob?.status ?? "missing"}
            />
            <StatusPill
              label="validation"
              status={detail.session.validationReport?.status ?? "missing"}
            />
            {detail.session.processingJob?.status === "queued" ? (
              <ProcessSessionButton sessionId={detail.session.sessionId} />
            ) : null}
          </div>
        </div>

        <div className="mt-8 grid gap-3 md:grid-cols-4">
          <DashboardStat icon={Camera} label="Camera" value={detail.session.cameraMode} />
          <DashboardStat icon={Database} label="Frames" value={String(detail.frames.length)} />
          <DashboardStat
            icon={FileArchive}
            label="Archive"
            value={formatBytes(detail.session.archive.size)}
          />
          <DashboardStat
            icon={BadgeCheck}
            label="Checks"
            value={totalChecks > 0 ? `${passedChecks}/${totalChecks}` : "none"}
          />
        </div>

        {detail.avatarMesh ? (
          <ReconstructionAvatarViewer
            avatarMesh={detail.avatarMesh}
            reconstructionAssets={reconstructionState.assets}
          />
        ) : null}

        {detail.avatarMesh ? (
          <AvatarReconstructionPanel
            aiReport={detail.avatarMesh.aiReconstruction}
            initialState={reconstructionState}
            sessionId={detail.session.sessionId}
          />
        ) : null}

        <div className="mt-6 grid min-w-0 gap-4 lg:grid-cols-2">
          <section className="min-w-0 rounded-[8px] border border-black/8 bg-white p-5 shadow-[0_18px_60px_rgba(20,24,22,0.08)]">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#171918]">
              <ShieldCheck size={18} />
              Validation checks
            </div>
            {detail.session.validationReport ? (
              <div className="mt-4 grid gap-2">
                {detail.session.validationReport.checks.map((check) => (
                  <div
                    className="flex flex-col gap-2 rounded-[8px] bg-[#f5f5f2] px-3 py-3 sm:flex-row sm:items-start sm:justify-between"
                    key={check.id}
                  >
                    <div>
                      <p className="text-sm font-semibold text-[#171918]">{check.label}</p>
                      <p className="mt-1 text-sm leading-5 text-[#59615b]">{check.detail}</p>
                    </div>
                    <span
                      className={cn(
                        "inline-flex min-h-7 shrink-0 items-center rounded-full px-3 text-xs font-semibold uppercase ring-1",
                        check.status === "passed"
                          ? "bg-[#e6f7ec] text-[#12662f] ring-[#bce8ca]"
                          : "bg-[#ffe8e3] text-[#8b2616] ring-[#efb9ae]",
                      )}
                    >
                      {check.status}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm leading-6 text-[#59615b]">
                This session has not produced a validation report yet.
              </p>
            )}
          </section>

          <section className="min-w-0 rounded-[8px] border border-black/8 bg-white p-5 shadow-[0_18px_60px_rgba(20,24,22,0.08)]">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#171918]">
              <Ruler size={18} />
              Body measurements
            </div>
            {detail.measurementReport ? (
              <MeasurementReport report={detail.measurementReport} />
            ) : (
              <p className="mt-4 text-sm leading-6 text-[#59615b]">
                Body measurements appear after local processing passes validation.
              </p>
            )}
          </section>
        </div>

        <section className="mt-8">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase text-[#68706a]">Captured frames</p>
              <h2 className="mt-2 text-2xl font-semibold text-[#171918]">
                Review the scan image set.
              </h2>
            </div>
            <p className="text-sm font-semibold text-[#68706a]">
              Manifest {detail.manifest?.schemaVersion ?? "unknown"}
            </p>
          </div>

          {detail.frames.length > 0 ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {detail.frames.map((frame) => (
                <FrameCard frame={frame} key={`${frame.id}-${frame.fileName}`} />
              ))}
            </div>
          ) : (
            <div className="mt-5 rounded-[8px] border border-black/8 bg-white p-8 text-center shadow-[0_18px_60px_rgba(20,24,22,0.08)]">
              <FileArchive className="mx-auto h-8 w-8 text-[#68706a]" />
              <p className="mt-4 text-sm leading-6 text-[#59615b]">
                No frame files could be extracted from this session archive.
              </p>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function MeasurementReport({ report }: { report: BodyMeasurementReport }) {
  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm leading-6 text-[#59615b]">
          {report.provider.name} · {report.provider.mode}
        </p>
        <span
          className={cn(
            "inline-flex min-h-8 items-center rounded-full px-3 text-xs font-semibold uppercase ring-1",
            report.status === "estimated"
              ? "bg-[#e6f7ec] text-[#12662f] ring-[#bce8ca]"
              : "bg-[#fff4d8] text-[#7a4d00] ring-[#f1d58a]",
          )}
        >
          {report.status}
        </span>
      </div>
      {report.measurements.length > 0 ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {report.measurements.map((measurement) => (
            <div key={measurement.key} className="rounded-[8px] bg-[#f5f5f2] px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[#171918]">{measurement.label}</p>
                  <p className="mt-1 text-xs font-semibold uppercase text-[#68706a]">
                    {measurement.confidence} confidence
                  </p>
                </div>
                <p className="text-lg font-semibold text-[#171918]">
                  {measurement.valueCm} cm
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {report.warnings.length > 0 ? (
        <div className="mt-4 grid gap-2">
          {report.warnings.slice(0, 3).map((warning) => (
            <p
              className="rounded-[8px] bg-[#fff4d8] px-3 py-2 text-sm leading-6 text-[#7a4d00]"
              key={warning}
            >
              {warning}
            </p>
          ))}
        </div>
      ) : null}
      <pre className="mt-4 w-full max-w-full overflow-auto rounded-[8px] bg-[#111312] p-4 text-xs leading-5 text-white/82 sm:max-h-[360px]">
        {JSON.stringify(report, null, 2)}
      </pre>
    </div>
  );
}

async function getSessionDetail(sessionId: string): Promise<ScanSessionDetail> {
  try {
    return await readScanSessionDetail(sessionId);
  } catch {
    notFound();
  }
}

function FrameCard({ frame }: { frame: ScanSessionDetailFrame }) {
  return (
    <article className="overflow-hidden rounded-[8px] border border-black/8 bg-white shadow-[0_18px_60px_rgba(20,24,22,0.08)]">
      <div className="aspect-[4/5] bg-[#171918]">
        {frame.dataUrl ? (
          <img
            alt={`${frame.stateLabel} frame ${frame.fileName}`}
            className="h-full w-full object-cover"
            src={frame.dataUrl}
          />
        ) : (
          <div className="grid h-full place-items-center text-white/46">
            <FileArchive size={28} />
          </div>
        )}
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-[#171918]">
              {frame.stateLabel}
            </h3>
            <p className="mt-1 truncate text-sm text-[#68706a]">{frame.fileName}</p>
          </div>
          <span className="shrink-0 rounded-full bg-[#f5f5f2] px-2 py-1 text-xs font-semibold text-[#68706a]">
            {frame.phaseProgress}%
          </span>
        </div>
        <p className="mt-3 text-xs font-semibold uppercase text-[#68706a]">
          {frame.width} x {frame.height}
        </p>
        <MetricList metrics={frame.metrics} />
      </div>
    </article>
  );
}

function MetricList({ metrics }: { metrics: ScanMetric[] }) {
  if (metrics.length === 0) {
    return <p className="mt-3 text-sm text-[#59615b]">No frame metrics.</p>;
  }

  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {metrics.slice(0, 4).map((metric) => (
        <span
          className={cn(
            "rounded-full px-2 py-1 text-xs font-semibold",
            metric.tone === "good" && "bg-[#e6f7ec] text-[#12662f]",
            metric.tone === "warning" && "bg-[#fff4d8] text-[#7a4d00]",
            metric.tone === "neutral" && "bg-[#ecefed] text-[#59615b]",
          )}
          key={`${metric.label}-${metric.value}`}
        >
          {metric.label}: {metric.value}
        </span>
      ))}
    </div>
  );
}

function DashboardStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Camera;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[8px] border border-black/8 bg-white px-4 py-4 shadow-[0_18px_60px_rgba(20,24,22,0.08)]">
      <Icon className="h-4 w-4 text-[#1e5cff]" />
      <p className="mt-5 text-xs font-semibold uppercase text-[#68706a]">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold text-[#171918]">{value}</p>
    </div>
  );
}

function StatusPill({ label, status }: { label: string; status: string }) {
  const isGood = status === "completed" || status === "passed";
  const isBad = status === "failed" || status === "missing";

  return (
    <span
      className={cn(
        "inline-flex min-h-8 items-center rounded-full px-3 text-xs font-semibold uppercase ring-1",
        isGood && "bg-[#e6f7ec] text-[#12662f] ring-[#bce8ca]",
        isBad && "bg-[#ffe8e3] text-[#8b2616] ring-[#efb9ae]",
        !isGood && !isBad && "bg-[#fff4d8] text-[#7a4d00] ring-[#f1d58a]",
      )}
    >
      {label}: {status}
    </span>
  );
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 KB";
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string | null) {
  if (!value) {
    return "unknown";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
