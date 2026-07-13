import {
  createCaptureSessionArchive,
  getCaptureSessionArchiveName,
  summarizeCaptureSession,
} from "@/services/capture-session-service";
import type {
  CaptureSession,
  ScanProcessSessionResponse,
  ScanProcessingJobStatusResponse,
} from "@/types/scan";

export type ScanSessionUploadResult = {
  archiveFile: string;
  archiveSize: number;
  manifestFile: string;
  processingJobFile: string;
  sessionId: string;
  storedAt: string;
} & ScanProcessingJobStatusResponse;

export async function uploadCaptureSessionArchive(
  session: CaptureSession,
): Promise<ScanSessionUploadResult> {
  const summary = summarizeCaptureSession(session);

  if (!summary.isExportReady) {
    throw new Error("Resolve scan review issues before uploading.");
  }

  const archive = await createCaptureSessionArchive(session);
  const formData = new FormData();

  formData.append("sessionId", session.id);
  formData.append(
    "metadata",
    JSON.stringify({
      cameraMode: session.cameraMode,
      completedAt: session.completedAt,
      frameCount: summary.frameCount,
      reviewStatus: summary.reviewStatus,
      schemaVersion: session.schemaVersion,
      startedAt: session.startedAt,
      subject: session.subject,
      videoCount: summary.videoCount,
      videoDurationMs: summary.videoDurationMs,
    }),
  );
  formData.append("archive", archive, getCaptureSessionArchiveName(session));

  const response = await fetch("/api/scan-sessions", {
    body: formData,
    method: "POST",
  });

  const responseBody = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      typeof responseBody?.error === "string"
        ? responseBody.error
        : "Unable to upload scan session.",
    );
  }

  return responseBody as ScanSessionUploadResult;
}

export async function fetchScanProcessingJobStatus(
  sessionId: string,
): Promise<ScanProcessingJobStatusResponse> {
  const response = await fetch(
    `/api/scan-sessions/${encodeURIComponent(sessionId)}/processing-job`,
  );
  const responseBody = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      typeof responseBody?.error === "string"
        ? responseBody.error
        : "Unable to load processing job status.",
    );
  }

  return responseBody as ScanProcessingJobStatusResponse;
}

export async function processScanSessionLocally(
  sessionId: string,
): Promise<ScanProcessSessionResponse> {
  const response = await fetch(
    `/api/scan-sessions/${encodeURIComponent(sessionId)}/process`,
    {
      method: "POST",
    },
  );
  const responseBody = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      typeof responseBody?.error === "string"
        ? responseBody.error
        : "Unable to process scan session.",
    );
  }

  return responseBody as ScanProcessSessionResponse;
}
