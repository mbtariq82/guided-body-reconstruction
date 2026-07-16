import type {
  CapturedFrameReconstruction,
  CapturePhaseReconstructionTarget,
  CaptureReconstructionProfile,
  ScanState,
} from "@/types/scan";

export const reconstructionCaptureProfile = {
  captureMode: "guided-human-reconstruction",
  notes: [
    "Capture is tuned for one shared SMPL-X identity fitted across deliberate poses, not independent single-frame meshes.",
    "A fixed 1x camera at pelvis height and a neutral full-body turn provide angle-balanced silhouettes without changing perspective between views.",
    "T-pose, overhead reach, and wide stance reveal armpits and inner legs while constraining limb lengths and articulation.",
    "Continuous video and every quality-approved frame are retained for temporal pose tracking and robust multi-view shape fitting.",
    "Face and hand detail are captured separately because a full-body frame cannot resolve SMPL-X facial and finger landmarks well.",
    "The local mesh remains a fallback; production avatar generation should consume this profile and return GLB/glTF or SMPL-family parameters.",
  ],
  phaseTargets: {
    "front-view": {
      angleDeg: 0,
      angleEndDeg: 0,
      angleLabel: "front",
      angleStartDeg: 0,
      captureRole: "geometry",
      guidance: "Neutral front view with arms slightly away from the torso.",
      minimumFrameCount: 6,
      poseTarget: "neutral-a",
      requiredSignals: ["full-body silhouette", "face identity", "shoulders", "hips", "feet"],
      state: "front-view",
      targetFrameCount: 8,
    },
    "rotate-left": {
      angleDeg: null,
      angleEndDeg: 90,
      angleLabel: "front-to-left sweep",
      angleStartDeg: 0,
      captureRole: "geometry",
      guidance: "Slow continuous turn so quarter angles are visible.",
      minimumFrameCount: 8,
      poseTarget: "rotation",
      requiredSignals: ["quarter-view silhouettes", "torso depth", "arm separation", "texture continuity"],
      state: "rotate-left",
      targetFrameCount: 10,
    },
    "side-view": {
      angleDeg: 90,
      angleEndDeg: 90,
      angleLabel: "left profile",
      angleStartDeg: 90,
      captureRole: "geometry",
      guidance: "True side profile with head, chest, waist, hips, knees, and feet visible.",
      minimumFrameCount: 5,
      poseTarget: "side-neutral",
      requiredSignals: ["side silhouette", "torso depth", "seat depth", "posture line", "feet"],
      state: "side-view",
      targetFrameCount: 6,
    },
    "rotate-to-back": {
      angleDeg: null,
      angleEndDeg: 180,
      angleLabel: "left-to-back sweep",
      angleStartDeg: 90,
      captureRole: "geometry",
      guidance: "Slow continuous turn through the left rear-quarter angles.",
      minimumFrameCount: 8,
      poseTarget: "rotation",
      requiredSignals: ["rear-quarter silhouettes", "back depth", "arm separation", "texture continuity"],
      state: "rotate-to-back",
      targetFrameCount: 10,
    },
    "back-view": {
      angleDeg: 180,
      angleEndDeg: 180,
      angleLabel: "back",
      angleStartDeg: 180,
      captureRole: "geometry",
      guidance: "Back view for shoulder width, spine posture, hips, and texture completion.",
      minimumFrameCount: 5,
      poseTarget: "neutral-a",
      requiredSignals: ["back silhouette", "shoulders", "hips", "leg separation", "hair outline"],
      state: "back-view",
      targetFrameCount: 6,
    },
    "rotate-right": {
      angleDeg: null,
      angleEndDeg: 270,
      angleLabel: "back-to-right sweep",
      angleStartDeg: 180,
      captureRole: "geometry",
      guidance: "Slow turn through the right rear-quarter angles.",
      minimumFrameCount: 8,
      poseTarget: "rotation",
      requiredSignals: ["rear-quarter silhouettes", "opposite side contours", "texture continuity"],
      state: "rotate-right",
      targetFrameCount: 10,
    },
    "right-side-view": {
      angleDeg: 270,
      angleEndDeg: 270,
      angleLabel: "right profile",
      angleStartDeg: 270,
      captureRole: "geometry",
      guidance: "True right-side profile with the whole body visible.",
      minimumFrameCount: 5,
      poseTarget: "side-neutral",
      requiredSignals: ["opposite side silhouette", "torso depth", "posture line", "feet"],
      state: "right-side-view",
      targetFrameCount: 6,
    },
    "return-front": {
      angleDeg: null,
      angleEndDeg: 360,
      angleLabel: "right-to-front sweep",
      angleStartDeg: 270,
      captureRole: "geometry",
      guidance: "Slow turn through right-front quarter angles to close the loop.",
      minimumFrameCount: 8,
      poseTarget: "rotation",
      requiredSignals: ["quarter-view silhouettes", "texture loop closure", "arm separation"],
      state: "return-front",
      targetFrameCount: 10,
    },
    "arm-span": {
      angleDeg: 0,
      angleEndDeg: 0,
      angleLabel: "front T-pose",
      angleStartDeg: 0,
      captureRole: "motion",
      guidance: "Hold both arms straight at shoulder height with open hands.",
      minimumFrameCount: 7,
      poseTarget: "t-pose",
      requiredSignals: ["shoulder joints", "elbows", "wrists", "arm span", "exposed armpits"],
      state: "arm-span",
      targetFrameCount: 10,
    },
    "overhead-reach": {
      angleDeg: 0,
      angleEndDeg: 0,
      angleLabel: "front Y-pose",
      angleStartDeg: 0,
      captureRole: "motion",
      guidance: "Reach both arms overhead in a wide Y while keeping the full body visible.",
      minimumFrameCount: 7,
      poseTarget: "y-pose",
      requiredSignals: ["shoulder articulation", "upper arms", "wrists", "armpit surface", "torso sides"],
      state: "overhead-reach",
      targetFrameCount: 10,
    },
    "wide-stance": {
      angleDeg: 0,
      angleEndDeg: 0,
      angleLabel: "front wide stance",
      angleStartDeg: 0,
      captureRole: "motion",
      guidance: "Step both feet wider than your hips and hold your legs straight.",
      minimumFrameCount: 7,
      poseTarget: "wide-stance",
      requiredSignals: ["hip joints", "knees", "ankles", "inner legs", "leg separation"],
      state: "wide-stance",
      targetFrameCount: 10,
    },
    "motion-range": {
      angleDeg: 0,
      angleEndDeg: 0,
      angleLabel: "front articulated motion",
      angleStartDeg: 0,
      captureRole: "motion",
      guidance: "Controlled shoulder abduction while the full body remains visible.",
      minimumFrameCount: 8,
      poseTarget: "controlled-motion",
      requiredSignals: ["joint trajectories", "arm separation", "neutral-to-A-pose motion", "full-body visibility"],
      state: "motion-range",
      targetFrameCount: 10,
    },
    "identity-detail": {
      angleDeg: 0,
      angleEndDeg: 0,
      angleLabel: "front identity detail",
      angleStartDeg: 0,
      captureRole: "identity",
      guidance: "Sharp face view with small left and right head turns.",
      minimumFrameCount: 6,
      poseTarget: "face-detail",
      requiredSignals: ["face identity", "hair outline", "head turn", "upper-body texture"],
      state: "identity-detail",
      targetFrameCount: 8,
    },
    "hand-detail": {
      angleDeg: 0,
      angleEndDeg: 0,
      angleLabel: "front hand detail",
      angleStartDeg: 0,
      captureRole: "identity",
      guidance: "Hold both open palms near the camera with fingers spread.",
      minimumFrameCount: 6,
      poseTarget: "hand-detail",
      requiredSignals: ["left palm", "right palm", "separated fingers", "hand texture", "wrist orientation"],
      state: "hand-detail",
      targetFrameCount: 8,
    },
  },
  preferredCamera: {
    facingMode: "environment",
    frameRate: 30,
    height: 1080,
    width: 1920,
  },
  profileId: "guided-body-reconstruction.v1",
  profileVersion: "2026-07-15",
  providerCandidates: [
    {
      id: "self-hosted-smpl-x",
      input: "continuous video, calibrated height, masks, landmarks, and angle-balanced full-body views",
      integrationStatus: "recommended",
      name: "Self-hosted SMPL-X",
      output: "metric SMPL-X parameters and an animatable human mesh",
      role: "research-reconstruction",
    },
    {
      id: "econ",
      input: "RGB views, an aligned SMPL-X body, silhouettes, normals, and 2D landmarks",
      integrationStatus: "research",
      name: "ECON surface refinement",
      output: "detailed clothed human surface aligned to SMPL-X",
      role: "research-reconstruction",
    },
    {
      id: "lhm-plus-plus",
      input: "eight angle-balanced references, identity detail, and calibrated temporal frames",
      integrationStatus: "research",
      name: "LHM++ identity reconstruction",
      output: "high-detail animatable avatar or Gaussian representation",
      role: "research-reconstruction",
    },
    {
      id: "multi-view-smpl-x",
      input: "shared-shape optimisation across every quality-approved video frame",
      integrationStatus: "research",
      name: "Multi-view temporal SMPL-X fitter",
      output: "one identity shape with per-frame pose and camera parameters",
      role: "research-reconstruction",
    },
  ],
  requiredSignals: [
    "high-resolution full-body RGB frames",
    "continuous fixed-zoom full-body rotation video",
    "eight uniformly distributed front, side, back, and quarter-turn references",
    "T-pose, overhead reach, and separated-leg articulation references",
    "separate high-resolution face and hand references",
    "person mask or human parsing mask",
    "2D pose landmarks plus preferred 3D world landmarks",
    "height scale anchor and camera metadata",
  ],
  schemaVersion: "reconstruction-capture-profile.v1",
} satisfies CaptureReconstructionProfile;

