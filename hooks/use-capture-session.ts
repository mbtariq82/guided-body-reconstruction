"use client";

import { useCallback, useRef, useState } from "react";
import {
  clearCaptureFramesFromState,
  addCaptureSessionVideo,
  captureMockFrame,
  captureVideoFrame,
  completeCaptureSession,
  createCaptureSession,
  downloadCaptureSession,
  setCaptureSessionSubjectHeight,
  setCaptureSessionVideoStatus,
  summarizeCaptureSession,
} from "@/services/capture-session-service";
import {
  fetchScanProcessingJobStatus,
  processScanSessionLocally,
  uploadCaptureSessionArchive,
} from "@/services/session-upload-service";
import type {
  CaptureSession,
  CaptureSessionSummary,
  CapturedFrameVision,
  CaptureUploadState,
  CapturedScanVideo,
  CaptureVideoStatus,
  ScanMetric,
  ScanProcessingJobStatusResponse,
  ScanState,
} from "@/types/scan";

type CaptureFrameInput = {
  cameraMode: "live" | "mock";
  instruction: string;
  metrics: ScanMetric[];
  phaseProgress: number;
  scanState: ScanState;
  vision: CapturedFrameVision | null;
  videoElement: HTMLVideoElement | null;
};

const initialUploadState: CaptureUploadState = {
  job: null,
  measurementReport: null,
  message: "Session has not been uploaded.",
  sessionId: null,
  status: "idle",
  uploadedAt: null,
  validationReport: null,
};

function getProcessingStatusMessage(result: ScanProcessingJobStatusResponse): string {
  if (result.processingJob.status === "completed") {
    if (result.measurementReport?.status === "estimated") {
      return "Processing complete. Measurements, avatar, outfit preview, and video recorder are ready.";
    }

    return "Processing complete. Validation passed, but measurement extraction needs more data before the avatar demo is reliable.";
  }

  if (result.processingJob.status === "failed") {
    return result.processingJob.errorMessage ?? "Processing failed validation.";
  }

  if (result.processingJob.status === "processing") {
    return "Processing scan session locally...";
  }

  return "Scan session is queued for local processing.";
}

