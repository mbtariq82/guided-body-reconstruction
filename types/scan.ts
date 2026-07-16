export type ScanState =
  | "introduction"
  | "camera-permission"
  | "position-user"
  | "front-view"
  | "rotate-left"
  | "side-view"
  | "rotate-to-back"
  | "back-view"
  | "rotate-right"
  | "right-side-view"
  | "return-front"
  | "arm-span"
  | "overhead-reach"
  | "wide-stance"
  | "motion-range"
  | "identity-detail"
  | "hand-detail"
  | "finish";

export type CapturePoseTarget =
  | "neutral-a"
  | "rotation"
  | "side-neutral"
  | "t-pose"
  | "y-pose"
  | "wide-stance"
  | "controlled-motion"
  | "face-detail"
  | "hand-detail";

export type CameraPermissionStatus =
  | "idle"
  | "requesting"
  | "granted"
  | "denied"
  | "unavailable"
  | "unsupported"
  | "error";

export type MetricTone = "good" | "warning" | "neutral";

export type ScanMetric = {
  label: string;
  value: string;
  tone: MetricTone;
};

export type ScanStepDefinition = {
  id: ScanState;
  label: string;
  shortLabel: string;
  title: string;
  instruction: string;
  detail: string;
  durationMs: number;
  autoAdvance: boolean;
  capturesData: boolean;
};

export type CaptureSource = "live-camera" | "mock-camera";

export type CapturePhaseReconstructionTarget = {
  angleDeg: number | null;
  angleEndDeg: number | null;
  angleLabel: string;
  angleStartDeg: number | null;
  captureRole: "geometry" | "motion" | "identity";
  guidance: string;
  minimumFrameCount: number;
  poseTarget: CapturePoseTarget;
  requiredSignals: string[];
  state: ScanState;
  targetFrameCount: number;
};

export type AvatarProviderCandidate = {
  id:
    | "self-hosted-smpl-x"
    | "econ"
    | "lhm-plus-plus"
    | "multi-view-smpl-x";
  input: string;
  integrationStatus: "recommended" | "candidate" | "research" | "not-recommended";
  name: string;
  output: string;
  role: "likeness-avatar" | "body-measurements" | "fit-avatar" | "research-reconstruction";
};

export type CaptureReconstructionProfile = {
  captureMode: "guided-human-reconstruction";
  notes: string[];
  phaseTargets: Partial<Record<ScanState, CapturePhaseReconstructionTarget>>;
  preferredCamera: {
    facingMode: "environment";
    frameRate: number;
    height: number;
    width: number;
  };
  profileId: "guided-body-reconstruction.v1";
  profileVersion: string;
  providerCandidates: AvatarProviderCandidate[];
  requiredSignals: string[];
  schemaVersion: "reconstruction-capture-profile.v1";
};

export type CapturedFrameReconstruction = {
  angleDeg: number | null;
  angleLabel: string;
  captureRole: "geometry" | "motion" | "identity";
  minimumFrameCount: number;
  phaseFrameNumber: number;
  poseTarget: CapturePoseTarget;
  requiredSignals: string[];
  targetFrameCount: number;
  yawDeg: number | null;
};

export type CapturedBodyBounds = {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
};

export type CapturedPoseKeypoint = {
  name: string;
  score: number | null;
  x: number;
  y: number;
  z?: number | null;
};

export type CapturedPoseWorldKeypoint = {
  name: string;
  score: number | null;
  x: number;
  y: number;
  z: number;
};

export type CapturedSegmentationRowKey =
  | "neck"
  | "shoulder"
  | "chest"
  | "waist"
  | "hips"
  | "thigh";

export type CapturedSegmentationRowWidths = Partial<
  Record<CapturedSegmentationRowKey, number | null>
>;

export type CapturedSegmentationMask = {
  counts: number[];
  encoding: "rle";
  foregroundValue: 1;
  height: number;
  threshold: number;
  width: number;
};

export type CapturedPersonSegmentation = {
  backend: "mediapipe";
  bodyBounds: CapturedBodyBounds | null;
  foregroundRatio: number;
  mask: CapturedSegmentationMask | null;
  provider: "tensorflow-body-segmentation-mediapipe-selfie";
  quality: "good" | "partial" | "poor";
  rowWidths: CapturedSegmentationRowWidths;
  status: "loading" | "ready" | "running" | "error" | "unsupported";
  updatedAt: number | null;
};

