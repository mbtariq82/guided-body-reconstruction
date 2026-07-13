import type { ScanMetric, ScanState } from "@/types/scan";

const guidanceByState: Record<ScanState, string[]> = {
  introduction: ["Prepare for a guided scan."],
  "camera-permission": ["Camera access is required for the live preview."],
  "position-user": [
    "Stand a little further back.",
    "Move slightly left.",
    "Keep your feet inside the frame.",
    "Great. Hold that position.",
  ],
  "front-view": ["Hold still.", "Lighting looks good.", "Perfect front view."],
  "rotate-left": ["Turn slowly.", "Keep your arms relaxed.", "Smooth pace."],
  "side-view": ["Pause here.", "Body fully visible.", "Great side profile."],
  "rotate-to-back": ["Keep turning slowly.", "Hold your arm spacing.", "Smooth rear sweep."],
  "back-view": ["Hold still.", "Keep your shoulders level.", "Back view captured."],
  "rotate-right": ["Turn slowly.", "Keep your full body visible.", "Approaching right side."],
  "right-side-view": ["Pause here.", "Body fully visible.", "Great right profile."],
  "return-front": ["Keep turning slowly.", "Closing the rotation.", "Perfect. Face the camera."],
  "motion-range": ["Raise both arms slowly.", "Hold shoulder height briefly.", "Lower both arms slowly."],
  "identity-detail": ["Step closer.", "Show both open hands.", "Keep your face sharp and still."],
  finish: ["Scan complete."],
};

const metricsByState: Record<ScanState, ScanMetric[]> = {
  introduction: [],
  "camera-permission": [],
  "position-user": [
    { label: "Lighting", value: "Good", tone: "good" },
    { label: "Distance", value: "Too Close", tone: "warning" },
    { label: "Face", value: "Detected", tone: "good" },
    { label: "Body", value: "Partially Visible", tone: "warning" },
  ],
  "front-view": [
    { label: "Lighting", value: "Good", tone: "good" },
    { label: "Distance", value: "Ideal", tone: "good" },
    { label: "Face", value: "Detected", tone: "good" },
    { label: "Body", value: "Fully Visible", tone: "good" },
  ],
  "rotate-left": [
    { label: "Lighting", value: "Good", tone: "good" },
    { label: "Distance", value: "Ideal", tone: "good" },
    { label: "Rotation", value: "Steady", tone: "good" },
    { label: "Body", value: "Fully Visible", tone: "good" },
  ],
  "side-view": [
    { label: "Lighting", value: "Good", tone: "good" },
    { label: "Distance", value: "Ideal", tone: "good" },
    { label: "Pose", value: "Side View", tone: "good" },
    { label: "Body", value: "Fully Visible", tone: "good" },
  ],
  "rotate-to-back": [
    { label: "Lighting", value: "Good", tone: "good" },
    { label: "Distance", value: "Ideal", tone: "good" },
    { label: "Rotation", value: "Steady", tone: "good" },
    { label: "Body", value: "Fully Visible", tone: "good" },
  ],
  "back-view": [
    { label: "Lighting", value: "Good", tone: "good" },
    { label: "Distance", value: "Ideal", tone: "good" },
    { label: "Pose", value: "Back View", tone: "good" },
    { label: "Body", value: "Fully Visible", tone: "good" },
  ],
  "rotate-right": [
    { label: "Lighting", value: "Good", tone: "good" },
    { label: "Distance", value: "Ideal", tone: "good" },
    { label: "Rotation", value: "Steady", tone: "good" },
    { label: "Body", value: "Fully Visible", tone: "good" },
  ],
  "right-side-view": [
    { label: "Lighting", value: "Good", tone: "good" },
    { label: "Distance", value: "Ideal", tone: "good" },
    { label: "Pose", value: "Side View", tone: "good" },
    { label: "Body", value: "Fully Visible", tone: "good" },
  ],
  "return-front": [
    { label: "Lighting", value: "Good", tone: "good" },
    { label: "Distance", value: "Ideal", tone: "good" },
    { label: "Rotation", value: "Steady", tone: "good" },
    { label: "Body", value: "Fully Visible", tone: "good" },
  ],
  "motion-range": [
    { label: "Lighting", value: "Good", tone: "good" },
    { label: "Distance", value: "Ideal", tone: "good" },
    { label: "Motion", value: "Controlled", tone: "good" },
    { label: "Body", value: "Fully Visible", tone: "good" },
  ],
  "identity-detail": [
    { label: "Lighting", value: "Good", tone: "good" },
    { label: "Sharpness", value: "Clear", tone: "good" },
    { label: "Detail", value: "Face + Hands", tone: "good" },
    { label: "Distance", value: "Detail Range", tone: "good" },
  ],
  finish: [],
};

export function getGuidanceForState(state: ScanState): string[] {
  return guidanceByState[state];
}

export function getMockMetricsForState(state: ScanState): ScanMetric[] {
  return metricsByState[state];
}