export function useCaptureSession(initialCameraMode: "live" | "mock") {
  const sessionRef = useRef<CaptureSession>(createCaptureSession(initialCameraMode));
  const [summary, setSummary] = useState<CaptureSessionSummary>(() =>
    summarizeCaptureSession(sessionRef.current),
  );
  const [uploadState, setUploadState] = useState<CaptureUploadState>(initialUploadState);

  const syncSummary = useCallback(() => {
    setSummary(summarizeCaptureSession(sessionRef.current));
  }, []);

  const resetCaptureSession = useCallback(
    (cameraMode: "live" | "mock" = initialCameraMode) => {
      sessionRef.current = createCaptureSession(cameraMode);
      setSummary(summarizeCaptureSession(sessionRef.current));
      setUploadState(initialUploadState);
    },
    [initialCameraMode],
  );

  const captureFrame = useCallback(
    ({
      cameraMode,
      instruction,
      metrics,
      phaseProgress,
      scanState,
      vision,
      videoElement,
    }: CaptureFrameInput) => {
      const session = sessionRef.current;

      if (session.completedAt) {
        return;
      }

      const frameNumber = session.frames.length + 1;
      const phaseFrameNumber =
        session.frames.filter((frame) => frame.state === scanState).length + 1;
      const elapsedMs = Date.now() - new Date(session.startedAt).getTime();
      const captureOptions = {
        elapsedMs,
        frameNumber,
        instruction,
        metrics,
        phaseFrameNumber,
        phaseProgress,
        source: cameraMode === "mock" ? "mock-camera" : "live-camera",
        state: scanState,
        vision,
      } as const;

      const frame =
        cameraMode === "mock"
          ? captureMockFrame(captureOptions)
          : captureVideoFrame(videoElement, captureOptions);

      if (!frame) {
        return;
      }

      session.frames.push(frame);
      if (uploadState.status === "uploaded") {
        setUploadState(initialUploadState);
      }
      syncSummary();
    },
    [syncSummary, uploadState.status],
  );

  const markCaptureComplete = useCallback(() => {
    completeCaptureSession(sessionRef.current);
    syncSummary();
  }, [syncSummary]);

  const captureVideo = useCallback(
    (video: CapturedScanVideo) => {
      addCaptureSessionVideo(sessionRef.current, video);
      syncSummary();
    },
    [syncSummary],
  );

  const setVideoStatus = useCallback(
    (status: CaptureVideoStatus) => {
      setCaptureSessionVideoStatus(sessionRef.current, status);
      syncSummary();
    },
    [syncSummary],
  );

  const exportCaptureSession = useCallback(async () => {
    if (!summarizeCaptureSession(sessionRef.current).isExportReady) {
      return;
    }

    await downloadCaptureSession(sessionRef.current);
  }, []);

  const setSubjectHeightCm = useCallback(
    (heightCm: number | null) => {
      setCaptureSessionSubjectHeight(sessionRef.current, heightCm);
      if (uploadState.status !== "idle") {
        setUploadState(initialUploadState);
      }
      syncSummary();
    },
    [syncSummary, uploadState.status],
  );

  const retakeCapturePhase = useCallback(
    (scanState: ScanState) => {
      clearCaptureFramesFromState(sessionRef.current, scanState);
      setUploadState(initialUploadState);
      syncSummary();
    },
    [syncSummary],
  );

  const uploadCaptureSession = useCallback(async () => {
    const session = sessionRef.current;

    if (!summarizeCaptureSession(session).isExportReady) {
      setUploadState({
        job: null,
        measurementReport: null,
        message: "Resolve scan review issues before uploading.",
        sessionId: session.id,
        status: "error",
        uploadedAt: null,
        validationReport: null,
      });
      return;
    }

    if (!isValidSubjectHeight(session.subject.heightCm)) {
      setUploadState({
        job: null,
        measurementReport: null,
        message: "Enter your height before upload so local measurements can be calibrated.",
        sessionId: session.id,
        status: "error",
        uploadedAt: null,
        validationReport: null,
      });
      return;
    }

    setUploadState({
      job: null,
      measurementReport: null,
      message: "Uploading approved scan session...",
      sessionId: session.id,
      status: "uploading",
      uploadedAt: null,
      validationReport: null,
    });

    try {
      const result = await uploadCaptureSessionArchive(session);
      setUploadState({
        job: result.processingJob,
        measurementReport: result.measurementReport,
        message: `Uploaded ${Math.round(result.archiveSize / 1024)} KB and queued reconstruction job.`,
        sessionId: result.sessionId,
        status: "uploaded",
        uploadedAt: result.storedAt,
        validationReport: result.validationReport,
      });
    } catch (error) {
      setUploadState({
        job: null,
        measurementReport: null,
        message:
          error instanceof Error
            ? error.message
            : "Unable to upload scan session.",
        sessionId: session.id,
        status: "error",
        uploadedAt: null,
        validationReport: null,
      });
    }
  }, []);

  const processUploadedSession = useCallback(async () => {
    const sessionId = uploadState.sessionId ?? sessionRef.current.id;

    if (!uploadState.job) {
      setUploadState((currentState) => ({
        ...currentState,
        message: "Upload the scan session before local processing.",
        sessionId,
        status: "error",
      }));
      return;
    }

    setUploadState((currentState) => ({
      ...currentState,
      message: "Running local dataset validation...",
      sessionId,
      status: "processing",
    }));

    try {
      const result = await processScanSessionLocally(sessionId);

      setUploadState((currentState) => ({
        ...currentState,
        job: result.processingJob,
        measurementReport: result.measurementReport,
        message: getProcessingStatusMessage(result),
        sessionId,
        status: "uploaded",
        validationReport: result.validationReport,
      }));
    } catch (error) {
      setUploadState((currentState) => ({
        ...currentState,
        message:
          error instanceof Error
            ? error.message
            : "Unable to process scan session.",
        sessionId,
        status: "error",
      }));
    }
  }, [uploadState.job, uploadState.sessionId]);

  const refreshProcessingJobStatus = useCallback(async () => {
    const sessionId = uploadState.sessionId ?? sessionRef.current.id;

    try {
      const result = await fetchScanProcessingJobStatus(sessionId);

      setUploadState((currentState) => ({
        ...currentState,
        job: result.processingJob,
        measurementReport: result.measurementReport,
        message: getProcessingStatusMessage(result),
        sessionId,
        status: currentState.status === "idle" ? "uploaded" : currentState.status,
        validationReport: result.validationReport,
      }));
    } catch (error) {
      setUploadState((currentState) => ({
        ...currentState,
        message:
          error instanceof Error
            ? error.message
            : "Unable to load processing job status.",
        sessionId,
        status: currentState.status === "idle" ? "error" : currentState.status,
      }));
    }
  }, [uploadState.sessionId]);

  return {
    captureFrame,
    captureVideo,
    exportCaptureSession,
    markCaptureComplete,
    processUploadedSession,
    resetCaptureSession,
    retakeCapturePhase,
    refreshProcessingJobStatus,
    setSubjectHeightCm,
    setVideoStatus,
    sessionSummary: summary,
    uploadCaptureSession,
    uploadState,
  };
}

function isValidSubjectHeight(heightCm: number | null): heightCm is number {
  return typeof heightCm === "number" && heightCm >= 120 && heightCm <= 230;
}
