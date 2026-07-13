import type { Keypoint, Pose } from "@tensorflow-models/pose-detection/dist/types";
import { SCAN_STEPS } from "@/lib/scan-machine";
import type {
  CapturedBodyBounds,
  CapturedPoseKeypoint,
  ScanMetric,
  ScanState,
} from "@/types/scan";
import type { PoseQualityResult, VideoFrameQuality } from "@/types/vision";

const minimumKeypointScore = 0.25;
const coreKeypoints = [
  "nose",
  "left_shoulder",
  "right_shoulder",
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
];

type PoseQualityInput = {
  backend: string | null;
  frameQuality: VideoFrameQuality | null;
  height: number;
  pose: Pose | null;
  scanState: ScanState;
  width: number;
};

type NamedKeypoints = Record<string, Keypoint | undefined>;

export function buildPoseQualityResult({
  backend,
  frameQuality,
  height,
  pose,
  scanState,
  width,
}: PoseQualityInput): PoseQualityResult {
  const metrics: ScanMetric[] = [
    {
      label: "CV Engine",
      value: backend ? "MoveNet" : "Starting",
      tone: backend ? "good" : "neutral",
    },
  ];

  if (frameQuality) {
    metrics.push(frameQuality.brightnessMetric, frameQuality.sharpnessMetric);
  } else {
    metrics.push(
      { label: "Lighting", value: "Checking", tone: "neutral" },
      { label: "Sharpness", value: "Checking", tone: "neutral" },
    );
  }

  if (!pose || pose.keypoints.length === 0) {
    metrics.push(
      { label: "Body", value: "Not Found", tone: "warning" },
      { label: "Distance", value: "Unknown", tone: "neutral" },
      { label: "Centering", value: "Unknown", tone: "neutral" },
      { label: "Pose", value: "No Landmarks", tone: "warning" },
    );

    return {
      backend,
      bodyBounds: null,
      guidance: "Step fully into view so we can detect your body.",
      isAcceptable: false,
      keypoints: [],
      lastUpdatedAt: Date.now(),
      metrics,
      scanState,
      status: "running",
    };
  }

  const namedKeypoints = toNamedKeypoints(pose.keypoints);
  const visibleKeypoints = pose.keypoints.filter(isVisibleKeypoint);
  const bounds = getVisibleBounds(visibleKeypoints);
  const bodyMetric = getBodyVisibilityMetric(namedKeypoints, scanState);
  const distanceMetric = bounds
    ? scanState === "identity-detail"
      ? getIdentityDetailDistanceMetric(bounds.height / height)
      : getDistanceMetric(bounds.height / height)
    : { label: "Distance", value: "Unknown", tone: "neutral" as const };
  const centeringMetric = bounds
    ? getCenteringMetric((bounds.left + bounds.width / 2) / width)
    : { label: "Centering", value: "Unknown", tone: "neutral" as const };
  const poseMetric = getPoseMetric(scanState, namedKeypoints, bodyMetric.tone);

  metrics.push(bodyMetric, distanceMetric, centeringMetric, poseMetric);

  return {
    backend,
    bodyBounds: bounds,
    guidance: getGuidance(metrics, scanState),
    isAcceptable: metrics.every((metric) => metric.tone !== "warning"),
    keypoints: pose.keypoints.map(toCapturedKeypoint),
    lastUpdatedAt: Date.now(),
    metrics,
    scanState,
    status: "running",
  };
}

export function getPoseLoadingResult(
  scanState: ScanState,
  backend: string | null,
): PoseQualityResult {
  return {
    backend,
    bodyBounds: null,
    guidance: "Loading body tracking. Keep your full body in view.",
    isAcceptable: false,
    keypoints: [],
    lastUpdatedAt: null,
    metrics: [
      { label: "CV Engine", value: "Loading", tone: "warning" },
      { label: "Lighting", value: "Checking", tone: "neutral" },
      { label: "Body", value: "Checking", tone: "neutral" },
      { label: "Distance", value: "Checking", tone: "neutral" },
    ],
    scanState,
    status: "loading",
  };
}

