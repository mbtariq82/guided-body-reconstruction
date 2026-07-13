import { SCAN_STEPS } from "@/lib/scan-machine";
import type { ScanMetric, ScanState } from "@/types/scan";
import type { CaptureGate, PoseQualityResult } from "@/types/vision";

type CaptureGateInput = {
  isLiveCamera: boolean;
  metrics: ScanMetric[];
  poseQuality: PoseQualityResult;
  scanState: ScanState;
  useMockCamera: boolean;
};

export function getCaptureGate({
  isLiveCamera,
  metrics,
  poseQuality,
  scanState,
  useMockCamera,
}: CaptureGateInput): CaptureGate {
  const step = SCAN_STEPS[scanState];

  if (!step.capturesData && scanState !== "position-user") {
    return {
      detail: "Capture has not started.",
      isFrameAcceptable: false,
      label: "Idle",
      shouldAdvancePhase: true,
      status: "idle",
    };
  }

  if (useMockCamera) {
    return {
      detail: step.capturesData
        ? "Mock frame quality is passing."
        : "Mock scanner is ready.",
      isFrameAcceptable: true,
      label: step.capturesData ? "Capturing" : "Ready",
      shouldAdvancePhase: true,
      status: "capturing",
    };
  }

  if (!isLiveCamera) {
    return {
      detail: "Camera stream is not available.",
      isFrameAcceptable: false,
      label: "Camera unavailable",
      shouldAdvancePhase: false,
      status: "adjust",
    };
  }

  if (poseQuality.status === "loading" || poseQuality.status === "idle") {
    return {
      detail: "Body tracking is loading.",
      isFrameAcceptable: false,
      label: "Loading tracking",
      shouldAdvancePhase: false,
      status: "loading",
    };
  }

  if (poseQuality.status === "error" || poseQuality.status === "unsupported") {
    return {
      detail: "Body tracking is unavailable, so capture is paused.",
      isFrameAcceptable: false,
      label: "Tracking unavailable",
      shouldAdvancePhase: false,
      status: "adjust",
    };
  }

  const blockingMetric = metrics.find((metric) => metric.tone === "warning");

  if (blockingMetric) {
    return {
      detail: getBlockingDetail(blockingMetric),
      isFrameAcceptable: false,
      label: blockingMetric.label === "Sharpness" ? "Hold still" : "Adjust position",
      shouldAdvancePhase: false,
      status: blockingMetric.label === "Sharpness" ? "hold" : "adjust",
    };
  }

  return {
    detail: step.capturesData
      ? "Saving quality-approved frames."
      : "Body tracking and frame quality are ready.",
    isFrameAcceptable: true,
    label: step.capturesData ? "Capturing" : "Ready",
    shouldAdvancePhase: true,
    status: "capturing",
  };
}

function getBlockingDetail(metric: ScanMetric): string {
  if (metric.label === "Lighting") {
    return metric.value === "Too Bright"
      ? "Reduce harsh light before capture continues."
      : "Move into brighter, even lighting before capture continues.";
  }

  if (metric.label === "Sharpness") {
    return "Hold still until the frame is clear.";
  }

  if (metric.label === "Body") {
    return metric.value === "Feet Missing"
      ? "Step back until your feet are visible."
      : "Place your full body inside the outline.";
  }

  if (metric.label === "Distance") {
    return metric.value === "Too Close"
      ? "Stand further back before capture continues."
      : "Move closer before capture continues.";
  }

  if (metric.label === "Centering") {
    return "Move to the center of the guide.";
  }

  if (metric.label === "Pose") {
    return "Match the requested scan angle before capture continues.";
  }

  return `${metric.label} needs attention before capture continues.`;
}