export type CapturedFrameVision = {
  backend: string | null;
  bodyBounds: CapturedBodyBounds | null;
  keypoints: CapturedPoseKeypoint[];
  provider:
    | "tensorflow-movenet"
    | "tensorflow-movenet+mediapipe-selfie-segmentation"
    | "mediapipe-blazepose"
    | "mediapipe-blazepose+mediapipe-selfie-segmentation";
  segmentation: CapturedPersonSegmentation | null;
  status: string;
  updatedAt: number | null;
  worldKeypoints?: CapturedPoseWorldKeypoint[];
};

export type CapturedFrame = {
  id: string;
  capturedAt: string;
  dataUrl: string;
  elapsedMs: number;
  fileName: string;
  height: number;
  instruction: string;
  metrics: ScanMetric[];
  mimeType: "image/jpeg";
  phaseProgress: number;
  reconstruction: CapturedFrameReconstruction | null;
  source: CaptureSource;
  state: ScanState;
  stateLabel: string;
  vision: CapturedFrameVision | null;
  width: number;
};

export type CaptureVideoStatus =
  | "idle"
  | "recording"
  | "finalizing"
  | "ready"
  | "unsupported"
  | "error"
  | "not-applicable";

export type CapturedScanVideoPhase = {
  elapsedMs: number;
  state: ScanState;
};

export type CapturedTemporalPoseFrame = {
  elapsedMs: number;
  height: number;
  keypoints: CapturedPoseKeypoint[];
  phaseProgress: number;
  state: ScanState;
  width: number;
  worldKeypoints: CapturedPoseWorldKeypoint[];
  yawDeg: number | null;
};

export type CapturedPoseTrack = {
  capturedAt: string;
  fileName: string;
  frameCount: number;
  frames: CapturedTemporalPoseFrame[];
  provider: "mediapipe-blazepose";
  sampleIntervalTargetMs: number;
  schemaVersion: "guided-pose-track.v1";
  sessionElapsedOffsetMs: number;
};

export type CapturedScanVideo = {
  blob: Blob;
  camera: {
    aspectRatio: number | null;
    facingMode: string | null;
    frameRate: number | null;
    height: number | null;
    width: number | null;
  };
  capturedAt: string;
  durationMs: number;
  fileName: string;
  id: string;
  mimeType: string;
  phaseTimeline: CapturedScanVideoPhase[];
  poseTrack: CapturedPoseTrack | null;
  sessionId: string;
  sizeBytes: number;
};

export type CaptureQualityStatus = "ready" | "review" | "missing";

export type CapturePhaseSummary = {
  frameCount: number;
  issues: string[];
  label: string;
  minimumFrameCount: number;
  shortLabel: string;
  state: ScanState;
  status: CaptureQualityStatus;
  statusLabel: string;
  targetFrameCount: number;
  thumbnailDataUrl: string | null;
};

export type CaptureSession = {
  cameraMode: "live" | "mock";
  completedAt: string | null;
  devicePixelRatio: number;
  frames: CapturedFrame[];
  id: string;
  reconstructionProfile: CaptureReconstructionProfile;
  schemaVersion: "body-scan-session.v1";
  startedAt: string;
  subject: {
    heightCm: number | null;
  };
  userAgent: string;
  videoStatus: CaptureVideoStatus;
  videos: CapturedScanVideo[];
  viewport: {
    height: number;
    width: number;
  };
};

export type CaptureSessionSummary = {
  cameraMode: "live" | "mock";
  capturedStates: ScanState[];
  completedAt: string | null;
  frameCount: number;
  id: string;
  isExportReady: boolean;
  lastFrameAt: string | null;
  phaseSummaries: CapturePhaseSummary[];
  reconstructionProfile: CaptureReconstructionProfile;
  reviewStatus: CaptureQualityStatus;
  startedAt: string;
  subject: {
    heightCm: number | null;
  };
  videoCount: number;
  videoDurationMs: number;
  videoStatus: CaptureVideoStatus;
};

export type CaptureUploadStatus =
  | "idle"
  | "uploading"
  | "uploaded"
  | "processing"
  | "error";

