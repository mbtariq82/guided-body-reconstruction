declare module "@/scripts/process-scan-jobs.mjs" {
  import type {
    ScanProcessSessionResponse,
    ScanProcessingJobStatusResponse,
    ScanSessionDetail,
    ScanSessionListItem,
  } from "@/types/scan";

  export type ScanProcessingSummary = {
    jobId: string;
    sessionId: string;
    status: string;
  };

  export function processQueuedScanSessions(): Promise<ScanProcessingSummary[]>;

  export function listScanSessions(): Promise<ScanSessionListItem[]>;

  export function readScanSessionDetail(
    sessionId: string,
  ): Promise<ScanSessionDetail>;

  export function processScanSession(
    sessionId: string,
  ): Promise<ScanProcessSessionResponse>;

  export function readScanProcessingJobStatus(
    sessionId: string,
  ): Promise<ScanProcessingJobStatusResponse>;
}

declare module "@/scripts/avatar-reconstruction-service.mjs" {
  import type { AvatarReconstructionStatusResponse } from "@/types/scan";

  export function readAvatarReconstructionState(
    sessionId: string,
  ): Promise<AvatarReconstructionStatusResponse>;

  export function requestSelfHostedAvatarReconstruction(
    sessionId: string,
    options?: { force?: boolean },
  ): Promise<AvatarReconstructionStatusResponse>;
}