export const reconstructionScanStates = Object.keys(
  reconstructionCaptureProfile.phaseTargets,
) as ScanState[];

export function getPhaseReconstructionTarget(
  state: ScanState,
): CapturePhaseReconstructionTarget | null {
  const phaseTargets: Partial<Record<ScanState, CapturePhaseReconstructionTarget>> =
    reconstructionCaptureProfile.phaseTargets;

  return phaseTargets[state] ?? null;
}

export function getMinimumReconstructionFramesForPhase(state: ScanState): number {
  return getPhaseReconstructionTarget(state)?.minimumFrameCount ?? 0;
}

export function getTargetReconstructionFramesForPhase(state: ScanState): number {
  return getPhaseReconstructionTarget(state)?.targetFrameCount ?? 0;
}

export function getTotalMinimumReconstructionFrameCount(): number {
  return reconstructionScanStates.reduce(
    (total, state) => total + getMinimumReconstructionFramesForPhase(state),
    0,
  );
}

export function getTotalTargetReconstructionFrameCount(): number {
  return reconstructionScanStates.reduce(
    (total, state) => total + getTargetReconstructionFramesForPhase(state),
    0,
  );
}

export function getCapturedFrameReconstruction(
  state: ScanState,
  phaseFrameNumber: number,
  phaseProgress = 50,
): CapturedFrameReconstruction | null {
  const target = getPhaseReconstructionTarget(state);

  if (!target) {
    return null;
  }

  return {
    angleDeg: target.angleDeg,
    angleLabel: target.angleLabel,
    captureRole: target.captureRole,
    minimumFrameCount: target.minimumFrameCount,
    phaseFrameNumber,
    poseTarget: target.poseTarget,
    requiredSignals: target.requiredSignals,
    targetFrameCount: target.targetFrameCount,
    yawDeg: getTargetYawDeg(target, phaseProgress),
  };
}

function getTargetYawDeg(
  target: CapturePhaseReconstructionTarget,
  phaseProgress: number,
): number | null {
  if (target.angleDeg !== null) {
    return target.angleDeg;
  }

  if (target.angleStartDeg === null || target.angleEndDeg === null) {
    return null;
  }

  const progress = Math.max(0, Math.min(100, phaseProgress)) / 100;
  return Number(
    (target.angleStartDeg + (target.angleEndDeg - target.angleStartDeg) * progress).toFixed(2),
  );
}