export type ScanProcessingJobStatus = "queued" | "processing" | "completed" | "failed";

export type ScanProcessingJobStage =
  | "awaiting-reconstruction"
  | "validation"
  | "body-reconstruction"
  | "measurement-extraction"
  | "completed"
  | "failed";

export type ScanValidationCheckStatus = "passed" | "failed";

export type ScanValidationReportStatus = "passed" | "failed";

export type ScanValidationReport = {
  blockingIssues: string[];
  checks: Array<{
    detail: string;
    id: string;
    label: string;
    status: ScanValidationCheckStatus;
  }>;
  generatedAt: string;
  jobId: string;
  schemaVersion: "scan-validation-report.v1";
  sessionId: string;
  status: ScanValidationReportStatus;
  summary: {
    archiveSize: number;
    cameraMode: "live" | "mock" | "unknown";
    frameCount: number;
    manifestSchemaVersion: string;
    phaseFrameCounts: Record<string, number>;
  };
};

export type BodyMeasurementKey =
  | "height"
  | "neck"
  | "shoulderWidth"
  | "chest"
  | "waist"
  | "hips"
  | "thigh"
  | "inseam"
  | "sleeveLength";

export type BodyMeasurementConfidence = "high" | "medium" | "low";

export type BodyMeasurement = {
  confidence: BodyMeasurementConfidence;
  key: BodyMeasurementKey;
  label: string;
  method: string;
  notes: string[];
  sourceFrames: string[];
  unit: "cm";
  valueCm: number;
};

export type BodyMeasurementReport = {
  assumptions: string[];
  generatedAt: string;
  measurements: BodyMeasurement[];
  provider: {
    id:
      | "local-open-source-estimator"
      | "bodygram"
      | "3dlook"
      | "meshcapade"
      | "custom";
    mode: "local" | "hosted";
    name: string;
    version: string;
  };
  schemaVersion: "body-measurements.v1";
  sessionId: string;
  sourceJobId: string;
  status: "estimated" | "insufficient-data";
  subject: {
    heightCm: number | null;
  };
  warnings: string[];
};

export type BodyAvatarReconstructionReport = {
  captureReadiness: {
    acceptedFrameCount: number;
    minimumAcceptedFrameCount: number;
    phaseFrameCounts: Record<string, number>;
    status: "ready" | "needs-more-coverage";
    targetAcceptedFrameCount: number;
  };
  nextProviderAction: string;
  recommendedProviders: AvatarProviderCandidate[];
  selectedInputs: {
    backFrameFile: string | null;
    frontFrameFile: string | null;
    sideFrameFile: string | null;
  };
  status: "provider-ready" | "needs-better-capture";
  warnings: string[];
};

export type AvatarModelAssetType =
  | "glb"
  | "gltf"
  | "obj"
  | "ply"
  | "gaussian-splat"
  | "smplx-params"
  | "temporal-fit"
  | "preview-image"
  | "diagnostics";

export type AvatarModelAsset = {
  createdAt: string;
  file: string;
  id: string;
  label: string;
  provider: {
    id: "self-hosted-smplx-econ-lhm";
    mode: "local";
    name: string;
  };
  sizeBytes: number;
  status: "ready";
  type: AvatarModelAssetType;
  url: string;
};

export type SelfHostedAvatarReconstructionStatus =
  | "not-started"
  | "blocked"
  | "running"
  | "succeeded"
  | "failed";

export type SelfHostedAvatarReconstructionStage =
  | "awaiting-session-processing"
  | "input-prepared"
  | "awaiting-model-runtime"
  | "running-worker"
  | "asset-ingestion"
  | "completed"
  | "failed";

export type SelfHostedAvatarReconstructionJob = {
  assets: AvatarModelAsset[];
  attempts: number;
  commandConfigured: boolean;
  createdAt: string;
  errorMessage?: string;
  id: string;
  input: {
    inputDirectory: string;
    localAvatarReportFile: string | null;
    measurementReportFile: string | null;
    requestFile: string;
    referenceViewCount: number;
    selectedFrames: {
      back: string | null;
      front: string | null;
      identity: string | null;
      side: string | null;
    };
    videoFile: string | null;
  };
  logs: {
    stderr: string[];
    stdout: string[];
  };
  notes: string[];
  output: {
    assetManifestFile: string;
    outputDirectory: string;
  };
  provider: {
    id: "self-hosted-smplx-econ-lhm";
    mode: "local";
    name: string;
  };
  schemaVersion: "self-hosted-avatar-reconstruction-job.v1";
  sessionId: string;
  stage: SelfHostedAvatarReconstructionStage;
  status: SelfHostedAvatarReconstructionStatus;
  updatedAt: string;
  warnings: string[];
};

