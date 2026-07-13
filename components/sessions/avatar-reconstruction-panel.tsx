"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Box, ExternalLink, RefreshCw, Sparkles, Terminal } from "lucide-react";
import type {
  AvatarModelAsset,
  AvatarReconstructionStatusResponse,
  BodyAvatarReconstructionReport,
} from "@/types/scan";
import { cn } from "@/utils/cn";

type AvatarReconstructionPanelProps = {
  aiReport: BodyAvatarReconstructionReport;
  initialState: AvatarReconstructionStatusResponse;
  sessionId: string;
};

export function AvatarReconstructionPanel({
  aiReport,
  initialState,
  sessionId,
}: AvatarReconstructionPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState(initialState);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const renderableAsset = useMemo(
    () => selectRenderableAsset(state.assets),
    [state.assets],
  );
  const hasReconstructedAsset = Boolean(
    renderableAsset && !isFallbackAsset(renderableAsset),
  );
  const jobStatus = state.job?.status ?? "not-started";
  const canPrepare = !isSubmitting && !isPending && jobStatus !== "running";

  const requestReconstruction = async (force = false) => {
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(
        `/api/scan-sessions/${encodeURIComponent(sessionId)}/avatar-reconstruction`,
        {
          body: JSON.stringify({ force }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        },
      );
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setErrorMessage(
          typeof body?.error === "string"
            ? body.error
            : "Unable to start avatar reconstruction.",
        );
        return;
      }

      setState(body);
      startTransition(() => router.refresh());
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to start avatar reconstruction.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const refreshState = async () => {
    setErrorMessage(null);

    try {
      const response = await fetch(
        `/api/scan-sessions/${encodeURIComponent(sessionId)}/avatar-reconstruction`,
      );
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setErrorMessage(
          typeof body?.error === "string"
            ? body.error
            : "Unable to refresh avatar reconstruction.",
        );
        return;
      }

      setState(body);
      startTransition(() => router.refresh());
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to refresh avatar reconstruction.",
      );
    }
  };

  return (
    <section className="mt-6 rounded-[8px] border border-black/8 bg-white p-5 shadow-[0_18px_60px_rgba(20,24,22,0.08)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[#171918]">
            <Sparkles size={18} />
            Self-hosted human reconstruction
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#59615b]">
            {hasReconstructedAsset
              ? "A self-hosted human model is available for geometry and topology inspection."
              : renderableAsset
                ? "Only the measured fallback is available. Run the SMPL-X worker to recover parametric human geometry."
              : aiReport.nextProviderAction}
          </p>
        </div>
        <StatusPill
          status={hasReconstructedAsset
            ? "reconstruction-ready"
            : renderableAsset
              ? "fallback-ready"
              : state.job?.status ?? aiReport.status}
        />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <PanelStat
          icon={Box}
          label="Coverage"
          value={`${aiReport.captureReadiness.acceptedFrameCount}/${aiReport.captureReadiness.minimumAcceptedFrameCount}+`}
        />
        <PanelStat
          icon={Sparkles}
          label="Model assets"
          value={hasReconstructedAsset
            ? `${state.assets.length} ready`
            : renderableAsset
              ? "fallback only"
              : "none"}
        />
        <PanelStat
          icon={Terminal}
          label="Runtime"
          value={getRuntimeLabel(state.setup.commandSource)}
        />
        <PanelStat
          icon={RefreshCw}
          label="Job"
          value={state.job?.stage ?? "not started"}
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className="inline-flex min-h-10 items-center gap-2 rounded-full bg-[#111312] px-4 text-sm font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-55"
          disabled={!canPrepare}
          onClick={() => requestReconstruction(false)}
          type="button"
        >
          <Terminal size={16} />
          {state.configured ? "Run Self-hosted Worker" : "Prepare Input Package"}
        </button>
        <button
          className="inline-flex min-h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-[#171918] ring-1 ring-black/10 transition hover:bg-[#eeeeea] disabled:cursor-not-allowed disabled:opacity-55"
          disabled={!canPrepare}
          onClick={() => requestReconstruction(true)}
          type="button"
        >
          <RefreshCw size={16} />
          Force Rebuild
        </button>
        <button
          className="inline-flex min-h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-[#171918] ring-1 ring-black/10 transition hover:bg-[#eeeeea] disabled:cursor-not-allowed disabled:opacity-55"
          disabled={isSubmitting || isPending}
          onClick={refreshState}
          type="button"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      {!state.configured ? (
        <p className="mt-4 rounded-[8px] bg-[#fff4d8] px-3 py-2 text-sm leading-6 text-[#7a4d00]">
          Restore <span className="font-semibold">{state.setup.bundledWorkerFile ?? "the bundled worker"}</span>{" "}
          or set <span className="font-semibold">{state.setup.commandEnvVar}</span> to run a custom reconstruction worker.
        </p>
      ) : null}

      {state.job?.errorMessage ? (
        <p className="mt-4 rounded-[8px] bg-[#ffe8e3] px-3 py-2 text-sm leading-6 text-[#8b2616]">
          {state.job.errorMessage}
        </p>
      ) : null}

      {errorMessage ? (
        <p className="mt-4 rounded-[8px] bg-[#ffe8e3] px-3 py-2 text-sm leading-6 text-[#8b2616]">
          {errorMessage}
        </p>
      ) : null}

      {state.assets.length > 0 ? (
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {state.assets.map((asset) => (
            <AssetRow asset={asset} key={asset.id} />
          ))}
        </div>
      ) : null}

      {state.job?.warnings.length || aiReport.warnings.length ? (
        <div className="mt-4 grid gap-2">
          {[...(state.job?.warnings ?? []), ...aiReport.warnings].slice(0, 3).map((warning) => (
            <p
              className="rounded-[8px] bg-[#fff4d8] px-3 py-2 text-sm leading-6 text-[#7a4d00]"
              key={warning}
            >
              {warning}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function AssetRow({ asset }: { asset: AvatarModelAsset }) {
  return (
    <a
      className="flex min-h-14 items-center justify-between gap-3 rounded-[8px] bg-[#f5f5f2] px-3 py-3 text-sm font-semibold text-[#171918] transition hover:bg-[#eeeeea]"
      href={asset.url}
      rel="noreferrer"
      target="_blank"
    >
      <span className="min-w-0">
        <span className="block truncate">{asset.label}</span>
        <span className="mt-1 block text-xs uppercase text-[#68706a]">
          {asset.type} · {formatBytes(asset.sizeBytes)}
        </span>
      </span>
      <ExternalLink className="h-4 w-4 shrink-0 text-[#68706a]" />
    </a>
  );
}

function selectRenderableAsset(assets: AvatarModelAsset[]) {
  const renderable = assets.filter(
    (asset) => asset.type === "glb" || asset.type === "gltf",
  );

  return renderable.find((asset) => !isFallbackAsset(asset)) ?? renderable[0] ?? null;
}

function isFallbackAsset(asset: AvatarModelAsset) {
  return asset.file.toLowerCase().includes("fallback");
}

function getRuntimeLabel(commandSource: AvatarReconstructionStatusResponse["setup"]["commandSource"]) {
  if (commandSource === "env") {
    return "env command";
  }

  if (commandSource === "bundled") {
    return "bundled worker";
  }

  return "not configured";
}

function PanelStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Box;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[8px] bg-[#f5f5f2] px-4 py-3">
      <Icon className="h-4 w-4 text-[#1e5cff]" />
      <p className="mt-4 text-xs font-semibold uppercase text-[#68706a]">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-[#171918]">{value}</p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const isGood = status === "reconstruction-ready" || status === "succeeded" || status === "provider-ready";
  const isBad = status === "failed";

  return (
    <span
      className={cn(
        "inline-flex min-h-8 shrink-0 items-center rounded-full px-3 text-xs font-semibold uppercase ring-1",
        isGood && "bg-[#e6f7ec] text-[#12662f] ring-[#bce8ca]",
        isBad && "bg-[#ffe8e3] text-[#8b2616] ring-[#efb9ae]",
        !isGood && !isBad && "bg-[#fff4d8] text-[#7a4d00] ring-[#f1d58a]",
      )}
    >
      {status}
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