export function getPoseErrorResult(
  scanState: ScanState,
  message: string,
): PoseQualityResult {
  return {
    backend: null,
    bodyBounds: null,
    guidance: "Body tracking is unavailable. You can continue with camera capture.",
    isAcceptable: false,
    keypoints: [],
    lastUpdatedAt: Date.now(),
    metrics: [
      { label: "CV Engine", value: "Unavailable", tone: "warning" },
      { label: "Body", value: "Manual Review", tone: "neutral" },
      { label: "Reason", value: message.slice(0, 28), tone: "neutral" },
    ],
    scanState,
    status: "error",
  };
}

function toNamedKeypoints(keypoints: Keypoint[]): NamedKeypoints {
  return Object.fromEntries(keypoints.map((keypoint) => [keypoint.name ?? "", keypoint]));
}

function isVisibleKeypoint(keypoint: Keypoint | undefined): keypoint is Keypoint {
  return Boolean(keypoint && (keypoint.score ?? 0) >= minimumKeypointScore);
}

function toCapturedKeypoint(keypoint: Keypoint): CapturedPoseKeypoint {
  return {
    name: keypoint.name ?? "",
    score: typeof keypoint.score === "number" ? Number(keypoint.score.toFixed(4)) : null,
    x: Number(keypoint.x.toFixed(2)),
    y: Number(keypoint.y.toFixed(2)),
  };
}

function getVisibleBounds(keypoints: Keypoint[]): CapturedBodyBounds | null {
  if (keypoints.length === 0) {
    return null;
  }

  const xs = keypoints.map((keypoint) => keypoint.x);
  const ys = keypoints.map((keypoint) => keypoint.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);

  return {
    bottom,
    height: bottom - top,
    left,
    right,
    top,
    width: right - left,
  };
}

function getBodyVisibilityMetric(
  keypoints: NamedKeypoints,
  scanState: ScanState,
): ScanMetric {
  const visibleCoreCount = coreKeypoints.filter((name) => isVisibleKeypoint(keypoints[name])).length;
  const hasHead =
    isVisibleKeypoint(keypoints.nose) ||
    isVisibleKeypoint(keypoints.left_eye) ||
    isVisibleKeypoint(keypoints.right_eye);
  const hasShoulders =
    isVisibleKeypoint(keypoints.left_shoulder) && isVisibleKeypoint(keypoints.right_shoulder);
  const hasHips = isVisibleKeypoint(keypoints.left_hip) && isVisibleKeypoint(keypoints.right_hip);
  const hasKnees =
    isVisibleKeypoint(keypoints.left_knee) && isVisibleKeypoint(keypoints.right_knee);
  const hasAnkles =
    isVisibleKeypoint(keypoints.left_ankle) && isVisibleKeypoint(keypoints.right_ankle);

  if (scanState === "identity-detail") {
    const hasFace =
      isVisibleKeypoint(keypoints.nose) &&
      (isVisibleKeypoint(keypoints.left_eye) || isVisibleKeypoint(keypoints.right_eye));
    const hasWrists =
      isVisibleKeypoint(keypoints.left_wrist) && isVisibleKeypoint(keypoints.right_wrist);

    return hasFace && hasShoulders && hasWrists
      ? { label: "Detail", value: "Face + Hands", tone: "good" }
      : { label: "Detail", value: "Show Face + Hands", tone: "warning" };
  }

  if (hasHead && hasShoulders && hasHips && hasKnees && hasAnkles) {
    return { label: "Body", value: "Fully Visible", tone: "good" };
  }

  if (visibleCoreCount >= 7 && !hasAnkles) {
    return { label: "Body", value: "Feet Missing", tone: "warning" };
  }

  if (hasHead && hasShoulders && hasHips) {
    return { label: "Body", value: "Partially Visible", tone: "warning" };
  }

  return { label: "Body", value: "Not Found", tone: "warning" };
}

function getDistanceMetric(bodyHeightRatio: number): ScanMetric {
  if (bodyHeightRatio > 0.9) {
    return { label: "Distance", value: "Too Close", tone: "warning" };
  }

  if (bodyHeightRatio < 0.43) {
    return { label: "Distance", value: "Too Far", tone: "warning" };
  }

  return { label: "Distance", value: "Ideal", tone: "good" };
}

