"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw, SwitchCamera, Volume2, VolumeX, X } from "lucide-react";
import { FinishScreen } from "@/components/screens/finish-screen";
import { PrimaryButton } from "@/components/ui/primary-button";
import { useMockGuidance } from "@/hooks/use-mock-guidance";
import { usePersonSegmentation } from "@/hooks/use-person-segmentation";
import { usePoseQuality } from "@/hooks/use-pose-quality";
import { useScanPhaseTimer } from "@/hooks/use-scan-phase-timer";
import { getNextScanState, SCAN_STEPS } from "@/lib/scan-machine";
import { getCaptureGate } from "@/services/capture-gate-service";
import type { CameraFacingMode } from "@/services/camera-service";
import type {
  CapturedPersonSegmentation,
  CaptureSessionSummary,
  CaptureUploadState,
  CapturedFrameVision,
  CapturedScanVideo,
  CaptureVideoStatus,
  ScanMetric,
  ScanState,
} from "@/types/scan";
import { cn } from "@/utils/cn";
import { CameraFeed } from "./camera-feed";
import { ScanProgressRail } from "./scan-progress-rail";
import { SilhouetteOverlay } from "./silhouette-overlay";

const autoStartCaptureDelayMs = 1400;
const captureFrameIntervalMs = 500;

type ScannerExperienceProps = {
  cameraFacingMode: CameraFacingMode;
  captureSummary: CaptureSessionSummary;
  captureUploadState: CaptureUploadState;
  canSwitchCamera: boolean;
  onAdvance: () => void;
  onCaptureFrame: (input: {
    cameraMode: "live" | "mock";
    instruction: string;
    metrics: ScanMetric[];
    phaseProgress: number;
    scanState: ScanState;
    vision: CapturedFrameVision | null;
    videoElement: HTMLVideoElement | null;
  }) => void;
  onCaptureVideo: (video: CapturedScanVideo) => void;
  onExit: () => void;
  onExportSession: () => void;
  onProcessSession: () => void;
  onRefreshProcessing: () => void;
  onRetakePhase: (state: ScanState) => void;
  onRestart: () => void;
  onSubjectHeightChange: (heightCm: number | null) => void;
  onSwitchCamera: () => void;
  onUploadSession: () => void;
  onVideoStatusChange: (status: CaptureVideoStatus) => void;
  scanState: ScanState;
  stream: MediaStream | null;
  subjectHeightCm: number | null;
  useMockCamera: boolean;
};

