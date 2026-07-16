import type { ScanState, ScanStepDefinition } from "@/types/scan";

export const SCAN_SEQUENCE: ScanState[] = [
  "introduction",
  "camera-permission",
  "position-user",
  "front-view",
  "rotate-left",
  "side-view",
  "rotate-to-back",
  "back-view",
  "rotate-right",
  "right-side-view",
  "return-front",
  "arm-span",
  "overhead-reach",
  "wide-stance",
  "motion-range",
  "identity-detail",
  "hand-detail",
  "finish",
];

export const SCANNER_PREVIEW_STATES: ScanState[] = [
  "position-user",
  "front-view",
  "rotate-left",
  "side-view",
  "rotate-to-back",
  "back-view",
  "rotate-right",
  "right-side-view",
  "return-front",
  "arm-span",
  "overhead-reach",
  "wide-stance",
  "motion-range",
  "identity-detail",
  "hand-detail",
];

export const SCAN_STEPS: Record<ScanState, ScanStepDefinition> = {
  introduction: {
    id: "introduction",
    label: "Introduction",
    shortLabel: "Intro",
    title: "Set up a clean scan",
    instruction: "A guided capture session builds the evidence for your digital human model.",
    detail: "We will check your camera, help position your body, then guide you through a slow rotation.",
    durationMs: 0,
    autoAdvance: false,
    capturesData: false,
  },
  "camera-permission": {
    id: "camera-permission",
    label: "Camera Permission",
    shortLabel: "Camera",
    title: "Enable camera access",
    instruction: "Your scan starts with a live camera preview.",
    detail: "The scanner requests a high-resolution stream, then saves only quality-approved frames.",
    durationMs: 0,
    autoAdvance: false,
    capturesData: false,
  },
  "position-user": {
    id: "position-user",
    label: "Position User",
    shortLabel: "Position",
    title: "Stand inside the guide",
    instruction: "Place your full body inside the outline.",
    detail: "Keep your feet visible and leave space above your head.",
    durationMs: 0,
    autoAdvance: false,
    capturesData: false,
  },
  "front-view": {
    id: "front-view",
    label: "Front View",
    shortLabel: "Front",
    title: "Hold front view",
    instruction: "Face forward with arms slightly away.",
    detail: "Neutral A-pose anchors body shape, scale, shoulders, torso outline, hips, and feet.",
    durationMs: 5200,
    autoAdvance: true,
    capturesData: true,
  },
  "rotate-left": {
    id: "rotate-left",
    label: "Rotate Left",
    shortLabel: "Turn L",
    title: "Turn slowly left",
    instruction: "Turn left slowly through quarter angles.",
    detail: "Move at a steady pace so front-left and rear-quarter views stay sharp and evenly spaced.",
    durationMs: 6200,
    autoAdvance: true,
    capturesData: true,
  },
  "side-view": {
    id: "side-view",
    label: "Side View",
    shortLabel: "Side",
    title: "Hold side view",
    instruction: "Hold a true side profile.",
    detail: "Capturing chest, waist, seat depth, posture line, knees, and feet.",
    durationMs: 4200,
    autoAdvance: true,
    capturesData: true,
  },
  "rotate-to-back": {
    id: "rotate-to-back",
    label: "Left Rear Sweep",
    shortLabel: "Rear L",
    title: "Continue slowly to the back",
    instruction: "Turn slowly from your left side to face away.",
    detail: "Capturing the left rear-quarter silhouette and clothing continuity missing from the previous scan.",
    durationMs: 6200,
    autoAdvance: true,
    capturesData: true,
  },
  "back-view": {
    id: "back-view",
    label: "Back View",
    shortLabel: "Back",
    title: "Hold back view",
    instruction: "Face away and hold still.",
    detail: "Capturing back silhouette, shoulder slope, hip width, leg separation, and rear texture.",
    durationMs: 4200,
    autoAdvance: true,
    capturesData: true,
  },
  "rotate-right": {
    id: "rotate-right",
    label: "Rotate Right",
    shortLabel: "Turn R",
    title: "Turn slowly to your right side",
    instruction: "Turn right slowly until your right side faces the camera.",
    detail: "Capturing the right rear-quarter silhouette and opposite-side clothing texture.",
    durationMs: 6200,
    autoAdvance: true,
    capturesData: true,
  },
  "right-side-view": {
    id: "right-side-view",
    label: "Right Side View",
    shortLabel: "Side R",
    title: "Hold right side view",
    instruction: "Hold a true right-side profile.",
    detail: "A second side silhouette reduces depth ambiguity and catches left-right asymmetry.",
    durationMs: 4200,
    autoAdvance: true,
    capturesData: true,
  },
  "return-front": {
    id: "return-front",
    label: "Return To Front",
    shortLabel: "Close",
    title: "Complete the rotation",
    instruction: "Turn slowly back to the camera.",
    detail: "Closing the 360-degree loop with the final right-front quarter views.",
    durationMs: 6200,
    autoAdvance: true,
    capturesData: true,
  },
  "arm-span": {
    id: "arm-span",
    label: "Arm Span",
    shortLabel: "T Pose",
    title: "Hold a straight T-pose",
    instruction: "Raise both arms straight out at shoulder height.",
    detail: "This exposes the armpits and constrains shoulder position, arm length, elbows, and wrists.",
    durationMs: 5200,
    autoAdvance: true,
    capturesData: true,
  },
  "overhead-reach": {
    id: "overhead-reach",
    label: "Overhead Reach",
    shortLabel: "Y Pose",
    title: "Reach overhead in a Y",
    instruction: "Reach both arms up and apart, then hold still.",
    detail: "The overhead view reveals torso sides and shoulder surfaces hidden in the neutral turn.",
    durationMs: 5200,
    autoAdvance: true,
    capturesData: true,
  },
  "wide-stance": {
    id: "wide-stance",
    label: "Wide Stance",
    shortLabel: "Legs",
    title: "Separate your legs",
    instruction: "Step both feet wider than your hips and hold.",
    detail: "A separated stance reveals the inner legs and improves hip, knee, ankle, and leg-length constraints.",
    durationMs: 5200,
    autoAdvance: true,
    capturesData: true,
  },
  "motion-range": {
    id: "motion-range",
    label: "Motion Range",
    shortLabel: "Motion",
    title: "Raise and lower your arms",
    instruction: "Face forward and slowly raise both arms to shoulder height, then lower them.",
    detail: "This controlled motion is stored separately for joint tracking and rig validation, not body scale.",
    durationMs: 6800,
    autoAdvance: true,
    capturesData: true,
  },
  "identity-detail": {
    id: "identity-detail",
    label: "Identity Detail",
    shortLabel: "Detail",
    title: "Capture face detail",
    instruction: "Step closer, face forward, then turn your head slightly left and right.",
    detail: "A close face pass preserves identity, hairline, ears, and profile cues unavailable in full-body frames.",
    durationMs: 6800,
    autoAdvance: true,
    capturesData: true,
  },
  "hand-detail": {
    id: "hand-detail",
    label: "Hand Detail",
    shortLabel: "Hands",
    title: "Capture both hands",
    instruction: "Hold both palms toward the camera with fingers spread.",
    detail: "Keep both hands sharp and separated; the video is retained for future finger-landmark fitting.",
    durationMs: 6200,
    autoAdvance: true,
    capturesData: true,
  },
  finish: {
    id: "finish",
    label: "Finish",
    shortLabel: "Done",
    title: "Scan complete",
    instruction: "Your guided capture set is ready for processing.",
    detail: "The session can now be validated, measured, and reconstructed with SMPL-X.",
    durationMs: 0,
    autoAdvance: false,
    capturesData: false,
  },
};

export function getNextScanState(state: ScanState): ScanState {
  const index = SCAN_SEQUENCE.indexOf(state);
  return SCAN_SEQUENCE[Math.min(index + 1, SCAN_SEQUENCE.length - 1)];
}

export function getPreviousScanState(state: ScanState): ScanState {
  const index = SCAN_SEQUENCE.indexOf(state);
  return SCAN_SEQUENCE[Math.max(index - 1, 0)];
}

export function getScanProgress(state: ScanState): number {
  const index = SCAN_SEQUENCE.indexOf(state);
  return Math.round((index / (SCAN_SEQUENCE.length - 1)) * 100);
}

export function isScannerPreviewState(state: ScanState): boolean {
  return SCANNER_PREVIEW_STATES.includes(state);
}

export function getCapturedStepCount(state: ScanState): number {
  const currentIndex = SCAN_SEQUENCE.indexOf(state);
  return SCAN_SEQUENCE.slice(0, currentIndex + 1).filter(
    (step) => SCAN_STEPS[step].capturesData,
  ).length;
}
