import {
  ArrowRight,
  BadgeCheck,
  Camera,
  Database,
  FileArchive,
  Home,
  Ruler,
  ShieldCheck,
} from "lucide-react";
import { ProcessSessionButton } from "@/components/sessions/process-session-button";
import { listScanSessions } from "@/scripts/process-scan-jobs.mjs";
import type {
  ScanProcessingJobStatus,
  ScanSessionListItem,
  ScanValidationReportStatus,
} from "@/types/scan";
import { cn } from "@/utils/cn";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function SessionsPage() {
  const sessions = await listScanSessions();

  return (
    <main className="min-h-svh bg-[#f5f5f2] px-5 py-8 text-[#111312]">
      <section className="mx-auto w-full max-w-6xl">
        <div className="flex flex-col gap-5 border-b border-black/10 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <a
              className="inline-flex min-h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-[#171918] ring-1 ring-black/10 transition hover:bg-[#eeeeea]"
              href="/"
            >
              <Home size={16} />
              Home
            </a>
            <p className="mt-8 text-sm font-semibold uppercase text-[#68706a]">
              Local scan sessions
            </p>
            <h1 className="mt-3 text-4xl font-semibold leading-tight sm:text-5xl">
              Processing dashboard
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-[#59615b]">
              Review uploaded capture sets, validation results, and local processing
              status from this development machine.
            </p>
          </div>
          <div className="rounded-[8px] bg-[#111312] px-5 py-4 text-white">
            <p className="text-xs font-semibold uppercase text-white/58">Stored sessions</p>
            <p className="mt-1 text-3xl font-semibold">{sessions.length}</p>
          </div>
        </div>

        {sessions.length === 0 ? (
          <div className="mt-8 rounded-[8px] border border-black/8 bg-white p-8 text-center shadow-[0_18px_60px_rgba(20,24,22,0.08)]">
            <Database className="mx-auto h-8 w-8 text-[#68706a]" />
            <h2 className="mt-5 text-2xl font-semibold text-[#171918]">
              No uploaded sessions yet
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[#59615b]">
              Complete a scan, upload it, then process it locally to populate this dashboard.
            </p>
          </div>
        ) : (
          <div className="mt-8 grid gap-4">
            {sessions.map((session) => (
              <SessionCard key={session.sessionId} session={session} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function SessionCard({ session }: { session: ScanSessionListItem }) {
  const jobStatus = session.processingJob?.status ?? "missing";
  const validationStatus = session.validationReport?.status ?? "missing";
  const passedChecks =
    session.validationReport?.checks.filter((check) => check.status === "passed").length ??
    0;
  const totalChecks = session.validationReport?.checks.length ?? 0;
  const phaseEntries = Object.entries(
    session.validationReport?.summary.phaseFrameCounts ?? {},
  );

  return (
    <article className="rounded-[8px] border border-black/8 bg-white p-5 shadow-[0_18px_60px_rgba(20,24,22,0.08)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={jobStatus} type="job" />
            <StatusPill status={validationStatus} type="validation" />
          </div>
          <h2 className="mt-4 break-words text-xl font-semibold text-[#171918]">
            {session.sessionId}
          </h2>
          <p className="mt-2 text-sm leading-6 text-[#68706a]">
            Uploaded {formatDate(session.storedAt)}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a
              className="inline-flex min-h-9 items-center gap-2 rounded-full bg-[#111312] px-4 text-sm font-semibold text-white transition hover:bg-black"
              href={`/sessions/${encodeURIComponent(session.sessionId)}`}
            >
              Open session
              <ArrowRight size={15} />
            </a>
            {session.processingJob?.status === "queued" ? (
              <ProcessSessionButton sessionId={session.sessionId} />
            ) : null}
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-4 lg:min-w-[520px]">
          <DashboardStat
            icon={Camera}
            label="Camera"
            value={session.cameraMode}
          />
          <DashboardStat
            icon={Database}
            label="Frames"
            value={String(session.frameCount)}
          />
          <DashboardStat
            icon={FileArchive}
            label="Archive"
            value={formatBytes(session.archive.size)}
          />
          <DashboardStat
            icon={Ruler}
            label="Measures"
            value={
              session.measurementReport
                ? String(session.measurementReport.measurements.length)
                : "none"
            }
          />
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <div className="rounded-[8px] bg-[#f5f5f2] p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#171918]">
            <ShieldCheck size={17} />
            Validation
          </div>
          {session.validationReport ? (
            <>
              <p className="mt-3 text-sm leading-6 text-[#59615b]">
                {passedChecks}/{totalChecks} checks passed. Report generated{" "}
                {formatDate(session.validationReport.generatedAt)}.
              </p>
              {session.validationReport.blockingIssues.length > 0 ? (
                <p className="mt-3 rounded-[8px] bg-[#fff4d8] px-3 py-2 text-sm text-[#7a4d00]">
                  {session.validationReport.blockingIssues[0]}
                </p>
              ) : (
                <p className="mt-3 rounded-[8px] bg-[#e6f7ec] px-3 py-2 text-sm font-semibold text-[#12662f]">
                  Dataset is structurally ready for reconstruction.
                </p>
              )}
            </>
          ) : (
            <p className="mt-3 text-sm leading-6 text-[#59615b]">
              No validation report yet. Process the session locally from the scanner finish
              screen.
            </p>
          )}
        </div>

        <div className="rounded-[8px] bg-[#f5f5f2] p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#171918]">
            <BadgeCheck size={17} />
            Phase coverage
          </div>
          {phaseEntries.length > 0 ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
              {phaseEntries.map(([phase, count]) => (
                <div key={phase} className="rounded-[8px] bg-white px-3 py-2">
                  <p className="truncate text-xs font-semibold uppercase text-[#68706a]">
                    {phase}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-[#171918]">{count}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm leading-6 text-[#59615b]">
              Phase coverage appears after validation.
            </p>
          )}
        </div>
      </div>
    </article>
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
    <div className="rounded-[8px] bg-[#f5f5f2] px-4 py-3">
      <Icon className="h-4 w-4 text-[#1e5cff]" />
      <p className="mt-4 text-xs font-semibold uppercase text-[#68706a]">{label}</p>
      <p className="mt-1 truncate text-base font-semibold text-[#171918]">{value}</p>
    </div>
  );
}

function StatusPill({
  status,
  type,
}: {
  status: ScanProcessingJobStatus | ScanValidationReportStatus | "missing";
  type: "job" | "validation";
}) {
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
      {type}: {status}
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