export function ScannerExperience({
  cameraFacingMode,
  captureSummary,
  captureUploadState,
  canSwitchCamera,
  onAdvance,
  onCaptureFrame,
  onCaptureVideo,
  onExit,
  onExportSession,
  onProcessSession,
  onRefreshProcessing,
  onRetakePhase,
  onRestart,
  onSubjectHeightChange,
  onSwitchCamera,
  onUploadSession,
  onVideoStatusChange,
  scanState,
  stream,
  subjectHeightCm,
  useMockCamera,
}: ScannerExperienceProps) {
  const step = SCAN_STEPS[scanState];
  const nextState = getNextScanState(scanState);
  const mockNextHref = `/?step=${nextState}&camera=mock`;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<BlobPart[]>([]);
  const videoCaptureStartedAtRef = useRef(0);
  const videoCaptureTimestampRef = useRef("");
  const videoCaptureSessionIdRef = useRef("");
  const videoPhaseTimelineRef = useRef<CapturedScanVideo["phaseTimeline"]>([]);
  const autoStartTriggeredRef = useRef(false);
  const [autoStartProgress, setAutoStartProgress] = useState(0);
  const [voiceGuidanceEnabled, setVoiceGuidanceEnabled] = useState(true);
  const mockGuidance = useMockGuidance(scanState, scanState !== "finish");
  const poseQuality = usePoseQuality({
    active: Boolean(stream) && !useMockCamera && scanState !== "finish",
    scanState,
    videoRef,
  });
  const personSegmentation = usePersonSegmentation({
    active: Boolean(stream) && !useMockCamera && scanState !== "finish",
    poseBodyBounds: poseQuality.bodyBounds,
    poseKeypoints: poseQuality.keypoints,
    scanState,
    videoRef,
  });
  const isUsingLiveQuality = Boolean(stream) && !useMockCamera && poseQuality.metrics.length > 0;
  const instruction = isUsingLiveQuality ? poseQuality.guidance : mockGuidance.instruction;
  const metrics = isUsingLiveQuality
    ? mergeVisionMetrics(poseQuality.metrics, personSegmentation.metrics)
    : mockGuidance.metrics;
  const captureGate = getCaptureGate({
    isLiveCamera: Boolean(stream),
    metrics,
    poseQuality,
    scanState,
    useMockCamera,
  });
  const currentPhaseSummary = captureSummary.phaseSummaries.find((phase) => phase.state === scanState);
  const currentPhaseFrameCount = currentPhaseSummary?.frameCount ?? 0;
  const currentPhaseMinimumFrameCount = currentPhaseSummary?.minimumFrameCount ?? 4;
  const currentPhaseTargetFrameCount =
    currentPhaseSummary?.targetFrameCount ?? currentPhaseMinimumFrameCount;
  const hasCurrentPhaseMinimumFrames =
    !step.capturesData || currentPhaseFrameCount >= currentPhaseMinimumFrameCount;
  const latestCaptureContext = useRef({
    captureGate,
    instruction,
    metrics,
    phaseProgress: 0,
    vision: null as CapturedFrameVision | null,
  });
  const handleComplete = useCallback(() => {
    onAdvance();
  }, [onAdvance]);
  const phaseProgress = useScanPhaseTimer(
    scanState,
    handleComplete,
    !step.capturesData || captureGate.shouldAdvancePhase,
    hasCurrentPhaseMinimumFrames,
  );
  const isLiveStartBlocked =
    Boolean(stream) &&
    !useMockCamera &&
    scanState === "position-user" &&
    !captureGate.isFrameAcceptable;
  const isCameraSwitching = !stream && !useMockCamera && canSwitchCamera;
  const isAutoStartReady =
    scanState === "position-user" &&
    captureGate.isFrameAcceptable &&
    (useMockCamera || Boolean(stream));
  const autoStartRemainingSeconds = Math.max(
    1,
    Math.ceil((1 - autoStartProgress) * (autoStartCaptureDelayMs / 1000)),
  );

  useEffect(() => {
    latestCaptureContext.current = {
      captureGate,
      instruction,
      metrics,
      phaseProgress,
      vision: getCapturedFrameVision(
        poseQuality,
        personSegmentation.segmentation,
        isUsingLiveQuality,
      ),
    };
  }, [
    captureGate,
    instruction,
    isUsingLiveQuality,
    metrics,
    personSegmentation.segmentation,
    phaseProgress,
    poseQuality,
  ]);

  useEffect(() => {
    if (useMockCamera || !stream) {
      return;
    }

    if (step.capturesData) {
      if (!videoRecorderRef.current && captureSummary.videoStatus === "idle") {
        startScanVideoCapture({
          onCaptureVideo,
          onVideoStatusChange,
          recorderRef: videoRecorderRef,
          chunksRef: videoChunksRef,
          phaseTimelineRef: videoPhaseTimelineRef,
          sessionId: captureSummary.id,
          sessionIdRef: videoCaptureSessionIdRef,
          startedAtRef: videoCaptureStartedAtRef,
          stream,
          timestampRef: videoCaptureTimestampRef,
          initialState: scanState,
        });
        return;
      }

      const elapsedMs = Math.max(0, performance.now() - videoCaptureStartedAtRef.current);
      const previousMarker = videoPhaseTimelineRef.current.at(-1);

      if (previousMarker?.state !== scanState) {
        videoPhaseTimelineRef.current.push({
          elapsedMs: Math.round(elapsedMs),
          state: scanState,
        });
      }
      return;
    }

    if (scanState === "finish") {
      stopScanVideoCapture(videoRecorderRef.current, onVideoStatusChange);
    }
  }, [
    captureSummary.id,
    captureSummary.videoStatus,
    onCaptureVideo,
    onVideoStatusChange,
    scanState,
    step.capturesData,
    stream,
    useMockCamera,
  ]);

  useEffect(() => {
    return () => {
      const recorder = videoRecorderRef.current;

      if (recorder && recorder.state !== "inactive") {
        recorder.ondataavailable = null;
        recorder.onerror = null;
        recorder.onstop = null;
        recorder.stop();
      }
    };
  }, []);

  useEffect(() => {
    if (!step.capturesData) {
      return;
    }

    const captureCurrentFrame = () => {
      const context = latestCaptureContext.current;

      if (!context.captureGate.isFrameAcceptable) {
        return;
      }

      onCaptureFrame({
        cameraMode: useMockCamera ? "mock" : "live",
        instruction: context.instruction,
        metrics: context.metrics,
        phaseProgress: context.phaseProgress,
        scanState,
        vision: context.vision,
        videoElement: useMockCamera ? null : videoRef.current,
      });
    };

    const firstCaptureTimer = window.setTimeout(captureCurrentFrame, 250);
    const interval = window.setInterval(captureCurrentFrame, captureFrameIntervalMs);

    return () => {
      window.clearTimeout(firstCaptureTimer);
      window.clearInterval(interval);
    };
  }, [onCaptureFrame, scanState, step.capturesData, useMockCamera]);

  useEffect(() => {
    autoStartTriggeredRef.current = false;
    setAutoStartProgress(0);
  }, [scanState]);

  useEffect(() => {
    if (!voiceGuidanceEnabled || typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }

    window.speechSynthesis.cancel();
    const prompt = new SpeechSynthesisUtterance(`${step.title}. ${step.instruction}`);
    prompt.rate = 0.94;
    prompt.pitch = 1;
    window.speechSynthesis.speak(prompt);

    return () => window.speechSynthesis.cancel();
  }, [scanState, step.instruction, step.title, voiceGuidanceEnabled]);

  useEffect(() => {
    if (scanState !== "position-user" || !isAutoStartReady || autoStartTriggeredRef.current) {
      setAutoStartProgress(0);
      return;
    }

    const startedAt = performance.now();
    const progressTimer = window.setInterval(() => {
      const elapsedMs = performance.now() - startedAt;
      setAutoStartProgress(Math.min(1, elapsedMs / autoStartCaptureDelayMs));
    }, 50);
    const startTimer = window.setTimeout(() => {
      autoStartTriggeredRef.current = true;
      setAutoStartProgress(1);
      onAdvance();
    }, autoStartCaptureDelayMs);

    return () => {
      window.clearInterval(progressTimer);
      window.clearTimeout(startTimer);
    };
  }, [isAutoStartReady, onAdvance, scanState]);

  if (scanState === "finish") {
    return (
      <FinishScreen
        onExport={onExportSession}
        onProcess={onProcessSession}
        onRefreshProcessing={onRefreshProcessing}
        onRetakePhase={onRetakePhase}
        onRestart={onRestart}
        onSubjectHeightChange={onSubjectHeightChange}
        onUpload={onUploadSession}
        sessionSummary={captureSummary}
        subjectHeightCm={subjectHeightCm}
        uploadState={captureUploadState}
      />
    );
  }

  if (!stream && !useMockCamera && !isCameraSwitching) {
    return (
      <main className="grid min-h-svh place-items-center bg-[#111312] px-5 text-white">
        <section className="max-w-md rounded-[8px] border border-white/12 bg-white/[0.06] p-7 text-center">
          <h1 className="text-2xl font-semibold">Camera preview unavailable</h1>
          <p className="mt-3 text-sm leading-6 text-white/62">
            Camera access was stopped or could not be retained. Return to setup and enable the preview again.
          </p>
          <PrimaryButton className="mt-6" onClick={onExit} variant="light">
            Return to Setup
          </PrimaryButton>
        </section>
      </main>
    );
  }

  if (isCameraSwitching) {
    return (
      <main className="grid h-svh place-items-center bg-[#08090a] px-5 text-white">
        <section className="text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-white/10 ring-1 ring-white/20">
            <SwitchCamera className="animate-pulse" size={24} />
          </div>
          <h1 className="mt-5 text-2xl font-semibold">Switching camera</h1>
        </section>
      </main>
    );
  }

  return (
    <main className="relative h-svh overflow-hidden bg-[#08090a] text-white">
      {stream ? (
        <CameraFeed
          facingMode={cameraFacingMode}
          stream={stream}
          videoRef={videoRef}
        />
      ) : (
        <MockCameraFeed />
      )}
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.42),rgba(0,0,0,0)_22%,rgba(0,0,0,0)_68%,rgba(0,0,0,0.46))]" />
      <SilhouetteOverlay state={scanState} />

      <header className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between gap-3 p-3 sm:p-5">
        <div className="min-w-0 rounded-full bg-black/30 px-3 py-2 ring-1 ring-white/16 backdrop-blur">
          <p className="truncate text-sm font-semibold">
            {step.shortLabel}
            <span className="hidden text-white/62 sm:inline"> - {step.title}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            aria-label={voiceGuidanceEnabled ? "Mute spoken guidance" : "Enable spoken guidance"}
            aria-pressed={voiceGuidanceEnabled}
            className="grid h-11 w-11 place-items-center rounded-full bg-black/30 text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-black/44"
            onClick={() => setVoiceGuidanceEnabled((enabled) => !enabled)}
            title={voiceGuidanceEnabled ? "Mute spoken guidance" : "Enable spoken guidance"}
            type="button"
          >
            {voiceGuidanceEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
          </button>
          {!useMockCamera ? (
            <button
              aria-label={`Switch to ${cameraFacingMode === "environment" ? "front" : "back"} camera`}
              className="grid h-11 w-11 place-items-center rounded-full bg-black/30 text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-black/44 disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!canSwitchCamera || !stream}
              onClick={onSwitchCamera}
              type="button"
            >
              <SwitchCamera size={20} />
            </button>
          ) : null}
          <button
            aria-label="Exit scan"
            className="grid h-11 w-11 place-items-center rounded-full bg-black/30 text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-black/44"
            onClick={onExit}
            type="button"
          >
            <X size={20} />
          </button>
        </div>
      </header>

      <div className="absolute left-3 right-3 top-[68px] z-20 sm:left-5 sm:right-5 sm:top-20">
        <ScanProgressRail activeState={scanState} phaseProgress={phaseProgress} />
      </div>

      <section className="absolute bottom-0 left-0 right-0 z-20 p-3 sm:p-5">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 rounded-[8px] border border-white/10 bg-black/34 px-4 py-3 shadow-[0_18px_52px_rgba(0,0,0,0.26)] backdrop-blur-md sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-4">
          <div className="min-w-0">
            <p className="truncate text-xl font-semibold sm:text-2xl">{instruction}</p>
            <p className="mt-1 hidden max-w-2xl text-base leading-7 text-white/68 sm:block">
              {step.detail}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex min-h-9 items-center rounded-full px-3.5 text-sm font-semibold uppercase",
                  captureGate.status === "capturing" && "bg-[#7bf0a3]/18 text-[#9ff3b8]",
                  captureGate.status === "loading" && "bg-white/12 text-white/68",
                  captureGate.status === "adjust" && "bg-[#ffd36e]/18 text-[#ffe0a0]",
                  captureGate.status === "hold" && "bg-[#87a9ff]/18 text-[#b8caff]",
                  captureGate.status === "idle" && "bg-white/10 text-white/54",
                )}
              >
                {captureGate.label}
              </span>
              <span className="text-sm font-semibold uppercase text-white/54">
                {captureSummary.frameCount} approved frames
              </span>
              {step.capturesData ? (
                <span className="text-sm font-semibold uppercase text-white/54">
                  {currentPhaseFrameCount}/{currentPhaseMinimumFrameCount} min
                </span>
              ) : null}
              {step.capturesData ? (
                <span className="text-sm font-semibold uppercase text-white/54">
                  target {currentPhaseTargetFrameCount}
                </span>
              ) : null}
              {!useMockCamera && captureSummary.videoStatus !== "idle" ? (
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold uppercase text-white/64">
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      captureSummary.videoStatus === "recording" && "bg-[#ff756d]",
                      captureSummary.videoStatus === "finalizing" && "bg-[#ffd36e]",
                      captureSummary.videoStatus === "ready" && "bg-[#7bf0a3]",
                      ["error", "unsupported"].includes(captureSummary.videoStatus) && "bg-white/36",
                    )}
                  />
                  {getVideoStatusLabel(captureSummary.videoStatus)}
                </span>
              ) : null}
            </div>
            <p className="mt-2 hidden max-w-2xl text-sm leading-6 text-white/58 sm:block">
              {captureGate.detail}
            </p>
          </div>
          {step.autoAdvance ? (
            <div className="flex flex-wrap items-center justify-end gap-3 text-base font-medium text-white/76">
              <div className="flex min-w-20 items-center justify-end gap-2">
                <RotateCcw size={17} />
                {Math.max(0, Math.ceil((100 - phaseProgress) / 100 * (step.durationMs / 1000)))}s
              </div>
              {useMockCamera ? (
                <a
                  aria-disabled={!hasCurrentPhaseMinimumFrames}
                  className={cn(
                    "inline-flex min-h-11 items-center justify-center rounded-full bg-white px-5 text-sm font-semibold text-[#111312] transition hover:bg-[#f2f2ef]",
                    !hasCurrentPhaseMinimumFrames && "pointer-events-none opacity-55",
                  )}
                  href={mockNextHref}
                  onClick={(event) => {
                    event.preventDefault();
                    if (!hasCurrentPhaseMinimumFrames) {
                      return;
                    }
                    onAdvance();
                  }}
                >
                  {hasCurrentPhaseMinimumFrames ? "Next Step" : "Capturing"}
                </a>
              ) : null}
            </div>
          ) : scanState === "position-user" ? (
            <div className="min-w-[172px] shrink-0 rounded-[8px] bg-white/8 px-4 py-3 ring-1 ring-white/10">
              <div className="flex items-center justify-between gap-3 text-base font-semibold">
                <span>{isAutoStartReady ? "Starting capture" : captureGate.label}</span>
                <span className="text-white/58">
                  {isAutoStartReady ? `${autoStartRemainingSeconds}s` : "Auto"}
                </span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/12">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width]",
                    isAutoStartReady ? "bg-[#a8f3bf]" : "bg-white/20",
                  )}
                  style={{ width: `${Math.round(autoStartProgress * 100)}%` }}
                />
              </div>
            </div>
          ) : useMockCamera ? (
            <a
              className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-[#111312] shadow-[0_18px_40px_rgba(0,0,0,0.16)] transition hover:bg-[#f2f2ef]"
              href={mockNextHref}
              onClick={(event) => {
                event.preventDefault();
                onAdvance();
              }}
            >
              Start Capture
            </a>
          ) : (
            <button
              className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-[#111312] shadow-[0_18px_40px_rgba(0,0,0,0.16)] transition hover:bg-[#f2f2ef] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isLiveStartBlocked}
              onClick={onAdvance}
              type="button"
            >
              {isLiveStartBlocked ? captureGate.label : "Start Capture"}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

type StartScanVideoCaptureInput = {
  chunksRef: React.MutableRefObject<BlobPart[]>;
  initialState: ScanState;
  onCaptureVideo: (video: CapturedScanVideo) => void;
  onVideoStatusChange: (status: CaptureVideoStatus) => void;
  phaseTimelineRef: React.MutableRefObject<CapturedScanVideo["phaseTimeline"]>;
  recorderRef: React.MutableRefObject<MediaRecorder | null>;
  sessionId: string;
  sessionIdRef: React.MutableRefObject<string>;
  startedAtRef: React.MutableRefObject<number>;
  stream: MediaStream;
  timestampRef: React.MutableRefObject<string>;
};

function startScanVideoCapture({
  chunksRef,
  initialState,
  onCaptureVideo,
  onVideoStatusChange,
  phaseTimelineRef,
  recorderRef,
  sessionId,
  sessionIdRef,
  startedAtRef,
  stream,
  timestampRef,
}: StartScanVideoCaptureInput) {
  if (typeof MediaRecorder === "undefined") {
    onVideoStatusChange("unsupported");
    return;
  }

  const mimeType = getSupportedScanVideoMimeType();

  try {
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 6_000_000,
    });
    const settings = stream.getVideoTracks()[0]?.getSettings();

    chunksRef.current = [];
    phaseTimelineRef.current = [{ elapsedMs: 0, state: initialState }];
    recorderRef.current = recorder;
    sessionIdRef.current = sessionId;
    startedAtRef.current = performance.now();
    timestampRef.current = new Date().toISOString();

    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    });
    recorder.addEventListener("error", () => {
      onVideoStatusChange("error");
    });
    recorder.addEventListener("stop", () => {
      const durationMs = Math.max(0, Math.round(performance.now() - startedAtRef.current));
      const resolvedMimeType = recorder.mimeType || mimeType || "video/webm";
      const blob = new Blob(chunksRef.current, { type: resolvedMimeType });

      recorderRef.current = null;
      if (blob.size === 0) {
        onVideoStatusChange("error");
        return;
      }

      onCaptureVideo({
        blob,
        camera: {
          aspectRatio: toFiniteNumber(settings?.aspectRatio),
          facingMode: settings?.facingMode ?? null,
          frameRate: toFiniteNumber(settings?.frameRate),
          height: toFiniteNumber(settings?.height),
          width: toFiniteNumber(settings?.width),
        },
        capturedAt: timestampRef.current,
        durationMs,
        fileName: `guided-scan-${Date.now()}.${getVideoFileExtension(resolvedMimeType)}`,
        id: `video-${sessionIdRef.current}-${Date.now()}`,
        mimeType: resolvedMimeType,
        phaseTimeline: [...phaseTimelineRef.current],
        sessionId: sessionIdRef.current,
        sizeBytes: blob.size,
      });
    });

    recorder.start(1000);
    onVideoStatusChange("recording");
  } catch {
    recorderRef.current = null;
    onVideoStatusChange("error");
  }
}

