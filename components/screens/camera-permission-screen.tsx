"use client";

import { AlertTriangle, Camera, CheckCircle2, Loader2, VideoOff } from "lucide-react";
import { PrimaryButton } from "@/components/ui/primary-button";
import type { CameraPermissionStatus } from "@/types/scan";

type CameraPermissionScreenProps = {
  diagnostics: {
    isSecureContext: boolean;
    protocol: string;
    hasMediaDevices: boolean;
    hasGetUserMedia: boolean;
    userAgent: string;
  };
  errorMessage: string | null;
  isReady: boolean;
  lastAction: string;
  onContinue: () => void;
  onRequestCamera: () => void;
  onUseMockCamera: () => void;
  status: CameraPermissionStatus;
};

const statusContent: Record<
  CameraPermissionStatus,
  {
    title: string;
    copy: string;
    icon: typeof Camera;
  }
> = {
  idle: {
    title: "Camera access is needed",
    copy: "Tap below and approve the browser prompt. On mobile, the scan starts with the back camera and can be switched during capture.",
    icon: Camera,
  },
  requesting: {
    title: "Opening camera prompt",
    copy: "If no prompt appears, check the address bar camera icon or this site's camera permission in browser settings.",
    icon: Loader2,
  },
  granted: {
    title: "Camera connected",
    copy: "You are ready to position yourself inside the scan guide.",
    icon: CheckCircle2,
  },
  denied: {
    title: "Permission denied",
    copy: "Camera access is blocked for this site. Enable camera permission in the browser settings, then request access again.",
    icon: VideoOff,
  },
  unavailable: {
    title: "No camera available",
    copy: "No usable camera was found. Close other apps using the camera, then try again.",
    icon: VideoOff,
  },
  unsupported: {
    title: "Camera unsupported",
    copy: "This browser does not expose the webcam APIs required by the scanner. Use Safari or Chrome on the HTTPS tunnel.",
    icon: AlertTriangle,
  },
  error: {
    title: "Camera could not start",
    copy: "The request did not complete. Check for a browser permission prompt, then try again.",
    icon: AlertTriangle,
  },
};

export function CameraPermissionScreen({
  diagnostics,
  errorMessage,
  isReady,
  lastAction,
  onContinue,
  onRequestCamera,
  onUseMockCamera,
  status,
}: CameraPermissionScreenProps) {
  const content = statusContent[status];
  const Icon = content.icon;
  const canContinue = status === "granted";
  const isRequesting = status === "requesting";
  const requestLabel =
    status === "denied" || status === "error" || status === "unavailable"
      ? "Request Access Again"
      : "Allow Camera";

  return (
    <main className="grid min-h-svh place-items-center bg-[#111312] px-5 py-8 text-white">
      <section className="w-full max-w-xl rounded-[8px] border border-white/12 bg-white/[0.06] p-6 shadow-[0_30px_90px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:p-8">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-[#111312]">
          <Icon className={isRequesting ? "animate-spin" : ""} size={24} />
        </div>
        <p className="mt-8 text-sm font-semibold uppercase text-white/55">
          Camera permission
        </p>
        <h1 className="mt-4 text-balance text-4xl font-semibold">{content.title}</h1>
        <p className="mt-4 text-pretty text-base leading-7 text-white/68">{content.copy}</p>
        <div className="mt-5 grid gap-2 rounded-[8px] bg-white/8 px-4 py-3 text-sm leading-6 text-white/66">
          <p>Controls: {isReady ? "Ready" : "Loading"}</p>
          <p>{lastAction}</p>
          <p>
            Camera API: {diagnostics.hasGetUserMedia ? "Available" : "Unavailable"} /{" "}
            {diagnostics.isSecureContext ? "Secure" : "Not secure"}
          </p>
        </div>

        {errorMessage && status !== "granted" ? (
          <p className="mt-5 rounded-[8px] bg-white/8 px-4 py-3 text-sm leading-6 text-white/66">
            {errorMessage}
          </p>
        ) : null}

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {canContinue ? (
            <PrimaryButton onClick={onContinue} variant="light">
              Continue to Preview
            </PrimaryButton>
          ) : (
            <button
              className="min-h-16 w-full rounded-full bg-white px-6 text-base font-semibold text-[#111312] shadow-[0_18px_40px_rgba(0,0,0,0.16)] transition hover:bg-[#f2f2ef] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              disabled={isRequesting}
              onClick={onRequestCamera}
              style={{
                WebkitTapHighlightColor: "rgba(255,255,255,0.25)",
                touchAction: "manipulation",
              }}
              type="button"
            >
              {!isReady
                ? "Loading Controls..."
                : isRequesting
                  ? "Opening Camera..."
                  : requestLabel}
            </button>
          )}

          {status === "unsupported" ? (
            <PrimaryButton disabled variant="ghost">
              Browser Unsupported
            </PrimaryButton>
          ) : null}

          {!canContinue ? (
            <a
              className="inline-flex min-h-12 items-center justify-center rounded-full bg-white/10 px-6 text-sm font-semibold text-white ring-1 ring-white/30 transition hover:bg-white/16"
              href="/?step=position-user&camera=mock"
              onClick={(event) => {
                event.preventDefault();
                onUseMockCamera();
              }}
            >
              Continue with mock preview
            </a>
          ) : null}

          <a
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-transparent px-6 text-sm font-semibold text-white ring-1 ring-white/20 transition hover:bg-white/8"
            href="/camera-test.html"
          >
            Open camera diagnostic
          </a>
        </div>
      </section>
    </main>
  );
}
