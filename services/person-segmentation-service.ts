import type {
  CapturedBodyBounds,
  CapturedPersonSegmentation,
  CapturedPoseKeypoint,
  CapturedSegmentationMask,
  CapturedSegmentationRowKey,
  CapturedSegmentationRowWidths,
  ScanMetric,
  ScanState,
} from "@/types/scan";
import type { PersonSegmentationResult } from "@/types/vision";

const personAlphaThreshold = 96;
const compactMaskShortSide = 192;
const minimumForegroundSamples = 96;
const minimumKeypointScore = 0.2;

type BuildPersonSegmentationInput = {
  imageData: ImageData;
  poseBodyBounds: CapturedBodyBounds | null;
  poseKeypoints: CapturedPoseKeypoint[];
  scanState: ScanState;
};

type MeasurementTarget = {
  centerX: number;
  y: number;
};

type MeasurementTargets = Record<CapturedSegmentationRowKey, MeasurementTarget>;

export function buildPersonSegmentationResult({
  imageData,
  poseBodyBounds,
  poseKeypoints,
  scanState,
}: BuildPersonSegmentationInput): PersonSegmentationResult {
  const bounds = findPersonMaskBounds(imageData);
  const bodyBounds = bounds ?? poseBodyBounds;
  const foregroundRatio = getForegroundRatio(imageData);
  const compactMask = buildCompactMask(imageData);
  const rowWidths = bodyBounds
    ? getSegmentationRowWidths(imageData, bodyBounds, poseKeypoints)
    : {};
  const quality = getSegmentationQuality(bounds, imageData.width, imageData.height, foregroundRatio);
  const segmentation: CapturedPersonSegmentation = {
    backend: "mediapipe",
    bodyBounds: bounds,
    foregroundRatio: roundRatio(foregroundRatio),
    mask: compactMask,
    provider: "tensorflow-body-segmentation-mediapipe-selfie",
    quality,
    rowWidths,
    status: "running",
    updatedAt: Date.now(),
  };

  return {
    errorMessage: null,
    isAcceptable: quality !== "poor",
    metrics: [getSegmentationMetric(quality)],
    scanState,
    segmentation,
    status: "running",
  };
}

export function getPersonSegmentationLoadingResult(
  scanState: ScanState,
): PersonSegmentationResult {
  return {
    errorMessage: null,
    isAcceptable: false,
    metrics: [{ label: "Mask", value: "Loading", tone: "neutral" }],
    scanState,
    segmentation: null,
    status: "loading",
  };
}

export function getPersonSegmentationIdleResult(scanState: ScanState): PersonSegmentationResult {
  return {
    errorMessage: null,
    isAcceptable: false,
    metrics: [{ label: "Mask", value: "Waiting", tone: "neutral" }],
    scanState,
    segmentation: null,
    status: "idle",
  };
}

export function getPersonSegmentationErrorResult(
  scanState: ScanState,
  message: string,
): PersonSegmentationResult {
  return {
    errorMessage: message,
    isAcceptable: false,
    metrics: [{ label: "Mask", value: "Unavailable", tone: "neutral" }],
    scanState,
    segmentation: null,
    status: "error",
  };
}

function findPersonMaskBounds(imageData: ImageData): CapturedBodyBounds | null {
  const { data, height, width } = imageData;
  const step = width * height > 1_100_000 ? 2 : 1;
  let left = width;
  let right = 0;
  let top = height;
  let bottom = 0;
  let count = 0;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const pixelIndex = (y * width + x) * 4;

      if (!isPersonMaskPixel(data, pixelIndex)) {
        continue;
      }

      left = Math.min(left, x);
      right = Math.max(right, Math.min(width - 1, x + step - 1));
      top = Math.min(top, y);
      bottom = Math.max(bottom, Math.min(height - 1, y + step - 1));
      count += 1;
    }
  }

  if (count < minimumForegroundSamples || right <= left || bottom <= top) {
    return null;
  }

  return roundBounds({
    bottom,
    height: bottom - top,
    left,
    right,
    top,
    width: right - left,
  });
}

function getForegroundRatio(imageData: ImageData): number {
  const { data, height, width } = imageData;
  const step = width * height > 1_100_000 ? 3 : 2;
  let foreground = 0;
  let samples = 0;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const pixelIndex = (y * width + x) * 4;
      foreground += isPersonMaskPixel(data, pixelIndex) ? 1 : 0;
      samples += 1;
    }
  }

  return samples > 0 ? foreground / samples : 0;
}

