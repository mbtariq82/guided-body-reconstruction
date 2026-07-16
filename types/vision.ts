import type {
  CapturedBodyBounds,
  CapturedPersonSegmentation,
  CapturedPoseKeypoint,
  CapturedPoseWorldKeypoint,
  ScanMetric,
  ScanState,
} from "@/types/scan";

export type VisionRuntimeStatus =
  | "idle"
  | "loading"
  | "ready"
  | "running"
  | "error"
  | "unsupported";

export type VideoFrameQuality = {
  brightness: number;
  brightnessMetric: ScanMetric;
  sharpness: number;
  sharpnessMetric: ScanMetric;
};

export type PoseQualityResult = {
  backend: string | null;
  bodyBounds: CapturedBodyBounds | null;
  guidance: string;
  isAcceptable: boolean;
  keypoints: CapturedPoseKeypoint[];
  lastUpdatedAt: number | null;
  metrics: ScanMetric[];
  provider: "mediapipe-blazepose";
  scanState: ScanState;
  status: VisionRuntimeStatus;
  worldKeypoints: CapturedPoseWorldKeypoint[];
};

export type PersonSegmentationResult = {
  errorMessage: string | null;
  isAcceptable: boolean;
  metrics: ScanMetric[];
  scanState: ScanState;
  segmentation: CapturedPersonSegmentation | null;
  status: VisionRuntimeStatus;
};

export type CaptureGateStatus = "idle" | "loading" | "adjust" | "hold" | "capturing";

export type CaptureGate = {
  detail: string;
  isFrameAcceptable: boolean;
  label: string;
  shouldAdvancePhase: boolean;
  status: CaptureGateStatus;
};
