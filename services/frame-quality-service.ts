import type { ScanMetric } from "@/types/scan";
import type { VideoFrameQuality } from "@/types/vision";

const sampleWidth = 96;
const minimumSharpness = 5.2;

export function analyzeVideoFrameQuality(
  video: HTMLVideoElement,
): VideoFrameQuality | null {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;

  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = sampleWidth;
  canvas.height = Math.max(72, Math.round((sourceHeight / sourceWidth) * sampleWidth));

  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    return null;
  }

  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const luminance = new Float32Array(canvas.width * canvas.height);
  let totalLuminance = 0;

  for (let pixelIndex = 0; pixelIndex < luminance.length; pixelIndex += 1) {
    const sourceIndex = pixelIndex * 4;
    const value =
      data[sourceIndex] * 0.2126 +
      data[sourceIndex + 1] * 0.7152 +
      data[sourceIndex + 2] * 0.0722;

    luminance[pixelIndex] = value;
    totalLuminance += value;
  }

  let edgeTotal = 0;
  let edgeCount = 0;

  for (let y = 1; y < canvas.height; y += 1) {
    for (let x = 1; x < canvas.width; x += 1) {
      const index = y * canvas.width + x;
      const leftDifference = Math.abs(luminance[index] - luminance[index - 1]);
      const topDifference = Math.abs(luminance[index] - luminance[index - canvas.width]);

      edgeTotal += leftDifference + topDifference;
      edgeCount += 2;
    }
  }

  const brightness = totalLuminance / luminance.length;
  const sharpness = edgeCount === 0 ? 0 : edgeTotal / edgeCount;

  return {
    brightness,
    brightnessMetric: getBrightnessMetric(brightness),
    sharpness,
    sharpnessMetric: getSharpnessMetric(sharpness),
  };
}

function getBrightnessMetric(brightness: number): ScanMetric {
  if (brightness < 42) {
    return { label: "Lighting", value: "Too Dark", tone: "warning" };
  }

  if (brightness > 218) {
    return { label: "Lighting", value: "Too Bright", tone: "warning" };
  }

  if (brightness < 58) {
    return { label: "Lighting", value: "Dim", tone: "warning" };
  }

  return { label: "Lighting", value: "Good", tone: "good" };
}

function getSharpnessMetric(sharpness: number): ScanMetric {
  if (sharpness < minimumSharpness) {
    return { label: "Sharpness", value: "Blurry", tone: "warning" };
  }

  return { label: "Sharpness", value: "Clear", tone: "good" };
}