function getSegmentationRowWidths(
  imageData: ImageData,
  bounds: CapturedBodyBounds,
  keypoints: CapturedPoseKeypoint[],
): CapturedSegmentationRowWidths {
  const namedKeypoints = toNamedKeypoints(keypoints);
  const rowTargets = getMeasurementRowTargets(namedKeypoints, bounds);
  const entries = Object.entries(rowTargets).map(([key, target]) => [
    key,
    getMaskWidthAtRow(imageData, bounds, target),
  ]);

  return Object.fromEntries(entries) as CapturedSegmentationRowWidths;
}

function getMeasurementRowTargets(
  keypoints: Map<string, CapturedPoseKeypoint>,
  bounds: CapturedBodyBounds,
): MeasurementTargets {
  const shoulderCenter = getMidpoint(
    keypoints.get("left_shoulder"),
    keypoints.get("right_shoulder"),
  );
  const hipCenter = getMidpoint(keypoints.get("left_hip"), keypoints.get("right_hip"));
  const fallbackCenterX = bounds.left + bounds.width / 2;

  if (shoulderCenter && hipCenter && hipCenter.y > shoulderCenter.y) {
    const torsoHeight = hipCenter.y - shoulderCenter.y;
    const centerX = getMedian([shoulderCenter.x, hipCenter.x]) ?? fallbackCenterX;

    return {
      neck: {
        centerX: shoulderCenter.x,
        y: Math.max(bounds.top, shoulderCenter.y - torsoHeight * 0.16),
      },
      chest: {
        centerX,
        y: shoulderCenter.y + torsoHeight * 0.22,
      },
      hips: {
        centerX,
        y: hipCenter.y + torsoHeight * 0.06,
      },
      shoulder: {
        centerX: shoulderCenter.x,
        y: shoulderCenter.y,
      },
      thigh: {
        centerX,
        y: hipCenter.y + torsoHeight * 0.48,
      },
      waist: {
        centerX,
        y: shoulderCenter.y + torsoHeight * 0.64,
      },
    };
  }

  return {
    neck: {
      centerX: fallbackCenterX,
      y: bounds.top + bounds.height * 0.18,
    },
    chest: {
      centerX: fallbackCenterX,
      y: bounds.top + bounds.height * 0.34,
    },
    hips: {
      centerX: fallbackCenterX,
      y: bounds.top + bounds.height * 0.6,
    },
    shoulder: {
      centerX: fallbackCenterX,
      y: bounds.top + bounds.height * 0.24,
    },
    thigh: {
      centerX: fallbackCenterX,
      y: bounds.top + bounds.height * 0.72,
    },
    waist: {
      centerX: fallbackCenterX,
      y: bounds.top + bounds.height * 0.5,
    },
  };
}

function getMaskWidthAtRow(
  imageData: ImageData,
  bounds: CapturedBodyBounds,
  target: MeasurementTarget,
): number | null {
  const { data, height, width } = imageData;
  const targetY = clamp(Math.round(target.y), 0, height - 1);
  const centerX = clamp(Math.round(target.centerX), 0, width - 1);
  const band = Math.max(6, Math.round(height * 0.006));
  const minY = Math.max(0, targetY - band);
  const maxY = Math.min(height - 1, targetY + band);
  const minX = Math.max(0, Math.round(bounds.left - width * 0.035));
  const maxX = Math.min(width - 1, Math.round(bounds.right + width * 0.035));
  const widths: number[] = [];

  for (let y = minY; y <= maxY; y += 1) {
    const run = findMaskRunAtRow(data, width, y, minX, maxX, centerX);

    if (run) {
      widths.push(run.right - run.left);
    }
  }

  const median = getMedian(widths);
  return median ? Number(median.toFixed(2)) : null;
}

function findMaskRunAtRow(
  data: Uint8ClampedArray,
  imageWidth: number,
  y: number,
  minX: number,
  maxX: number,
  centerX: number,
): { left: number; right: number } | null {
  const runs: Array<{ left: number; right: number }> = [];
  let activeRun: { left: number; right: number } | null = null;

  for (let x = minX; x <= maxX; x += 1) {
    const pixelIndex = (y * imageWidth + x) * 4;

    if (isPersonMaskPixel(data, pixelIndex)) {
      activeRun ??= { left: x, right: x };
      activeRun.right = x;
      continue;
    }

    if (activeRun) {
      runs.push(activeRun);
      activeRun = null;
    }
  }

  if (activeRun) {
    runs.push(activeRun);
  }

  return runs
    .filter((run) => run.right - run.left >= 8)
    .sort((left, right) => {
      const leftDistance = getRunDistanceFromCenter(left, centerX);
      const rightDistance = getRunDistanceFromCenter(right, centerX);

      return leftDistance - rightDistance;
    })[0] ?? null;
}