export type AvatarReconstructionStatusResponse = {
  assets: AvatarModelAsset[];
  configured: boolean;
  job: SelfHostedAvatarReconstructionJob | null;
  setup: {
    activeCommand: string | null;
    bundledWorkerFile: string | null;
    commandEnvVar: "SELF_HOSTED_AVATAR_COMMAND";
    commandSource: "env" | "bundled" | "missing";
    defaultCommand: string | null;
    expectedCommandContract: string;
    modelRoots: {
      econ: string | null;
      lhm: string | null;
      lhmPlusPlus: string | null;
      smplx: string | null;
    };
  };
};

export type BodyAvatarMeshReport = {
  aiReconstruction: BodyAvatarReconstructionReport;
  generatedAt: string;
  landmarks: Record<string, [number, number, number]>;
  measurements: Partial<Record<BodyMeasurementKey, number>>;
  mesh: {
    faces: Array<[number, number, number]>;
    vertexCount: number;
    vertices: Array<[number, number, number]>;
  };
  provider: {
    id: "local-parametric-avatar" | "smpl" | "custom";
    mode: "local" | "hosted";
    name: string;
    version: string;
  };
  schemaVersion: "body-avatar.v1";
  sessionId: string;
  sourceJobId: string;
  sourceMeasurementReport: "body-measurements.v1";
  units: "cm";
  warnings: string[];
};

export type ScanProcessingJob = {
  attempts: number;
  createdAt: string;
  errorMessage?: string;
  id: string;
  input: {
    archiveFile: string;
    manifestFile: string;
  };
  notes: string[];
  output: null | {
    measurementsFile?: string;
    reconstructionFile?: string;
    validationReportFile?: string;
  };
  sessionId: string;
  stage: ScanProcessingJobStage;
  status: ScanProcessingJobStatus;
  updatedAt: string;
};

export type ScanProcessingJobStatusResponse = {
  avatarMesh: BodyAvatarMeshReport | null;
  measurementReport: BodyMeasurementReport | null;
  processingJob: ScanProcessingJob;
  validationReport: ScanValidationReport | null;
};

export type ScanProcessSessionResponse = ScanProcessingJobStatusResponse & {
  processed: boolean;
};

export type ScanSessionListItem = {
  archive: {
    file: string | null;
    name: string | null;
    size: number;
  };
  cameraMode: "live" | "mock" | "unknown";
  frameCount: number;
  measurementReport: BodyMeasurementReport | null;
  processingJob: ScanProcessingJob | null;
  reviewStatus: CaptureQualityStatus | "unknown";
  sessionId: string;
  storedAt: string | null;
  validationReport: ScanValidationReport | null;
};

export type ScanSessionListResponse = {
  sessions: ScanSessionListItem[];
};

export type ScanSessionDetailFrame = {
  capturedAt: string;
  dataUrl: string | null;
  fileName: string;
  height: number;
  id: string;
  metrics: ScanMetric[];
  phaseProgress: number;
  source: CaptureSource;
  state: ScanState;
  stateLabel: string;
  vision: CapturedFrameVision | null;
  width: number;
};

export type ScanSessionDetail = {
  avatarMesh: BodyAvatarMeshReport | null;
  frames: ScanSessionDetailFrame[];
  manifest: {
    reviewStatus: CaptureQualityStatus | "unknown";
    schemaVersion: string;
  } | null;
  measurementReport: BodyMeasurementReport | null;
  session: ScanSessionListItem;
};

export type CaptureUploadState = {
  job: ScanProcessingJob | null;
  measurementReport: BodyMeasurementReport | null;
  message: string;
  sessionId: string | null;
  status: CaptureUploadStatus;
  uploadedAt: string | null;
  validationReport: ScanValidationReport | null;
};
