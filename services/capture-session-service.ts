import { strToU8, zip, type Zippable } from "fflate";
import { SCAN_STEPS } from "@/lib/scan-machine";
import {
  getCapturedFrameReconstruction,
  getMinimumReconstructionFramesForPhase,
  getPhaseReconstructionTarget,
  getTargetReconstructionFramesForPhase,
  reconstructionCaptureProfile,
} from "@/lib/reconstruction-profile";
import type {
  CapturedFrame,
  CapturedFrameVision,
  CapturePhaseSummary,
  CaptureQualityStatus,
  CaptureSession,
  CaptureSessionSummary,
  CaptureSource,
  CapturedScanVideo,
  CaptureVideoStatus,
  ScanMetric,
  ScanState,
} from "@/types/scan";

const captureMimeType = "image/jpeg" as const;
const liveCaptureQuality = 0.92;
const mockCaptureQuality = 0.76;
const captureStateOrder = Object.values(SCAN_STEPS)
  .filter((step) => step.capturesData)
  .map((step) => step.id);

type CaptureFrameOptions = {
  elapsedMs: number;
  frameNumber: number;
  instruction: string;
  metrics: ScanMetric[];
  phaseFrameNumber: number;
  phaseProgress: number;
  source: CaptureSource;
  state: ScanState;
  vision?: CapturedFrameVision | null;
};

export function createCaptureSession(cameraMode: "live" | "mock"): CaptureSession {
  const now = new Date();

  return {
    cameraMode,
    completedAt: null,
    devicePixelRatio: typeof window === "undefined" ? 1 : window.devicePixelRatio,
    frames: [],
    id: `scan-${formatDateId(now)}`,
    reconstructionProfile: reconstructionCaptureProfile,
    schemaVersion: "body-scan-session.v1",
    startedAt: now.toISOString(),
    subject: {
      heightCm: null,
    },
    userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
    videoStatus: cameraMode === "mock" ? "not-applicable" : "idle",
    videos: [],
    viewport: {
      height: typeof window === "undefined" ? 0 : window.innerHeight,
      width: typeof window === "undefined" ? 0 : window.innerWidth,
    },
  };
}

export function summarizeCaptureSession(session: CaptureSession): CaptureSessionSummary {
  const capturedStates = Array.from(new Set(session.frames.map((frame) => frame.state)));
  const lastFrame = session.frames.at(-1);
  const phaseSummaries = captureStateOrder.map((state) =>
    summarizeCapturePhase(state, session.frames.filter((frame) => frame.state === state)),
  );
  const reviewStatus = getSessionReviewStatus(phaseSummaries);

  return {
    cameraMode: session.cameraMode,
    capturedStates,
    completedAt: session.completedAt,
    frameCount: session.frames.length,
    id: session.id,
    isExportReady:
      reviewStatus === "ready" &&
      session.videoStatus !== "recording" &&
      session.videoStatus !== "finalizing",
    lastFrameAt: lastFrame?.capturedAt ?? null,
    phaseSummaries,
    reconstructionProfile: session.reconstructionProfile,
    reviewStatus,
    startedAt: session.startedAt,
    subject: session.subject,
    videoCount: session.videos.length,
    videoDurationMs: session.videos.reduce((total, video) => total + video.durationMs, 0),
    videoStatus: session.videoStatus,
  };
}

export function setCaptureSessionVideoStatus(
  session: CaptureSession,
  status: CaptureVideoStatus,
): CaptureSession {
  session.videoStatus = status;
  return session;
}

export function addCaptureSessionVideo(
  session: CaptureSession,
  video: CapturedScanVideo,
): CaptureSession {
  if (video.sessionId !== session.id) {
    return session;
  }

  session.videos.push(video);
  session.videoStatus = "ready";
  return session;
}

export function setCaptureSessionSubjectHeight(
  session: CaptureSession,
  heightCm: number | null,
): CaptureSession {
  session.subject.heightCm =
    typeof heightCm === "number" && Number.isFinite(heightCm) ? heightCm : null;
  return session;
}

export function captureVideoFrame(
  video: HTMLVideoElement | null,
  options: CaptureFrameOptions,
): CapturedFrame | null {
  if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return null;
  }

  const width = video.videoWidth;
  const height = video.videoHeight;

  if (width <= 0 || height <= 0) {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");

  if (!context) {
    return null;
  }

  context.drawImage(video, 0, 0, width, height);

  return createFrameFromCanvas(canvas, options, liveCaptureQuality);
}