function buildCompactMask(imageData: ImageData): CapturedSegmentationMask | null {
  const { data, height, width } = imageData;
  const scale = compactMaskShortSide / Math.min(width, height);
  const maskWidth = Math.max(1, Math.round(width * scale));
  const maskHeight = Math.max(1, Math.round(height * scale));
  const values: number[] = [];
  let foregroundCount = 0;

  for (let y = 0; y < maskHeight; y += 1) {
    const sourceY = clamp(Math.floor((y + 0.5) / maskHeight * height), 0, height - 1);

    for (let x = 0; x < maskWidth; x += 1) {
      const sourceX = clamp(Math.floor((x + 0.5) / maskWidth * width), 0, width - 1);
      const pixelIndex = (sourceY * width + sourceX) * 4;
      const value = isPersonMaskPixel(data, pixelIndex) ? 1 : 0;

      values.push(value);
      foregroundCount += value;
    }
  }

  if (foregroundCount < 24) {
    return null;
  }

  return {
    counts: encodeRunLengthMask(values),
    encoding: "rle",
    foregroundValue: 1,
    height: maskHeight,
    threshold: personAlphaThreshold,
    width: maskWidth,
  };
}

function encodeRunLengthMask(values: number[]): number[] {
  const counts: number[] = [];
  let currentValue = 0;
  let runLength = 0;

  for (const value of values) {
    if (value === currentValue) {
      runLength += 1;
      continue;
    }

    counts.push(runLength);
    currentValue = value;
    runLength = 1;
  }

  counts.push(runLength);
  return counts;
}

function getSegmentationQuality(
  bounds: CapturedBodyBounds | null,
  imageWidth: number,
  imageHeight: number,
  foregroundRatio: number,
): CapturedPersonSegmentation["quality"] {
  if (!bounds) {
    return "poor";
  }

  const heightRatio = bounds.height / imageHeight;
  const widthRatio = bounds.width / imageWidth;

  if (heightRatio >= 0.42 && widthRatio >= 0.12 && foregroundRatio >= 0.035) {
    return "good";
  }

  if (heightRatio >= 0.28 && widthRatio >= 0.07 && foregroundRatio >= 0.018) {
    return "partial";
  }

  return "poor";
}

function getSegmentationMetric(quality: CapturedPersonSegmentation["quality"]): ScanMetric {
  if (quality === "good") {
    return { label: "Mask", value: "Person", tone: "good" };
  }

  if (quality === "partial") {
    return { label: "Mask", value: "Partial", tone: "neutral" };
  }

  return { label: "Mask", value: "Weak", tone: "neutral" };
}

function toNamedKeypoints(keypoints: CapturedPoseKeypoint[]): Map<string, CapturedPoseKeypoint> {
  const namedKeypoints = new Map<string, CapturedPoseKeypoint>();

  for (const keypoint of keypoints) {
    if (!keypoint.name || (keypoint.score ?? 0) < minimumKeypointScore) {
      continue;
    }

    namedKeypoints.set(keypoint.name, keypoint);
  }

  return namedKeypoints;
}

function getMidpoint(
  first: CapturedPoseKeypoint | undefined,
  second: CapturedPoseKeypoint | undefined,
): { x: number; y: number } | null {
  if (!first || !second) {
    return null;
  }

  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  };
}

function getRunDistanceFromCenter(run: { left: number; right: number }, centerX: number): number {
  if (centerX >= run.left && centerX <= run.right) {
    return 0;
  }

  return Math.min(Math.abs(centerX - run.left), Math.abs(centerX - run.right));
}

function isPersonMaskPixel(data: Uint8ClampedArray, pixelIndex: number): boolean {
  return data[pixelIndex + 3] >= personAlphaThreshold;
}

function roundBounds(bounds: CapturedBodyBounds): CapturedBodyBounds {
  return {
    bottom: Number(bounds.bottom.toFixed(2)),
    height: Number(bounds.height.toFixed(2)),
    left: Number(bounds.left.toFixed(2)),
    right: Number(bounds.right.toFixed(2)),
    top: Number(bounds.top.toFixed(2)),
    width: Number(bounds.width.toFixed(2)),
  };
}

function roundRatio(value: number): number {
  return Number(value.toFixed(4));
}

function getMedian(values: number[]): number | null {
  const sortedValues = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);

  if (sortedValues.length === 0) {
    return null;
  }

  const middle = Math.floor(sortedValues.length / 2);

  if (sortedValues.length % 2 === 1) {
    return sortedValues[middle];
  }

  return (sortedValues[middle - 1] + sortedValues[middle]) / 2;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