function stopScanVideoCapture(
  recorder: MediaRecorder | null,
  onVideoStatusChange: (status: CaptureVideoStatus) => void,
) {
  if (!recorder || recorder.state === "inactive") {
    return;
  }

  onVideoStatusChange("finalizing");
  recorder.stop();
}

function getSupportedScanVideoMimeType() {
  return [
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? "";
}

function getVideoFileExtension(mimeType: string) {
  return mimeType.toLowerCase().includes("mp4") ? "mp4" : "webm";
}

function getVideoStatusLabel(status: CaptureVideoStatus) {
  if (status === "recording") {
    return "Video recording";
  }

  if (status === "finalizing") {
    return "Finalizing video";
  }

  if (status === "ready") {
    return "Video saved";
  }

  return status === "unsupported" ? "Frames only" : "Video unavailable";
}

function toFiniteNumber(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getCapturedFrameVision(
  poseQuality: ReturnType<typeof usePoseQuality>,
  segmentation: CapturedPersonSegmentation | null,
  isUsingLiveQuality: boolean,
): CapturedFrameVision | null {
  if (!isUsingLiveQuality) {
    return null;
  }

  return {
    backend: poseQuality.backend,
    bodyBounds: poseQuality.bodyBounds,
    keypoints: poseQuality.keypoints,
    provider: segmentation
      ? "tensorflow-movenet+mediapipe-selfie-segmentation"
      : "tensorflow-movenet",
    segmentation,
    status: poseQuality.status,
    updatedAt: poseQuality.lastUpdatedAt,
  };
}

function mergeVisionMetrics(
  poseMetrics: ScanMetric[],
  segmentationMetrics: ScanMetric[],
): ScanMetric[] {
  const metrics = [...poseMetrics];
  const existingLabels = new Set(metrics.map((metric) => metric.label));

  for (const metric of segmentationMetrics) {
    if (!existingLabels.has(metric.label)) {
      metrics.push(metric);
    }
  }

  return metrics;
}

function MockCameraFeed() {
  return (
    <div className="h-full w-full bg-[linear-gradient(135deg,#111312_0%,#2c3130_42%,#101113_100%)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_38%,rgba(255,255,255,0.16),rgba(255,255,255,0)_34%)]" />
      <div className="absolute inset-0 opacity-35 [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:48px_48px]" />
    </div>
  );
}