function getIdentityDetailDistanceMetric(visibleHeightRatio: number): ScanMetric {
  if (visibleHeightRatio < 0.28) {
    return { label: "Distance", value: "Move Closer", tone: "warning" };
  }

  if (visibleHeightRatio > 0.88) {
    return { label: "Distance", value: "Too Close", tone: "warning" };
  }

  return { label: "Distance", value: "Detail Range", tone: "good" };
}

function getCenteringMetric(centerXRatio: number): ScanMetric {
  if (centerXRatio < 0.36 || centerXRatio > 0.64) {
    return { label: "Centering", value: "Off Center", tone: "warning" };
  }

  return { label: "Centering", value: "Centered", tone: "good" };
}

function getPoseMetric(
  scanState: ScanState,
  keypoints: NamedKeypoints,
  bodyTone: ScanMetric["tone"],
): ScanMetric {
  if (bodyTone === "warning") {
    return { label: "Pose", value: "Needs Body", tone: "neutral" };
  }

  const orientation = estimateOrientation(keypoints);

  if (scanState === "side-view" || scanState === "right-side-view") {
    return orientation === "side"
      ? { label: "Pose", value: "Side View", tone: "good" }
      : { label: "Pose", value: "Turn Side", tone: "warning" };
  }

  if (scanState === "front-view" || scanState === "back-view") {
    return orientation === "side"
      ? { label: "Pose", value: "Too Side-On", tone: "warning" }
      : { label: "Pose", value: "Aligned", tone: "good" };
  }

  if (
    scanState === "rotate-left" ||
    scanState === "rotate-to-back" ||
    scanState === "rotate-right" ||
    scanState === "return-front"
  ) {
    return { label: "Rotation", value: "Tracked", tone: "good" };
  }

  return { label: "Pose", value: "Tracked", tone: "good" };
}

function estimateOrientation(keypoints: NamedKeypoints): "front-back" | "side" | "angled" {
  const leftShoulder = keypoints.left_shoulder;
  const rightShoulder = keypoints.right_shoulder;
  const leftHip = keypoints.left_hip;
  const rightHip = keypoints.right_hip;

  if (
    !isVisibleKeypoint(leftShoulder) ||
    !isVisibleKeypoint(rightShoulder) ||
    !isVisibleKeypoint(leftHip) ||
    !isVisibleKeypoint(rightHip)
  ) {
    return "angled";
  }

  const shoulderSpan = Math.abs(leftShoulder.x - rightShoulder.x);
  const hipSpan = Math.abs(leftHip.x - rightHip.x);
  const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;
  const hipY = (leftHip.y + rightHip.y) / 2;
  const torsoHeight = Math.max(1, Math.abs(hipY - shoulderY));
  const spanRatio = Math.max(shoulderSpan, hipSpan) / torsoHeight;

  if (spanRatio < 0.42) {
    return "side";
  }

  if (spanRatio > 0.62) {
    return "front-back";
  }

  return "angled";
}

function getGuidance(metrics: ScanMetric[], scanState: ScanState): string {
  const warning = metrics.find((metric) => metric.tone === "warning");

  if (!warning) {
    return SCAN_STEPS[scanState].capturesData
      ? SCAN_STEPS[scanState].instruction
      : "Great. Stay inside the guide.";
  }

  if (warning.label === "Lighting") {
    return warning.value === "Too Bright"
      ? "Reduce harsh light behind or above you."
      : "Move into brighter, even lighting.";
  }

  if (warning.label === "Sharpness") {
    return "Hold still so the frame stays sharp.";
  }

  if (warning.label === "Body") {
    return warning.value === "Feet Missing"
      ? "Step back until your feet are visible."
      : "Place your full body inside the outline.";
  }

  if (warning.label === "Detail") {
    return "Keep your face and both open hands inside the detail guide.";
  }

  if (warning.label === "Distance") {
    return warning.value === "Too Close"
      ? "Stand a little further back."
      : "Move slightly closer to the camera.";
  }

  if (warning.label === "Centering") {
    return "Move to the center of the guide.";
  }

  if (warning.label === "Pose") {
    return scanState === "side-view" || scanState === "right-side-view"
      ? "Turn until your side faces the camera."
      : "Face squarely toward the scan direction.";
  }

  return SCAN_STEPS[scanState].instruction;
}