export function captureMockFrame(options: CaptureFrameOptions): CapturedFrame | null {
  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 1280;

  const context = canvas.getContext("2d");

  if (!context) {
    return null;
  }

  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#141715");
  gradient.addColorStop(0.48, "#2f3635");
  gradient.addColorStop(1, "#090a0b");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.strokeStyle = "rgba(255,255,255,0.16)";
  context.lineWidth = 2;
  for (let x = 0; x < canvas.width; x += 48) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, canvas.height);
    context.stroke();
  }
  for (let y = 0; y < canvas.height; y += 48) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(canvas.width, y);
    context.stroke();
  }

  context.strokeStyle = "rgba(255,255,255,0.72)";
  context.lineWidth = 8;
  context.beginPath();
  context.ellipse(canvas.width / 2, 248, 62, 76, 0, 0, Math.PI * 2);
  context.moveTo(canvas.width / 2, 326);
  context.bezierCurveTo(238, 390, 230, 640, 258, 850);
  context.bezierCurveTo(278, 998, 305, 1108, 320, 1190);
  context.moveTo(canvas.width / 2, 326);
  context.bezierCurveTo(482, 390, 490, 640, 462, 850);
  context.bezierCurveTo(442, 998, 415, 1108, 400, 1190);
  context.stroke();

  context.fillStyle = "rgba(255,255,255,0.86)";
  context.font = "600 34px system-ui, sans-serif";
  context.fillText(SCAN_STEPS[options.state].label, 48, 82);
  context.font = "500 24px system-ui, sans-serif";
  context.fillStyle = "rgba(255,255,255,0.64)";
  context.fillText(options.instruction, 48, 122);

  return createFrameFromCanvas(canvas, options, mockCaptureQuality);
}

export function completeCaptureSession(session: CaptureSession): CaptureSession {
  if (session.completedAt) {
    return session;
  }

  session.completedAt = new Date().toISOString();
  return session;
}

export function clearCaptureFramesFromState(
  session: CaptureSession,
  state: ScanState,
): CaptureSession {
  const targetIndex = captureStateOrder.indexOf(state);

  if (targetIndex === -1) {
    return session;
  }

  session.frames = session.frames.filter((frame) => {
    const frameStateIndex = captureStateOrder.indexOf(frame.state);
    return frameStateIndex !== -1 && frameStateIndex < targetIndex;
  });
  session.completedAt = null;
  session.videos = [];
  session.videoStatus = session.cameraMode === "mock" ? "not-applicable" : "idle";

  return session;
}

export async function downloadCaptureSession(session: CaptureSession): Promise<void> {
  const blob = await createCaptureSessionArchive(session);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = getCaptureSessionArchiveName(session);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function createCaptureSessionArchive(session: CaptureSession): Promise<Blob> {
  const manifest = buildSessionManifest(session);
  const files: Zippable = {
    "manifest.json": [strToU8(JSON.stringify(manifest, null, 2)), { level: 6 }],
  };

  for (const frame of session.frames) {
    files[`frames/${frame.fileName}`] = [dataUrlToUint8Array(frame.dataUrl), { level: 0 }];
  }

  for (const video of session.videos) {
    files[`video/${video.fileName}`] = [
      new Uint8Array(await video.blob.arrayBuffer()),
      { level: 0 },
    ];

    if (video.poseTrack) {
      files[`tracks/${video.poseTrack.fileName}`] = [
        strToU8(JSON.stringify(video.poseTrack, null, 2)),
        { level: 6 },
      ];
    }
  }

  const zipBytes = await zipCaptureFiles(files);
  return new Blob([Uint8Array.from(zipBytes).buffer], { type: "application/zip" });
}

function zipCaptureFiles(files: Zippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(files, (error, data) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(data);
    });
  });
}

export function getCaptureSessionArchiveName(session: CaptureSession): string {
  return `${session.id}.zip`;
}

function createFrameFromCanvas(
  canvas: HTMLCanvasElement,
  options: CaptureFrameOptions,
  quality: number,
): CapturedFrame {
  const stateLabel = SCAN_STEPS[options.state].label;
  const frameNumber = String(options.frameNumber).padStart(4, "0");

  return {
    id: `${options.state}-${frameNumber}`,
    capturedAt: new Date().toISOString(),
    dataUrl: canvas.toDataURL(captureMimeType, quality),
    elapsedMs: Math.max(0, Math.round(options.elapsedMs)),
    fileName: `${frameNumber}-${options.state}.jpg`,
    height: canvas.height,
    instruction: options.instruction,
    metrics: options.metrics,
    mimeType: captureMimeType,
    phaseProgress: Math.round(options.phaseProgress),
    reconstruction: getCapturedFrameReconstruction(
      options.state,
      options.phaseFrameNumber,
      options.phaseProgress,
    ),
    source: options.source,
    state: options.state,
    stateLabel,
    vision: options.vision ?? null,
    width: canvas.width,
  };
}

