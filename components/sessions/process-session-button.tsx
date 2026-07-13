"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Cpu } from "lucide-react";
import { cn } from "@/utils/cn";

type ProcessSessionButtonProps = {
  className?: string;
  sessionId: string;
};

export function ProcessSessionButton({
  className,
  sessionId,
}: ProcessSessionButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const processSession = async () => {
    setErrorMessage(null);
    setIsProcessing(true);

    try {
      const response = await fetch(
        `/api/scan-sessions/${encodeURIComponent(sessionId)}/process`,
        {
          method: "POST",
        },
      );
      const responseBody = await response.json().catch(() => null);

      if (!response.ok) {
        setErrorMessage(
          typeof responseBody?.error === "string"
            ? responseBody.error
            : "Unable to process this session.",
        );
        return;
      }

      startTransition(() => router.refresh());
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to process this session.",
      );
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className={cn("inline-flex flex-col items-start gap-2", className)}>
      <button
        className="inline-flex min-h-9 items-center gap-2 rounded-full bg-[#111312] px-4 text-sm font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-55"
        disabled={isPending || isProcessing}
        onClick={processSession}
        type="button"
      >
        {isPending || isProcessing ? "Processing..." : "Process"}
        <Cpu size={15} />
      </button>
      {errorMessage ? (
        <p className="max-w-xs text-xs font-semibold leading-5 text-[#8b2616]">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