function buildSessionManifest(session: CaptureSession) {
  const review = summarizeCaptureSession(session);

  return {
    schemaVersion: session.schemaVersion,
    session: {
      cameraMode: session.cameraMode,
      completedAt: session.completedAt,
      devicePixelRatio: session.devicePixelRatio,
      frameCount: session.frames.length,
      id: session.id,
      reconstructionProfile: session.reconstructionProfile,
      startedAt: session.startedAt,
      subject: session.subject,
      userAgent: session.userAgent,
      viewport: session.viewport,
      videoStatus: session.videoStatus,
    },
    frames: session.frames.map(({ dataUrl: _dataUrl, ...frame }) => frame),
    review: {
      capturePolicy: "quality-gated-approved-frames-only",
      isExportReady: review.isExportReady,
      status: review.reviewStatus,
      phases: review.phaseSummaries.map(({ thumbnailDataUrl: _thumbnailDataUrl, ...phase }) => phase),
    },
    reconstructionProfile: session.reconstructionProfile,
    videos: session.videos.map(({ blob: _blob, poseTrack, ...video }) => ({
      ...video,
      poseTrack: poseTrack
        ? {
            capturedAt: poseTrack.capturedAt,
            fileName: poseTrack.fileName,
            frameCount: poseTrack.frameCount,
            provider: poseTrack.provider,
            sampleIntervalTargetMs: poseTrack.sampleIntervalTargetMs,
            schemaVersion: poseTrack.schemaVersion,
            sessionElapsedOffsetMs: poseTrack.sessionElapsedOffsetMs,
          }
        : null,
    })),
    states: Object.values(SCAN_STEPS)
      .filter((step) => step.capturesData)
      .map((step) => ({
        id: step.id,
        label: step.label,
        minimumFrameCount: getMinimumReconstructionFramesForPhase(step.id),
        targetFrameCount: getTargetReconstructionFramesForPhase(step.id),
        targetDurationMs: step.durationMs,
      })),
  };
}

function summarizeCapturePhase(
  state: ScanState,
  frames: CapturedFrame[],
): CapturePhaseSummary {
  const step = SCAN_STEPS[state];
  const target = getPhaseReconstructionTarget(state);
  const minimumFrameCount = target?.minimumFrameCount ?? 4;
  const targetFrameCount = target?.targetFrameCount ?? minimumFrameCount;
  const warningMetrics = Array.from(
    new Set(
      frames.flatMap((frame) =>
        frame.metrics
          .filter((metric) => metric.tone === "warning")
          .map((metric) => `${metric.label}: ${metric.value}`),
      ),
    ),
  );
  const issues: string[] = [];

  if (frames.length === 0) {
    issues.push("No frames captured");
  } else if (frames.length < minimumFrameCount) {
    issues.push("Low frame coverage");
  }

  issues.push(...warningMetrics);

  const status = getPhaseStatus(frames.length, warningMetrics.length, minimumFrameCount);
  const thumbnailFrame = frames[Math.floor(frames.length / 2)] ?? null;

  return {
    frameCount: frames.length,
    issues,
    label: step.label,
    minimumFrameCount,
    shortLabel: step.shortLabel,
    state,
    status,
    statusLabel: getStatusLabel(status),
    targetFrameCount,
    thumbnailDataUrl: thumbnailFrame?.dataUrl ?? null,
  };
}

function getPhaseStatus(
  frameCount: number,
  warningMetricCount: number,
  minimumFrameCount: number,
): CaptureQualityStatus {
  if (frameCount === 0) {
    return "missing";
  }

  if (frameCount < minimumFrameCount || warningMetricCount > 0) {
    return "review";
  }

  return "ready";
}

function getSessionReviewStatus(phases: CapturePhaseSummary[]): CaptureQualityStatus {
  if (phases.some((phase) => phase.status === "missing")) {
    return "missing";
  }

  if (phases.some((phase) => phase.status === "review")) {
    return "review";
  }

  return "ready";
}

function getStatusLabel(status: CaptureQualityStatus): string {
  if (status === "missing") {
    return "Missing";
  }

  if (status === "review") {
    return "Review";
  }

  return "Ready";
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const encodedData = dataUrl.split(",")[1] ?? "";
  const binary = window.atob(encodedData);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function formatDateId(date: Date): string {
  return date.toISOString().replaceAll(":", "").replaceAll(".", "-");
}
