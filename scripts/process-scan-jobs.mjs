import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import jpeg from "jpeg-js";

const uploadRoot = path.resolve(process.cwd(), ".scan-uploads");
const legacyRequiredCaptureStates = [
  "front-view",
  "rotate-left",
  "side-view",
  "back-view",
  "rotate-right",
];
const fallbackMinimumFramesByPhase = {
  "front-view": 6,
  "rotate-left": 8,
  "side-view": 5,
  "rotate-to-back": 8,
  "back-view": 5,
  "rotate-right": 8,
  "right-side-view": 5,
  "return-front": 8,
  "motion-range": 8,
  "identity-detail": 6,
};
const fallbackTargetFramesByPhase = {
  "front-view": 8,
  "rotate-left": 10,
  "side-view": 6,
  "rotate-to-back": 10,
  "back-view": 6,
  "rotate-right": 10,
  "right-side-view": 6,
  "return-front": 10,
  "motion-range": 10,
  "identity-detail": 8,
};
const maximumFrameCount = 500;
const maximumArchiveBytes = 150 * 1024 * 1024;
const measurementReportFileName = "body-measurements.json";
const bodyAvatarFileName = "body-avatar.json";
const legacyMeasurementsFileName = "measurements-placeholder.json";
const minimumHeightCm = 120;
const maximumHeightCm = 230;
const measurementRowWidthKeys = ["neck", "shoulder", "chest", "waist", "hips", "thigh"];
const measurementProviderVersion = "0.2.1";
const bodyAvatarProviderVersion = "0.6.0";

async function main() {
  const results = await processQueuedScanSessions();

  console.log(
    JSON.stringify(
      {
        processed: results,
        processedCount: results.length,
      },
      null,
      2,
    ),
  );
}

export async function processQueuedScanSessions() {
  const sessionDirectories = await readSessionDirectories();
  const results = [];

  for (const sessionDirectory of sessionDirectories) {
    const result = await processSessionDirectory(sessionDirectory);

    if (result) {
      results.push(result);
    }
  }

  return results;
}

export async function listScanSessions() {
  const sessionDirectories = await readSessionDirectories();
  const sessions = [];

  for (const sessionDirectory of sessionDirectories) {
    const session = await readScanSessionSummary(sessionDirectory);

    if (session) {
      sessions.push(session);
    }
  }

  return sessions.sort((left, right) => {
    const leftTime = Date.parse(left.storedAt ?? "");
    const rightTime = Date.parse(right.storedAt ?? "");

    return (Number.isFinite(rightTime) ? rightTime : 0) -
      (Number.isFinite(leftTime) ? leftTime : 0);
  });
}

export async function readScanSessionDetail(sessionId) {
  const sessionDirectory = path.join(uploadRoot, sanitizePathSegment(sessionId));
  const session = await readScanSessionSummary(sessionDirectory);

  if (!session) {
    throw new Error("Scan session not found.");
  }

  const measurementReport = await readCurrentMeasurementReport(sessionDirectory);
  const avatarMesh = await readBodyAvatarMeshReport(sessionDirectory, measurementReport);
  const archiveDetail = session.archive.file
    ? await readArchiveDetail(resolveUploadFile(session.archive.file))
    : null;

  return {
    avatarMesh,
    frames: archiveDetail?.frames ?? [],
    manifest: archiveDetail?.manifest
      ? {
          reviewStatus: archiveDetail.manifest.review?.status ?? "unknown",
          schemaVersion: archiveDetail.manifest.schemaVersion ?? "unknown",
        }
      : null,
    measurementReport,
    session,
    videos: archiveDetail?.videos ?? [],
  };
}

export async function processScanSession(sessionId) {
  const sessionDirectory = path.join(uploadRoot, sanitizePathSegment(sessionId));
  const beforeStatus = await readScanProcessingJobStatus(sessionId);
  const processed =
    beforeStatus.processingJob.status === "queued"
      ? Boolean(await processSessionDirectory(sessionDirectory))
      : false;
  const afterStatus = await readScanProcessingJobStatus(sessionId);

  return {
    ...afterStatus,
    processed,
  };
}

export async function readScanProcessingJobStatus(sessionId) {
  const sessionDirectory = path.join(uploadRoot, sanitizePathSegment(sessionId));
  const processingJob = await readJson(path.join(sessionDirectory, "processing-job.json"));

  if (!processingJob) {
    throw new Error("Processing job not found.");
  }

  const measurementReport = await readCurrentMeasurementReport(sessionDirectory);

  return {
    avatarMesh: await readBodyAvatarMeshReport(sessionDirectory, measurementReport),
    measurementReport,
    processingJob,
    validationReport: await readJson(path.join(sessionDirectory, "validation-report.json")),
  };
}

async function readArchiveDetail(archivePath) {
  const archiveBytes = await readFile(archivePath);
  const files = unzipSync(new Uint8Array(archiveBytes));
  const manifestBytes = files["manifest.json"];

  if (!manifestBytes) {
    return null;
  }

  const manifest = JSON.parse(strFromU8(manifestBytes));
  const frames = Array.isArray(manifest.frames)
    ? manifest.frames.map((frame) => {
        const frameBytes = files[`frames/${frame.fileName}`];

        return {
          capturedAt: frame.capturedAt ?? "",
          dataUrl: frameBytes
            ? `data:${frame.mimeType ?? "image/jpeg"};base64,${Buffer.from(frameBytes).toString("base64")}`
            : null,
          fileName: frame.fileName ?? "",
          height: frame.height ?? 0,
          id: frame.id ?? frame.fileName ?? "",
          metrics: Array.isArray(frame.metrics) ? frame.metrics : [],
          phaseProgress: frame.phaseProgress ?? 0,
          source: frame.source ?? "mock-camera",
          state: frame.state ?? "front-view",
          stateLabel: frame.stateLabel ?? frame.state ?? "Unknown",
          vision: frame.vision ?? null,
          width: frame.width ?? 0,
        };
      })
    : [];

  return {
    frames,
    manifest,
    videos: Array.isArray(manifest.videos) ? manifest.videos : [],
  };
}

async function readScanSessionSummary(sessionDirectory) {
  const uploadMetadata = await readJson(path.join(sessionDirectory, "upload.json"));
  const processingJob = await readJson(path.join(sessionDirectory, "processing-job.json"));
  const validationReport = await readJson(path.join(sessionDirectory, "validation-report.json"));
  const measurementReport = await readMeasurementReport(sessionDirectory);

  if (!uploadMetadata && !processingJob && !validationReport) {
    return null;
  }

  const sessionId =
    uploadMetadata?.sessionId ??
    processingJob?.sessionId ??
    validationReport?.sessionId ??
    path.basename(sessionDirectory);
  const cameraMode =
    uploadMetadata?.metadata?.cameraMode ??
    validationReport?.summary?.cameraMode ??
    "unknown";

  return {
    archive: {
      file: processingJob?.input?.archiveFile ?? null,
      name: uploadMetadata?.archive?.name ?? null,
      size:
        uploadMetadata?.archive?.size ??
        validationReport?.summary?.archiveSize ??
        0,
    },
    cameraMode: ["live", "mock"].includes(cameraMode) ? cameraMode : "unknown",
    frameCount:
      uploadMetadata?.metadata?.frameCount ??
      validationReport?.summary?.frameCount ??
      0,
    measurementReport,
    processingJob,
    reviewStatus: uploadMetadata?.metadata?.reviewStatus ?? "unknown",
    sessionId,
    storedAt:
      uploadMetadata?.storedAt ??
      processingJob?.createdAt ??
      validationReport?.generatedAt ??
      null,
    validationReport,
  };
}

async function readSessionDirectories() {
  try {
    const entries = await readdir(uploadRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(uploadRoot, entry.name));
  } catch {
    return [];
  }
}

async function processSessionDirectory(sessionDirectory) {
  const jobFile = path.join(sessionDirectory, "processing-job.json");
  const validationReportFile = path.join(sessionDirectory, "validation-report.json");
  const measurementsFile = path.join(sessionDirectory, measurementReportFileName);
  const avatarMeshFile = path.join(sessionDirectory, bodyAvatarFileName);
  const job = await readJson(jobFile);

  if (!job || job.status !== "queued") {
    return null;
  }

  const processingStartedAt = new Date().toISOString();
  const processingJob = {
    ...job,
    attempts: (job.attempts ?? 0) + 1,
    errorMessage: undefined,
    notes: [...(job.notes ?? []), "Local worker started dataset validation."],
    output: null,
    stage: "validation",
    status: "processing",
    updatedAt: processingStartedAt,
  };

  await writeJson(jobFile, processingJob);

  try {
    const validationReport = await validateUploadedSession(processingJob);

    await writeJson(validationReportFile, validationReport);

    if (validationReport.status !== "passed") {
      throw new Error(validationReport.blockingIssues.join("; "));
    }

    const measurementReport = await createBodyMeasurementReport(processingJob);
    const avatarMesh = await createBodyAvatarMeshReport(measurementReport, processingJob);

    await writeJson(measurementsFile, measurementReport);
    await writeJson(avatarMeshFile, avatarMesh);

    const completedJob = {
      ...processingJob,
      notes: [
        ...processingJob.notes,
        "Dataset validation passed.",
        measurementReport.status === "estimated"
          ? "Local body measurement report generated."
          : "Local measurement report generated with insufficient data.",
        avatarMesh.aiReconstruction.status === "provider-ready"
          ? "AI avatar reconstruction handoff is provider-ready."
          : "AI avatar reconstruction handoff needs stronger capture coverage.",
      ],
      output: {
        measurementsFile: relativeToWorkspace(measurementsFile),
        reconstructionFile: relativeToWorkspace(avatarMeshFile),
        validationReportFile: relativeToWorkspace(validationReportFile),
      },
      stage: "completed",
      status: "completed",
      updatedAt: new Date().toISOString(),
    };

    await writeJson(jobFile, completedJob);

    return {
      jobId: completedJob.id,
      sessionId: completedJob.sessionId,
      status: completedJob.status,
    };
  } catch (error) {
    const failedReport = await ensureFailedReport(
      validationReportFile,
      processingJob,
      error instanceof Error ? error.message : "Validation failed.",
    );

    const failedJob = {
      ...processingJob,
      errorMessage:
        error instanceof Error ? error.message : "Unable to validate scan archive.",
      notes: [...processingJob.notes, "Dataset validation failed."],
      output: {
        validationReportFile: relativeToWorkspace(validationReportFile),
      },
      stage: "failed",
      status: "failed",
      updatedAt: new Date().toISOString(),
    };

    await writeJson(validationReportFile, failedReport);
    await writeJson(jobFile, failedJob);

    return {
      jobId: failedJob.id,
      sessionId: failedJob.sessionId,
      status: failedJob.status,
    };
  }
}

async function validateUploadedSession(job) {
  const archivePath = resolveUploadFile(job.input.archiveFile);
  const uploadManifestPath = resolveUploadFile(job.input.manifestFile);
  const checks = [];
  const archiveStats = await checkFile(
    checks,
    "archive-exists",
    "Archive exists",
    archivePath,
  );

  await checkFile(
    checks,
    "upload-manifest-exists",
    "Upload metadata exists",
    uploadManifestPath,
  );

  if (!archiveStats) {
    return buildValidationReport(job, checks, 0, null);
  }

  if (archiveStats && archiveStats.size > maximumArchiveBytes) {
    addCheck(
      checks,
      "archive-size",
      "Archive size is sane",
      "failed",
      `Archive is ${archiveStats.size} bytes, above ${maximumArchiveBytes}.`,
    );
  } else if (archiveStats) {
    addCheck(
      checks,
      "archive-size",
      "Archive size is sane",
      "passed",
      `Archive is ${archiveStats.size} bytes.`,
    );
  }

  const archiveBytes = await readFile(archivePath);
  let files;

  try {
    files = unzipSync(new Uint8Array(archiveBytes));
    addCheck(checks, "archive-readable", "Archive is readable", "passed", "ZIP opened.");
  } catch (error) {
    addCheck(
      checks,
      "archive-readable",
      "Archive is readable",
      "failed",
      error instanceof Error ? error.message : "ZIP could not be opened.",
    );

    return buildValidationReport(job, checks, archiveStats?.size ?? 0, null);
  }

  const manifestBytes = files["manifest.json"];

  if (!manifestBytes) {
    addCheck(
      checks,
      "manifest-present",
      "Archive manifest exists",
      "failed",
      "manifest.json is missing from the ZIP.",
    );
    return buildValidationReport(job, checks, archiveStats?.size ?? 0, null);
  }

  addCheck(
    checks,
    "manifest-present",
    "Archive manifest exists",
    "passed",
    "manifest.json found.",
  );

  let manifest;

  try {
    manifest = JSON.parse(strFromU8(manifestBytes));
    addCheck(checks, "manifest-json", "Manifest parses", "passed", "Manifest JSON parsed.");
  } catch (error) {
    addCheck(
      checks,
      "manifest-json",
      "Manifest parses",
      "failed",
      error instanceof Error ? error.message : "Manifest JSON failed to parse.",
    );
    return buildValidationReport(job, checks, archiveStats?.size ?? 0, null);
  }

  validateManifest(files, manifest, checks);

  return buildValidationReport(job, checks, archiveStats?.size ?? 0, manifest);
}

function validateManifest(files, manifest, checks) {
  const frames = Array.isArray(manifest.frames) ? manifest.frames : [];
  const videos = Array.isArray(manifest.videos) ? manifest.videos : [];
  const requiredMinimumFrameCount = getMinimumReconstructionFrameCount(manifest);
  const reconstructionProfile = getReconstructionProfile(manifest);

  if (manifest.schemaVersion === "body-scan-session.v1") {
    addCheck(
      checks,
      "schema-version",
      "Schema version is supported",
      "passed",
      manifest.schemaVersion,
    );
  } else {
    addCheck(
      checks,
      "schema-version",
      "Schema version is supported",
      "failed",
      `Unsupported schema ${String(manifest.schemaVersion)}.`,
    );
  }

  addCheck(
    checks,
    "reconstruction-profile",
    "Reconstruction capture profile is available",
    "passed",
    reconstructionProfile?.schemaVersion === "reconstruction-capture-profile.v1"
      ? `${reconstructionProfile.profileId ?? "profile"} ${reconstructionProfile.profileVersion ?? ""}`.trim()
      : "Legacy manifest; using processor fallback reconstruction targets.",
  );

  if (frames.length >= requiredMinimumFrameCount) {
    addCheck(
      checks,
      "frame-count-minimum",
      "Frame count is sufficient for avatar reconstruction",
      "passed",
      `${frames.length} / ${requiredMinimumFrameCount}+ frames.`,
    );
  } else {
    addCheck(
      checks,
      "frame-count-minimum",
      "Frame count is sufficient for avatar reconstruction",
      "failed",
      `${frames.length} frames, expected at least ${requiredMinimumFrameCount}.`,
    );
  }

  if (frames.length <= maximumFrameCount) {
    addCheck(
      checks,
      "frame-count-maximum",
      "Frame count is bounded",
      "passed",
      `${frames.length} frames.`,
    );
  } else {
    addCheck(
      checks,
      "frame-count-maximum",
      "Frame count is bounded",
      "failed",
      `${frames.length} frames, expected no more than ${maximumFrameCount}.`,
    );
  }

  const phaseFrameCounts = countFramesByState(frames);
  const requiredCaptureStates = getRequiredCaptureStates(manifest);

  for (const state of requiredCaptureStates) {
    const count = phaseFrameCounts[state] ?? 0;
    const minimumFrameCount = getMinimumReconstructionFramesForState(manifest, state);
    addCheck(
      checks,
      `phase-${state}`,
      `${state} has enough frames`,
      count >= minimumFrameCount ? "passed" : "failed",
      `${count} / ${minimumFrameCount}+ frames.`,
    );
  }

  const missingFrameFiles = frames
    .map((frame) => frame.fileName)
    .filter((fileName) => typeof fileName !== "string" || !files[`frames/${fileName}`]);

  addCheck(
    checks,
    "frame-files-present",
    "Frame files exist",
    missingFrameFiles.length === 0 ? "passed" : "failed",
    missingFrameFiles.length === 0
      ? "All manifest frames exist in the archive."
      : `${missingFrameFiles.length} frame files are missing.`,
  );

  if (videos.length > 0) {
    const missingVideoFiles = videos
      .map((video) => video.fileName)
      .filter((fileName) => typeof fileName !== "string" || !files[`video/${fileName}`]);
    const invalidVideoMetadata = videos.filter(
      (video) =>
        !Number.isFinite(video.durationMs) ||
        video.durationMs <= 0 ||
        !Array.isArray(video.phaseTimeline) ||
        video.phaseTimeline.length === 0,
    );

    addCheck(
      checks,
      "temporal-video",
      "Guided video and phase timeline are valid",
      missingVideoFiles.length === 0 && invalidVideoMetadata.length === 0 ? "passed" : "failed",
      missingVideoFiles.length === 0 && invalidVideoMetadata.length === 0
        ? `${videos.length} video clip${videos.length === 1 ? "" : "s"} with phase timing.`
        : `${missingVideoFiles.length} missing files; ${invalidVideoMetadata.length} invalid metadata records.`,
    );
  }

  const framesWithInvalidDimensions = frames.filter(
    (frame) => !Number.isFinite(frame.width) || !Number.isFinite(frame.height) || frame.width <= 0 || frame.height <= 0,
  );

  addCheck(
    checks,
    "frame-dimensions",
    "Frame dimensions are valid",
    framesWithInvalidDimensions.length === 0 ? "passed" : "failed",
    framesWithInvalidDimensions.length === 0
      ? "All frame dimensions are positive."
      : `${framesWithInvalidDimensions.length} frames have invalid dimensions.`,
  );

  const framesMissingMetrics = frames.filter(
    (frame) =>
      !Array.isArray(frame.metrics) ||
      frame.metrics.length === 0 ||
      frame.metrics.some(
        (metric) =>
          typeof metric.label !== "string" ||
          typeof metric.value !== "string" ||
          !["good", "warning", "neutral"].includes(metric.tone),
      ),
  );

  addCheck(
    checks,
    "quality-metrics",
    "Frame quality metrics are present",
    framesMissingMetrics.length === 0 ? "passed" : "failed",
    framesMissingMetrics.length === 0
      ? "All frames include quality metrics."
      : `${framesMissingMetrics.length} frames are missing valid metrics.`,
  );

  if (manifest.review?.isExportReady === true) {
    addCheck(
      checks,
      "review-export-ready",
      "Review gate passed before upload",
      "passed",
      "Manifest review reports export ready.",
    );
  } else {
    addCheck(
      checks,
      "review-export-ready",
      "Review gate passed before upload",
      "failed",
      "Manifest review was not export ready.",
    );
  }
}

async function createBodyMeasurementReport(job) {
  const { files, manifest } = await readArchiveBundle(job.input.archiveFile);
  const frames = Array.isArray(manifest?.frames) ? manifest.frames : [];
  const subjectHeightCm = getSubjectHeightCm(manifest);
  const baseReport = {
    assumptions: [
      "Subject height is user supplied and used as the metric scale anchor.",
      "Browser-side person segmentation masks are preferred for body bounds and row widths when available.",
      "Linear widths are aggregated across multiple accepted frames with outlier rejection.",
      "Circumference estimates model the torso as an ellipse from front width and side depth.",
      "The provider boundary is intentionally narrow so a hosted provider can replace this local estimator.",
    ],
    generatedAt: new Date().toISOString(),
    measurements: [],
    provider: {
      id: "local-open-source-estimator",
      mode: "local",
      name: "Local Open Source Measurement Estimator",
      version: measurementProviderVersion,
    },
    schemaVersion: "body-measurements.v1",
    sessionId: job.sessionId,
    sourceJobId: job.id,
    status: "insufficient-data",
    subject: {
      heightCm: subjectHeightCm,
    },
    warnings: [
      "This is a demo estimator, not a tailor-grade reconstruction model.",
    ],
  };

  if (!subjectHeightCm) {
    return {
      ...baseReport,
      warnings: [
        ...baseReport.warnings,
        `Height must be between ${minimumHeightCm} and ${maximumHeightCm} cm for calibrated measurements.`,
      ],
    };
  }

  const analyses = frames.map((frame) =>
    analyzeMeasurementFrame(frame, files[`frames/${frame.fileName}`]),
  );
  const frontFrame =
    chooseMeasurementAggregate(analyses, ["front-view"], subjectHeightCm) ??
    chooseMeasurementAggregate(analyses, ["front-view", "back-view"], subjectHeightCm);
  const sideFrame = chooseMeasurementAggregate(analyses, ["side-view"], subjectHeightCm);
  const calibrationFrame = frontFrame ?? sideFrame;

  if (!calibrationFrame || !calibrationFrame.bodyBounds) {
    return {
      ...baseReport,
      warnings: [
        ...baseReport.warnings,
        "No usable body geometry was found in the saved frames.",
      ],
    };
  }

  const measurements = buildMeasurements({
    frontFrame,
    heightCm: subjectHeightCm,
    sideFrame,
  });
  const warnings = [...baseReport.warnings];

  if (frames.some((frame) => frame.source === "mock-camera")) {
    warnings.push("Mock camera frames are synthetic, so values demonstrate the pipeline only.");
  }

  if (!frontFrame?.hasSavedPose) {
    warnings.push("No saved front/back pose landmarks were available; silhouette or guide geometry was used.");
  }

  if (!frontFrame?.bodyBoundsSource?.includes("person-segmentation-mask")) {
    warnings.push("No front/back person segmentation mask was available; fallback geometry was used.");
  }

  if (!sideFrame || sideFrame.frame.source === "mock-camera") {
    warnings.push("Side depth was inferred from body-width ratios rather than measured from a real side silhouette.");
  }

  if (sideFrame && !sideFrame.bodyBoundsSource?.includes("person-segmentation-mask")) {
    warnings.push("No side-view person segmentation mask was available; fallback side geometry was used.");
  }

  if (frontFrame?.sampleCount && frontFrame.sampleCount < 3) {
    warnings.push("Front/back measurement aggregation used fewer than three usable frames.");
  }

  if (sideFrame?.sampleCount && sideFrame.sampleCount < 3) {
    warnings.push("Side-depth measurement aggregation used fewer than three usable frames.");
  }

  if (measurements.some((measurement) => measurement.confidence === "low")) {
    warnings.push("Low-confidence values should be replaced by a SMPL or commercial measurement provider before production use.");
  }

  return {
    ...baseReport,
    measurements,
    status: measurements.length > 0 ? "estimated" : "insufficient-data",
    warnings: Array.from(new Set(warnings)),
  };
}

async function createBodyAvatarMeshReport(measurementReport, job = null) {
  const measurements = getMeasurementValueMap(measurementReport);
  const heightCm = getMeasurementValue(measurements, "height", measurementReport.subject?.heightCm ?? 175);
  const scanDerivedMeshModel = job?.input?.archiveFile
    ? await buildScanDerivedBodyMeshFromJob(job, measurements, heightCm)
    : null;
  const meshModel = scanDerivedMeshModel ?? buildParametricBodyMesh(measurements, heightCm);
  const aiReconstruction = job?.input?.archiveFile
    ? await createAiAvatarReconstructionReport(job)
    : createAiAvatarFallbackReport();
  const lowConfidenceMeasurements = measurementReport.measurements
    .filter((measurement) => measurement.confidence === "low")
    .map((measurement) => measurement.label);
  const warnings = [
    scanDerivedMeshModel
      ? "This is a scan-aligned anthropometric avatar from saved segmentation masks, not a recovered SMPL mesh."
      : "This is a parametric demo avatar, not a recovered SMPL mesh.",
    ...(
      lowConfidenceMeasurements.length > 0
        ? [`Low-confidence measurements influenced: ${lowConfidenceMeasurements.join(", ")}.`]
        : []
    ),
  ];

  return {
    aiReconstruction,
    generatedAt: new Date().toISOString(),
    landmarks: meshModel.landmarks,
    measurements: Object.fromEntries(
      Object.entries(measurements).map(([key, value]) => [key, roundMeasurement(value)]),
    ),
    mesh: meshModel.mesh,
    provider: {
      id: "local-parametric-avatar",
      mode: "local",
      name: scanDerivedMeshModel
        ? "Local Scan-Derived Body Avatar"
        : "Local Parametric Body Avatar",
      version: bodyAvatarProviderVersion,
    },
    schemaVersion: "body-avatar.v1",
    sessionId: measurementReport.sessionId,
    sourceJobId: measurementReport.sourceJobId,
    sourceMeasurementReport: "body-measurements.v1",
    units: "cm",
    warnings,
  };
}

async function createAiAvatarReconstructionReport(job) {
  try {
    const { manifest } = await readArchiveBundle(job.input.archiveFile);
    const frames = Array.isArray(manifest?.frames) ? manifest.frames : [];
    const phaseFrameCounts = countFramesByState(frames);
    const requiredCaptureStates = getRequiredCaptureStates(manifest);
    const minimumAcceptedFrameCount = getMinimumReconstructionFrameCount(manifest);
    const targetAcceptedFrameCount = getTargetReconstructionFrameCount(manifest);
    const missingPhases = requiredCaptureStates.filter(
      (state) =>
        (phaseFrameCounts[state] ?? 0) < getMinimumReconstructionFramesForState(manifest, state),
    );
    const selectedInputs = {
      backFrameFile: selectBestAiAvatarFrame(frames, ["back-view"])?.fileName ?? null,
      frontFrameFile: selectBestAiAvatarFrame(frames, ["front-view"])?.fileName ?? null,
      sideFrameFile:
        selectBestAiAvatarFrame(frames, ["side-view"])?.fileName ??
        selectBestAiAvatarFrame(frames, ["rotate-left", "rotate-right"])?.fileName ??
        null,
    };
    const hasCoreInputs = Boolean(
      selectedInputs.frontFrameFile &&
      selectedInputs.sideFrameFile &&
      selectedInputs.backFrameFile,
    );
    const hasMockFrames = frames.some((frame) => frame.source === "mock-camera");
    const status =
      missingPhases.length === 0 && hasCoreInputs && !hasMockFrames
        ? "provider-ready"
        : "needs-better-capture";
    const warnings = [];

    if (!getReconstructionProfile(manifest)) {
      warnings.push("Manifest did not include the typed reconstruction profile; fallback phase targets were used.");
    }

    if (hasMockFrames) {
      warnings.push("Mock frames cannot produce a true user-resembling AI avatar.");
    }

    if (missingPhases.length > 0) {
      warnings.push(`Retake or extend phases with weak coverage: ${missingPhases.join(", ")}.`);
    }

    if (!hasCoreInputs) {
      warnings.push("A provider-ready handoff needs at least front, side, and back frame candidates.");
    }

    if (!frames.some((frame) => frame.vision?.segmentation?.mask)) {
      warnings.push("No saved person masks were found; hosted providers may need to re-segment source imagery.");
    }

    return {
      captureReadiness: {
        acceptedFrameCount: frames.length,
        minimumAcceptedFrameCount,
        phaseFrameCounts,
        status: status === "provider-ready" ? "ready" : "needs-more-coverage",
        targetAcceptedFrameCount,
      },
      nextProviderAction:
        status === "provider-ready"
          ? "Send the selected front/side/back frames, subject height, measurement report, and manifest reconstructionProfile to the chosen AI avatar provider."
          : "Retake the scan with the reconstruction guidance until all phase frame targets are met.",
      recommendedProviders: getRecommendedAiAvatarProviders(manifest),
      selectedInputs,
      status,
      warnings,
    };
  } catch (error) {
    return {
      ...createAiAvatarFallbackReport(),
      warnings: [
        `Unable to inspect scan archive for AI avatar handoff: ${
          error instanceof Error ? error.message : "unknown error"
        }.`,
      ],
    };
  }
}

function createAiAvatarFallbackReport() {
  const minimumAcceptedFrameCount = Object.values(fallbackMinimumFramesByPhase)
    .reduce((total, count) => total + count, 0);
  const targetAcceptedFrameCount = Object.values(fallbackTargetFramesByPhase)
    .reduce((total, count) => total + count, 0);

  return {
    captureReadiness: {
      acceptedFrameCount: 0,
      minimumAcceptedFrameCount,
      phaseFrameCounts: {},
      status: "needs-more-coverage",
      targetAcceptedFrameCount,
    },
    nextProviderAction: "Process a reconstruction-profile scan before running the self-hosted human model worker.",
    recommendedProviders: getRecommendedAiAvatarProviders(null),
    selectedInputs: {
      backFrameFile: null,
      frontFrameFile: null,
      sideFrameFile: null,
    },
    status: "needs-better-capture",
    warnings: ["No scan archive was available for provider handoff."],
  };
}

function getRecommendedAiAvatarProviders(manifest) {
  const providers = getReconstructionProfile(manifest)?.providerCandidates;

  if (Array.isArray(providers) && providers.length > 0) {
    return providers;
  }

  return [
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
  ];
}

function selectBestAiAvatarFrame(frames, states) {
  return frames
    .filter((frame) => states.includes(frame.state) && typeof frame.fileName === "string")
    .map((frame) => ({
      frame,
      score: getAiAvatarFrameScore(frame),
    }))
    .sort((left, right) => right.score - left.score)[0]?.frame ?? null;
}

function getAiAvatarFrameScore(frame) {
  const width = Number(frame.width);
  const height = Number(frame.height);
  const maxDimension = Math.max(width, height);
  const bounds = frame.vision?.segmentation?.bodyBounds ?? frame.vision?.bodyBounds;
  const bodyCoverage = bounds && height > 0
    ? clamp(Number(bounds.height) / height, 0, 1)
    : 0;
  const segmentationScore = frame.vision?.segmentation?.mask ? 1.25 : 0;
  const liveScore = frame.source === "live-camera" ? 0.5 : 0;
  const centerPhasePenalty = Math.abs(Number(frame.phaseProgress ?? 50) - 50) / 200;

  return maxDimension / 1000 + bodyCoverage * 2 + segmentationScore + liveScore - centerPhasePenalty;
}

function getMeasurementValueMap(report) {
  return Object.fromEntries(
    (report.measurements ?? [])
      .filter((measurement) => Number.isFinite(Number(measurement.valueCm)))
      .map((measurement) => [measurement.key, Number(measurement.valueCm)]),
  );
}

function getMeasurementValue(measurements, key, fallback) {
  const value = Number(measurements[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getClampedBodyMeasurementValue(measurements, key, heightCm, fallback, shoulderWidthCm) {
  const value = getMeasurementValue(measurements, key, fallback);
  const range = getBodyMeasurementPlausibleRange(key, heightCm, shoulderWidthCm);

  return range ? clamp(value, range.min, range.max) : value;
}

async function buildScanDerivedBodyMeshFromJob(job, measurements, heightCm) {
  try {
    const { files, manifest } = await readArchiveBundle(job.input.archiveFile);
    const frames = Array.isArray(manifest?.frames) ? manifest.frames : [];
    const analyses = frames.map((frame) =>
      analyzeMeasurementFrame(frame, files[`frames/${frame.fileName}`]),
    );
    const frontAnalyses = chooseAvatarMaskFrames(analyses, ["front-view"]);
    const frontBackAnalyses = frontAnalyses.length > 0
      ? frontAnalyses
      : chooseAvatarMaskFrames(analyses, ["front-view", "back-view"]);
    const sideAnalyses = chooseAvatarMaskFrames(analyses, ["side-view"]);
    const sideRotationAnalyses = sideAnalyses.length > 0
      ? sideAnalyses
      : chooseAvatarMaskFrames(analyses, ["rotate-left", "rotate-right"]);

    if (frontBackAnalyses.length === 0) {
      return null;
    }

    return buildScanDerivedBodyMesh({
      frontAnalyses: frontBackAnalyses,
      heightCm,
      measurements,
      sideAnalyses: sideRotationAnalyses,
    });
  } catch {
    return null;
  }
}

function chooseAvatarMaskFrames(analyses, states, limit = 8) {
  return analyses
    .filter((analysis) =>
      states.includes(analysis.frame.state) &&
      analysis.bodyBounds &&
      analysis.segmentationMask,
    )
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

function buildScanDerivedBodyMesh({ frontAnalyses, heightCm, measurements, sideAnalyses }) {
  const builder = createMeshBuilder();
  const shoulderWidth = getClampedBodyMeasurementValue(measurements, "shoulderWidth", heightCm, heightCm * 0.255);
  const neck = getClampedBodyMeasurementValue(measurements, "neck", heightCm, heightCm * 0.205, shoulderWidth);
  const chest = getClampedBodyMeasurementValue(measurements, "chest", heightCm, heightCm * 0.535, shoulderWidth);
  const waist = getClampedBodyMeasurementValue(measurements, "waist", heightCm, heightCm * 0.43, shoulderWidth);
  const hips = getClampedBodyMeasurementValue(measurements, "hips", heightCm, heightCm * 0.525, shoulderWidth);
  const thigh = getClampedBodyMeasurementValue(measurements, "thigh", heightCm, heightCm * 0.31, shoulderWidth);
  const inseam = getClampedBodyMeasurementValue(measurements, "inseam", heightCm, heightCm * 0.455, shoulderWidth);
  const sleeveLength = getClampedBodyMeasurementValue(measurements, "sleeveLength", heightCm, heightCm * 0.335, shoulderWidth);
  const segments = 36;
  const shoulderHalf = shoulderWidth / 2;
  const crotchY = clamp(inseam, heightCm * 0.41, heightCm * 0.52);
  const hipY = clamp(crotchY + heightCm * 0.055, heightCm * 0.48, heightCm * 0.57);
  const waistY = heightCm * 0.62;
  const lowerRibY = heightCm * 0.68;
  const chestY = heightCm * 0.735;
  const shoulderY = heightCm * 0.825;
  const neckBaseY = heightCm * 0.872;
  const headTopY = heightCm;
  const ankleY = heightCm * 0.055;
  const kneeY = clamp(ankleY + (crotchY - ankleY) * 0.48, heightCm * 0.245, heightCm * 0.335);
  const calfY = (ankleY + kneeY) / 2;
  const midThighY = kneeY + (crotchY - kneeY) * 0.58;
  const wristY = clamp(shoulderY - sleeveLength * 0.96, heightCm * 0.46, shoulderY - heightCm * 0.17);
  const elbowY = shoulderY - (shoulderY - wristY) * 0.52;
  const chestRadii = getScanAlignedEllipseRadii({
    circumference: chest,
    depthRatio: 0.7,
    fallbackWidth: shoulderWidth * 0.86,
    frontAnalyses,
    heightCm,
    maxWidth: shoulderWidth * 1.12,
    minWidth: shoulderWidth * 0.74,
    ratio: 0.33,
    sampleScale: 0.62,
    sideAnalyses,
  });
  const waistRadii = getScanAlignedEllipseRadii({
    circumference: waist,
    depthRatio: 0.72,
    fallbackWidth: shoulderWidth * 0.68,
    frontAnalyses,
    heightCm,
    maxWidth: shoulderWidth * 1.02,
    minWidth: shoulderWidth * 0.52,
    ratio: 0.5,
    sampleScale: 0.68,
    sideAnalyses,
  });
  const hipRadii = getScanAlignedEllipseRadii({
    circumference: hips,
    depthRatio: 0.74,
    fallbackWidth: shoulderWidth * 0.9,
    frontAnalyses,
    heightCm,
    maxWidth: shoulderWidth * 1.22,
    minWidth: shoulderWidth * 0.76,
    ratio: 0.58,
    sampleScale: 0.74,
    sideAnalyses,
  });
  const neckRadii = getClampedEllipseRadii(neck, 0.86, shoulderWidth * 0.25, shoulderWidth * 0.38);
  const thighRadii = getScanAlignedEllipseRadii({
    circumference: thigh,
    depthRatio: 0.94,
    fallbackWidth: shoulderWidth * 0.46,
    frontAnalyses,
    heightCm,
    maxWidth: shoulderWidth * 0.62,
    minWidth: shoulderWidth * 0.32,
    ratio: clamp((heightCm - midThighY) / heightCm, 0.62, 0.74),
    sampleScale: 0.9,
    sideAnalyses,
  });
  const shoulderCenterOffset = getScanCenterOffset(frontAnalyses, 0.28, heightCm, heightCm * 0.018);
  const waistCenterOffset = getScanCenterOffset(frontAnalyses, 0.5, heightCm, heightCm * 0.022);
  const hipCenterOffset = getScanCenterOffset(frontAnalyses, 0.58, heightCm, heightCm * 0.025);
  const torsoRings = [
    { centerX: hipCenterOffset * 0.72, radiusX: hipRadii.radiusX * 0.32, radiusZ: hipRadii.radiusZ * 0.42, y: crotchY - heightCm * 0.006 },
    { centerX: hipCenterOffset * 0.8, radiusX: hipRadii.radiusX * 0.62, radiusZ: hipRadii.radiusZ * 0.72, y: crotchY + heightCm * 0.028 },
    { centerX: hipCenterOffset, radiusX: hipRadii.radiusX * 0.94, radiusZ: hipRadii.radiusZ, y: hipY },
    { centerX: waistCenterOffset, radiusX: waistRadii.radiusX * 1.01, radiusZ: waistRadii.radiusZ, y: waistY },
    {
      centerX: blendFinite(waistCenterOffset, shoulderCenterOffset, 0.32),
      radiusX: waistRadii.radiusX * 0.9 + chestRadii.radiusX * 0.1,
      radiusZ: waistRadii.radiusZ * 0.9 + chestRadii.radiusZ * 0.1,
      y: lowerRibY,
    },
    { centerX: shoulderCenterOffset * 0.55, radiusX: chestRadii.radiusX, radiusZ: chestRadii.radiusZ, y: chestY },
    { centerX: shoulderCenterOffset * 0.28, radiusX: shoulderHalf * 0.94, radiusZ: chestRadii.radiusZ * 0.82, y: shoulderY - heightCm * 0.012 },
    { centerX: 0, radiusX: neckRadii.radiusX * 1.34, radiusZ: neckRadii.radiusZ * 1.06, y: neckBaseY },
  ];

  addRingedSurface(builder, torsoRings, segments, { capBottom: true, capTop: false });
  addRingedSurface(
    builder,
    [
      { radiusX: neckRadii.radiusX * 0.98, radiusZ: neckRadii.radiusZ * 0.98, y: neckBaseY - heightCm * 0.006 },
      { radiusX: neckRadii.radiusX * 0.9, radiusZ: neckRadii.radiusZ * 0.9, y: neckBaseY + heightCm * 0.042 },
    ],
    segments,
    { capBottom: false, capTop: false },
  );

  const headSample = sampleScanMaskSpan(frontAnalyses, 0.07, heightCm);
  const headRadiusX = clamp(
    blendFinite(heightCm * 0.052, headSample ? headSample.widthCm * 0.42 : null, 0.28),
    heightCm * 0.044,
    heightCm * 0.064,
  );
  addEllipsoid(
    builder,
    { x: 0, y: (neckBaseY + headTopY) / 2, z: 0 },
    {
      radiusX: headRadiusX,
      radiusY: Math.max(heightCm * 0.061, (headTopY - neckBaseY) / 2),
      radiusZ: headRadiusX * 1.08,
    },
    30,
    18,
  );
  addEllipsoid(
    builder,
    { x: 0, y: heightCm * 0.942, z: heightCm * 0.058 },
    {
      radiusX: heightCm * 0.008,
      radiusY: heightCm * 0.014,
      radiusZ: heightCm * 0.011,
    },
    12,
    8,
  );

  const legSpacing = Math.max(thighRadii.radiusX * 1.08, hipRadii.radiusX * 0.52);
  const crotchRatio = clamp((heightCm - crotchY) / heightCm, 0.48, 0.62);

  for (const side of [-1, 1]) {
    const ankleSample = getScanLegSample(frontAnalyses, side, 0.96, heightCm);
    const calfSample = getScanLegSample(frontAnalyses, side, clamp((heightCm - calfY) / heightCm, 0.76, 0.88), heightCm);
    const kneeSample = getScanLegSample(frontAnalyses, side, clamp((heightCm - kneeY) / heightCm, 0.68, 0.82), heightCm);
    const thighSample = getScanLegSample(frontAnalyses, side, clamp((heightCm - midThighY) / heightCm, 0.58, 0.72), heightCm);
    const crotchSample = getScanLegSample(frontAnalyses, side, crotchRatio, heightCm);
    const baseCenter = side * legSpacing;
    const legRings = [
      {
        centerX: blendFinite(baseCenter * 0.98, ankleSample?.centerOffsetCm, 0.35),
        radiusX: blendFinite(heightCm * 0.018, ankleSample ? ankleSample.widthCm * 0.28 : null, 0.28),
        radiusZ: heightCm * 0.021,
        y: ankleY,
      },
      {
        centerX: blendFinite(baseCenter, calfSample?.centerOffsetCm, 0.32),
        radiusX: blendFinite(thighRadii.radiusX * 0.52, calfSample ? calfSample.widthCm * 0.36 : null, 0.24),
        radiusZ: thighRadii.radiusZ * 0.54,
        y: calfY,
      },
      {
        centerX: blendFinite(baseCenter * 1.02, kneeSample?.centerOffsetCm, 0.32),
        radiusX: blendFinite(thighRadii.radiusX * 0.48, kneeSample ? kneeSample.widthCm * 0.34 : null, 0.22),
        radiusZ: thighRadii.radiusZ * 0.48,
        y: kneeY,
      },
      {
        centerX: blendFinite(baseCenter, thighSample?.centerOffsetCm, 0.28),
        radiusX: blendFinite(thighRadii.radiusX * 0.9, thighSample ? thighSample.widthCm * 0.42 : null, 0.24),
        radiusZ: thighRadii.radiusZ * 0.9,
        y: midThighY,
      },
      {
        centerX: blendFinite(baseCenter * 0.94, crotchSample?.centerOffsetCm, 0.24),
        radiusX: blendFinite(thighRadii.radiusX * 0.96, crotchSample ? crotchSample.widthCm * 0.42 : null, 0.2),
        radiusZ: thighRadii.radiusZ,
        y: crotchY,
      },
    ].map((ring) => ({
      ...ring,
      radiusX: clamp(ring.radiusX, heightCm * 0.016, heightCm * 0.092),
      radiusZ: clamp(ring.radiusZ, heightCm * 0.016, heightCm * 0.088),
    }));

    addRingedSurface(builder, legRings, 24, { capBottom: true, capTop: true });
    addEllipsoid(
      builder,
      { x: legRings[0].centerX, y: heightCm * 0.018, z: heightCm * 0.032 },
      {
        radiusX: heightCm * 0.026,
        radiusY: heightCm * 0.014,
        radiusZ: heightCm * 0.064,
      },
      18,
      8,
    );
  }

  const upperArmRadius = clamp(chest / 2 / Math.PI * 0.23, heightCm * 0.022, heightCm * 0.037);
  const forearmRadius = upperArmRadius * 0.72;
  const wristRadius = heightCm * 0.015;
  for (const side of [-1, 1]) {
    const shoulderX = side * (shoulderHalf + upperArmRadius * 0.55);
    const elbowX = side * (shoulderHalf + upperArmRadius * 0.18);
    const wristX = side * (shoulderHalf * 0.86);

    addEllipsoid(
      builder,
      { x: side * shoulderHalf * 0.96, y: shoulderY - heightCm * 0.018, z: 0 },
      {
        radiusX: upperArmRadius * 1.25,
        radiusY: upperArmRadius * 1.05,
        radiusZ: upperArmRadius * 1.18,
      },
      16,
      10,
    );

    addRingedSurface(
      builder,
      [
        {
          centerX: shoulderX,
          radiusX: upperArmRadius,
          radiusZ: upperArmRadius * 0.92,
          y: shoulderY - heightCm * 0.012,
        },
        {
          centerX: elbowX,
          radiusX: forearmRadius,
          radiusZ: forearmRadius * 0.9,
          y: elbowY,
        },
        {
          centerX: wristX,
          radiusX: wristRadius,
          radiusZ: wristRadius * 0.92,
          y: wristY,
        },
      ],
      18,
      { capBottom: true, capTop: true },
    );

    addEllipsoid(
      builder,
      { x: wristX, y: wristY - heightCm * 0.012, z: 0 },
      {
        radiusX: heightCm * 0.017,
        radiusY: heightCm * 0.026,
        radiusZ: heightCm * 0.014,
      },
      16,
      8,
    );
  }

  return {
    landmarks: {
      floor: [0, 0, 0],
      headTop: [0, roundMeasurement(headTopY), 0],
      leftHip: [roundMeasurement(-hipRadii.radiusX * 0.52), roundMeasurement(hipY), 0],
      leftShoulder: [roundMeasurement(-shoulderHalf), roundMeasurement(shoulderY), 0],
      rightHip: [roundMeasurement(hipRadii.radiusX * 0.52), roundMeasurement(hipY), 0],
      rightShoulder: [roundMeasurement(shoulderHalf), roundMeasurement(shoulderY), 0],
    },
    mesh: {
      faces: builder.faces,
      vertexCount: builder.vertices.length,
      vertices: builder.vertices,
    },
  };
}

function getScanAlignedEllipseRadii({
  circumference,
  depthRatio,
  fallbackWidth,
  frontAnalyses,
  heightCm,
  maxWidth,
  minWidth,
  ratio,
  sampleScale,
  sideAnalyses,
}) {
  const fallbackRadii = getClampedEllipseRadii(circumference, depthRatio, minWidth, maxWidth);
  const frontSample = sampleScanMaskSpan(frontAnalyses, ratio, heightCm);
  const sideSample = sampleScanMaskSpan(sideAnalyses, ratio, heightCm);
  const fallbackDiameter = Number.isFinite(fallbackWidth) && fallbackWidth > 0
    ? fallbackWidth
    : fallbackRadii.radiusX * 2;
  const scanDiameter = frontSample
    ? clamp(frontSample.widthCm * sampleScale, minWidth, maxWidth)
    : null;
  const targetWidth = clamp(
    blendFinite(fallbackDiameter, scanDiameter, 0.24),
    minWidth,
    maxWidth,
  );
  const radiusX = targetWidth / 2;
  const solvedRadiusZ = solveEllipseRadiusZ(circumference, radiusX, radiusX * depthRatio);
  const scanDepth = sideSample ? sideSample.widthCm * 0.72 : null;
  const radiusZ = clamp(
    blendFinite(solvedRadiusZ, scanDepth ? scanDepth / 2 : null, 0.18),
    radiusX * 0.38,
    radiusX * 0.92,
  );

  return {
    radiusX,
    radiusZ,
  };
}

function getScanCenterOffset(analyses, ratio, heightCm, maximumOffset) {
  const sample = sampleScanMaskSpan(analyses, ratio, heightCm);

  return sample
    ? clamp(sample.centerOffsetCm * 0.22, -maximumOffset, maximumOffset)
    : 0;
}

function getScanLegSample(analyses, side, ratio, heightCm) {
  const sample = sampleScanLegSpan(analyses, side, ratio, heightCm);

  if (!sample) {
    return null;
  }

  return sample;
}

function blendFinite(fallback, candidate, weight) {
  if (!Number.isFinite(candidate)) {
    return fallback;
  }

  return fallback * (1 - weight) + candidate * weight;
}

function sampleScanMaskSpan(analyses, ratio, heightCm) {
  const samples = analyses
    .map((analysis) => sampleMaskSpanAtBodyRatio(analysis, ratio, heightCm))
    .filter(Boolean);

  return getMedianScanSample(samples);
}

function sampleScanLegSpan(analyses, side, ratio, heightCm) {
  const samples = analyses
    .map((analysis) => sampleLegMaskSpansAtBodyRatio(analysis, ratio, heightCm))
    .map((sample) => sample ? side < 0 ? sample.left : sample.right : null)
    .filter(Boolean);

  return getMedianScanSample(samples);
}

function getMedianScanSample(samples) {
  if (samples.length === 0) {
    return null;
  }

  const centerOffsetCm = getRobustMedian(samples.map((sample) => sample.centerOffsetCm));
  const widthCm = getRobustMedian(samples.map((sample) => sample.widthCm));

  if (!Number.isFinite(centerOffsetCm) || !Number.isFinite(widthCm) || widthCm <= 0) {
    return null;
  }

  return {
    centerOffsetCm,
    widthCm,
  };
}

function sampleMaskSpanAtBodyRatio(analysis, ratio, heightCm) {
  const mask = analysis?.segmentationMask;
  const bounds = analysis?.bodyBounds;

  if (!mask || !bounds) {
    return null;
  }

  const frameWidth = Number(analysis.frame.width);
  const frameHeight = Number(analysis.frame.height);
  const cmPerPixel = getCmPerPixel(analysis, heightCm);

  if (!Number.isFinite(frameWidth) || !Number.isFinite(frameHeight) || !cmPerPixel) {
    return null;
  }

  const scaleX = mask.width / frameWidth;
  const scaleY = mask.height / frameHeight;
  const y = clamp(Math.round((bounds.top + bounds.height * ratio) * scaleY), 0, mask.height - 1);
  const band = Math.max(1, Math.round(mask.height * 0.009));
  const minY = Math.max(0, y - band);
  const maxY = Math.min(mask.height - 1, y + band);
  const minX = Math.max(0, Math.round((bounds.left - frameWidth * 0.025) * scaleX));
  const maxX = Math.min(mask.width - 1, Math.round((bounds.right + frameWidth * 0.025) * scaleX));
  const lefts = [];
  const rights = [];

  for (let row = minY; row <= maxY; row += 1) {
    const span = findCompactMaskForegroundSpan(mask, row, minX, maxX);

    if (span) {
      lefts.push(span.left);
      rights.push(span.right);
    }
  }

  const left = getRobustMedian(lefts);
  const right = getRobustMedian(rights);

  if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) {
    return null;
  }

  const widthPx = (right - left) / scaleX;
  const centerPx = ((left + right) / 2) / scaleX;
  const boundsCenter = bounds.left + bounds.width / 2;

  return {
    centerOffsetCm: (centerPx - boundsCenter) * cmPerPixel,
    widthCm: widthPx * cmPerPixel,
  };
}

function sampleLegMaskSpansAtBodyRatio(analysis, ratio, heightCm) {
  const mask = analysis?.segmentationMask;
  const bounds = analysis?.bodyBounds;

  if (!mask || !bounds) {
    return null;
  }

  const frameWidth = Number(analysis.frame.width);
  const frameHeight = Number(analysis.frame.height);
  const cmPerPixel = getCmPerPixel(analysis, heightCm);

  if (!Number.isFinite(frameWidth) || !Number.isFinite(frameHeight) || !cmPerPixel) {
    return null;
  }

  const scaleX = mask.width / frameWidth;
  const scaleY = mask.height / frameHeight;
  const y = clamp(Math.round((bounds.top + bounds.height * ratio) * scaleY), 0, mask.height - 1);
  const minX = Math.max(0, Math.round((bounds.left - frameWidth * 0.02) * scaleX));
  const maxX = Math.min(mask.width - 1, Math.round((bounds.right + frameWidth * 0.02) * scaleX));
  const centerX = Math.round((bounds.left + bounds.width / 2) * scaleX);
  const runs = findCompactMaskRunsAtRow(mask, y, minX, maxX)
    .filter((run) => run.right - run.left >= 1);
  let leftRun;
  let rightRun;

  if (runs.length >= 2) {
    leftRun = runs
      .filter((run) => (run.left + run.right) / 2 <= centerX)
      .sort((a, b) => b.right - a.right)[0] ?? runs[0];
    rightRun = runs
      .filter((run) => (run.left + run.right) / 2 >= centerX)
      .sort((a, b) => a.left - b.left)[0] ?? runs.at(-1);
  } else if (runs.length === 1) {
    const run = runs[0];
    const middle = clamp(centerX, run.left + 1, run.right - 1);

    leftRun = { left: run.left, right: middle };
    rightRun = { left: middle, right: run.right };
  } else {
    return null;
  }

  const boundsCenter = bounds.left + bounds.width / 2;
  const toSample = (run) => {
    const widthPx = (run.right - run.left) / scaleX;
    const centerPx = ((run.left + run.right) / 2) / scaleX;

    return {
      centerOffsetCm: (centerPx - boundsCenter) * cmPerPixel,
      widthCm: widthPx * cmPerPixel,
    };
  };

  return {
    left: toSample(leftRun),
    right: toSample(rightRun),
  };
}

function findCompactMaskForegroundSpan(mask, y, minX, maxX) {
  let left = null;
  let right = null;

  for (let x = minX; x <= maxX; x += 1) {
    if (mask.values[y * mask.width + x] !== 1) {
      continue;
    }

    left ??= x;
    right = x;
  }

  return left === null || right === null ? null : { left, right };
}

function findCompactMaskRunsAtRow(mask, y, minX, maxX) {
  const runs = [];
  let activeRun = null;

  for (let x = minX; x <= maxX; x += 1) {
    if (mask.values[y * mask.width + x] === 1) {
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

  return runs;
}

function normalizeBodyMeasurementReport(report) {
  const heightCm = getMeasurementValue(
    getMeasurementValueMap(report),
    "height",
    report.subject?.heightCm,
  );

  if (!Number.isFinite(heightCm) || heightCm <= 0 || !Array.isArray(report.measurements)) {
    return report;
  }

  const normalizedMeasurements = normalizeBodyMeasurements(report.measurements, heightCm)
    .map((measurement) => ({
      ...measurement,
      valueCm: roundMeasurement(measurement.valueCm),
    }));
  const changed = normalizedMeasurements.some((measurement, index) =>
    Math.abs(Number(measurement.valueCm) - Number(report.measurements[index]?.valueCm)) >= 0.05,
  );

  if (!changed) {
    return report;
  }

  return {
    ...report,
    assumptions: Array.from(new Set([
      ...(report.assumptions ?? []),
      "Displayed measurements are constrained by local anthropometric plausibility checks when raw mask geometry is noisy.",
    ])),
    measurements: normalizedMeasurements,
    warnings: Array.from(new Set([
      ...(report.warnings ?? []),
      "One or more measurement estimates were adjusted because raw silhouette geometry was outside plausible human proportions.",
    ])),
  };
}

function buildParametricBodyMesh(measurements, heightCm) {
  const builder = createMeshBuilder();
  const shoulderWidth = getClampedBodyMeasurementValue(measurements, "shoulderWidth", heightCm, heightCm * 0.255);
  const neck = getClampedBodyMeasurementValue(measurements, "neck", heightCm, heightCm * 0.205, shoulderWidth);
  const chest = getClampedBodyMeasurementValue(measurements, "chest", heightCm, heightCm * 0.535, shoulderWidth);
  const waist = getClampedBodyMeasurementValue(measurements, "waist", heightCm, heightCm * 0.43, shoulderWidth);
  const hips = getClampedBodyMeasurementValue(measurements, "hips", heightCm, heightCm * 0.525, shoulderWidth);
  const thigh = getClampedBodyMeasurementValue(measurements, "thigh", heightCm, heightCm * 0.31, shoulderWidth);
  const inseam = getClampedBodyMeasurementValue(measurements, "inseam", heightCm, heightCm * 0.455, shoulderWidth);
  const sleeveLength = getClampedBodyMeasurementValue(measurements, "sleeveLength", heightCm, heightCm * 0.335, shoulderWidth);
  const segments = 36;
  const shoulderHalf = shoulderWidth / 2;
  const crotchY = clamp(inseam, heightCm * 0.41, heightCm * 0.52);
  const hipY = clamp(crotchY + heightCm * 0.055, heightCm * 0.48, heightCm * 0.57);
  const waistY = heightCm * 0.62;
  const lowerRibY = heightCm * 0.68;
  const chestY = heightCm * 0.735;
  const shoulderY = heightCm * 0.825;
  const neckBaseY = heightCm * 0.872;
  const headTopY = heightCm;
  const ankleY = heightCm * 0.055;
  const kneeY = clamp(ankleY + (crotchY - ankleY) * 0.48, heightCm * 0.245, heightCm * 0.335);
  const calfY = (ankleY + kneeY) / 2;
  const midThighY = kneeY + (crotchY - kneeY) * 0.58;
  const wristY = clamp(shoulderY - sleeveLength * 0.96, heightCm * 0.46, shoulderY - heightCm * 0.17);
  const elbowY = shoulderY - (shoulderY - wristY) * 0.52;
  const chestRadii = getClampedEllipseRadii(chest, 0.7, shoulderWidth * 0.82, shoulderWidth * 1.08);
  const waistRadii = getClampedEllipseRadii(waist, 0.72, shoulderWidth * 0.62, shoulderWidth * 1.04);
  const hipRadii = getClampedEllipseRadii(hips, 0.74, shoulderWidth * 0.78, shoulderWidth * 1.16);
  const neckRadii = getClampedEllipseRadii(neck, 0.86, shoulderWidth * 0.25, shoulderWidth * 0.38);
  const thighRadii = getClampedEllipseRadii(thigh, 0.94, shoulderWidth * 0.34, shoulderWidth * 0.58);
  const torsoRings = [
    { radiusX: hipRadii.radiusX * 0.32, radiusZ: hipRadii.radiusZ * 0.42, y: crotchY - heightCm * 0.006 },
    { radiusX: hipRadii.radiusX * 0.62, radiusZ: hipRadii.radiusZ * 0.72, y: crotchY + heightCm * 0.028 },
    { radiusX: hipRadii.radiusX * 0.94, radiusZ: hipRadii.radiusZ, y: hipY },
    { radiusX: waistRadii.radiusX * 1.01, radiusZ: waistRadii.radiusZ, y: waistY },
    { radiusX: waistRadii.radiusX * 0.9 + chestRadii.radiusX * 0.1, radiusZ: waistRadii.radiusZ * 0.9 + chestRadii.radiusZ * 0.1, y: lowerRibY },
    { radiusX: chestRadii.radiusX, radiusZ: chestRadii.radiusZ, y: chestY },
    { radiusX: shoulderHalf * 0.94, radiusZ: chestRadii.radiusZ * 0.82, y: shoulderY - heightCm * 0.012 },
    { radiusX: neckRadii.radiusX * 1.34, radiusZ: neckRadii.radiusZ * 1.06, y: neckBaseY },
  ];

  addRingedSurface(builder, torsoRings, segments, { capBottom: true, capTop: false });
  addRingedSurface(
    builder,
    [
      { radiusX: neckRadii.radiusX * 0.98, radiusZ: neckRadii.radiusZ * 0.98, y: neckBaseY - heightCm * 0.006 },
      { radiusX: neckRadii.radiusX * 0.9, radiusZ: neckRadii.radiusZ * 0.9, y: neckBaseY + heightCm * 0.042 },
    ],
    segments,
    { capBottom: false, capTop: false },
  );
  addEllipsoid(
    builder,
    { x: 0, y: (neckBaseY + headTopY) / 2, z: 0 },
    {
      radiusX: heightCm * 0.052,
      radiusY: Math.max(heightCm * 0.061, (headTopY - neckBaseY) / 2),
      radiusZ: heightCm * 0.058,
    },
    30,
    18,
  );
  addEllipsoid(
    builder,
    { x: 0, y: heightCm * 0.942, z: heightCm * 0.058 },
    {
      radiusX: heightCm * 0.008,
      radiusY: heightCm * 0.014,
      radiusZ: heightCm * 0.011,
    },
    12,
    8,
  );

  const legSpacing = Math.max(thighRadii.radiusX * 1.08, hipRadii.radiusX * 0.52);
  for (const side of [-1, 1]) {
    addRingedSurface(
      builder,
      [
        {
          centerX: side * legSpacing * 0.98,
          radiusX: heightCm * 0.018,
          radiusZ: heightCm * 0.021,
          y: ankleY,
        },
        {
          centerX: side * legSpacing,
          radiusX: thighRadii.radiusX * 0.52,
          radiusZ: thighRadii.radiusZ * 0.54,
          y: calfY,
        },
        {
          centerX: side * legSpacing * 1.02,
          radiusX: thighRadii.radiusX * 0.48,
          radiusZ: thighRadii.radiusZ * 0.48,
          y: kneeY,
        },
        {
          centerX: side * legSpacing,
          radiusX: thighRadii.radiusX * 0.9,
          radiusZ: thighRadii.radiusZ * 0.9,
          y: midThighY,
        },
        {
          centerX: side * legSpacing * 0.94,
          radiusX: thighRadii.radiusX * 0.96,
          radiusZ: thighRadii.radiusZ,
          y: crotchY,
        },
      ],
      24,
      { capBottom: true, capTop: true },
    );

    addEllipsoid(
      builder,
      { x: side * legSpacing * 0.98, y: heightCm * 0.018, z: heightCm * 0.032 },
      {
        radiusX: heightCm * 0.026,
        radiusY: heightCm * 0.014,
        radiusZ: heightCm * 0.064,
      },
      18,
      8,
    );
  }

  const upperArmRadius = clamp(chest / 2 / Math.PI * 0.23, heightCm * 0.022, heightCm * 0.037);
  const forearmRadius = upperArmRadius * 0.72;
  const wristRadius = heightCm * 0.015;
  for (const side of [-1, 1]) {
    const shoulderX = side * (shoulderHalf + upperArmRadius * 0.55);
    const elbowX = side * (shoulderHalf + upperArmRadius * 0.18);
    const wristX = side * (shoulderHalf * 0.86);

    addEllipsoid(
      builder,
      { x: side * shoulderHalf * 0.96, y: shoulderY - heightCm * 0.018, z: 0 },
      {
        radiusX: upperArmRadius * 1.25,
        radiusY: upperArmRadius * 1.05,
        radiusZ: upperArmRadius * 1.18,
      },
      16,
      10,
    );

    addRingedSurface(
      builder,
      [
        {
          centerX: shoulderX,
          radiusX: upperArmRadius,
          radiusZ: upperArmRadius * 0.92,
          y: shoulderY - heightCm * 0.012,
        },
        {
          centerX: elbowX,
          radiusX: forearmRadius,
          radiusZ: forearmRadius * 0.9,
          y: elbowY,
        },
        {
          centerX: wristX,
          radiusX: wristRadius,
          radiusZ: wristRadius * 0.92,
          y: wristY,
        },
      ],
      18,
      { capBottom: true, capTop: true },
    );

    addEllipsoid(
      builder,
      { x: wristX, y: wristY - heightCm * 0.012, z: 0 },
      {
        radiusX: heightCm * 0.017,
        radiusY: heightCm * 0.026,
        radiusZ: heightCm * 0.014,
      },
      16,
      8,
    );
  }

  return {
    landmarks: {
      headTop: [0, roundMeasurement(headTopY), 0],
      leftShoulder: [roundMeasurement(-shoulderHalf), roundMeasurement(shoulderY), 0],
      rightShoulder: [roundMeasurement(shoulderHalf), roundMeasurement(shoulderY), 0],
      leftHip: [roundMeasurement(-hipRadii.radiusX * 0.52), roundMeasurement(hipY), 0],
      rightHip: [roundMeasurement(hipRadii.radiusX * 0.52), roundMeasurement(hipY), 0],
      floor: [0, 0, 0],
    },
    mesh: {
      faces: builder.faces,
      vertexCount: builder.vertices.length,
      vertices: builder.vertices,
    },
  };
}

function createMeshBuilder() {
  return {
    faces: [],
    vertices: [],
  };
}

function addVertex(builder, x, y, z) {
  const index = builder.vertices.length;
  builder.vertices.push([
    roundMeshValue(x),
    roundMeshValue(y),
    roundMeshValue(z),
  ]);
  return index;
}

function addFace(builder, first, second, third) {
  builder.faces.push([first, second, third]);
}

function addRingedSurface(builder, rings, segments, options = {}) {
  const ringIndices = rings.map((ring) => {
    const centerX = Number(ring.centerX ?? 0);
    const centerZ = Number(ring.centerZ ?? 0);

    return Array.from({ length: segments }, (_value, index) => {
      const angle = index / segments * Math.PI * 2;
      return addVertex(
        builder,
        centerX + Math.cos(angle) * ring.radiusX,
        ring.y,
        centerZ + Math.sin(angle) * ring.radiusZ,
      );
    });
  });

  for (let ringIndex = 0; ringIndex < ringIndices.length - 1; ringIndex += 1) {
    const currentRing = ringIndices[ringIndex];
    const nextRing = ringIndices[ringIndex + 1];

    for (let index = 0; index < segments; index += 1) {
      const nextIndex = (index + 1) % segments;
      addFace(builder, currentRing[index], nextRing[index], currentRing[nextIndex]);
      addFace(builder, currentRing[nextIndex], nextRing[index], nextRing[nextIndex]);
    }
  }

  if (options.capBottom && ringIndices[0]) {
    capRing(builder, ringIndices[0], rings[0], false);
  }

  if (options.capTop && ringIndices.at(-1)) {
    capRing(builder, ringIndices.at(-1), rings.at(-1), true);
  }
}

function capRing(builder, ringIndices, ring, isTop) {
  const center = addVertex(builder, ring.centerX ?? 0, ring.y, ring.centerZ ?? 0);

  for (let index = 0; index < ringIndices.length; index += 1) {
    const nextIndex = (index + 1) % ringIndices.length;

    if (isTop) {
      addFace(builder, center, ringIndices[index], ringIndices[nextIndex]);
    } else {
      addFace(builder, center, ringIndices[nextIndex], ringIndices[index]);
    }
  }
}

function addEllipsoid(builder, center, radii, widthSegments, heightSegments) {
  const rows = [];

  for (let row = 0; row <= heightSegments; row += 1) {
    const v = row / heightSegments;
    const phi = -Math.PI / 2 + v * Math.PI;
    const y = center.y + Math.sin(phi) * radii.radiusY;
    const ringRadius = Math.cos(phi);
    const rowIndices = [];

    for (let column = 0; column < widthSegments; column += 1) {
      const theta = column / widthSegments * Math.PI * 2;
      rowIndices.push(
        addVertex(
          builder,
          center.x + Math.cos(theta) * radii.radiusX * ringRadius,
          y,
          center.z + Math.sin(theta) * radii.radiusZ * ringRadius,
        ),
      );
    }

    rows.push(rowIndices);
  }

  for (let row = 0; row < rows.length - 1; row += 1) {
    for (let column = 0; column < widthSegments; column += 1) {
      const nextColumn = (column + 1) % widthSegments;
      addFace(builder, rows[row][column], rows[row + 1][column], rows[row][nextColumn]);
      addFace(builder, rows[row][nextColumn], rows[row + 1][column], rows[row + 1][nextColumn]);
    }
  }
}

function getEllipseRadii(circumference, depthRatio, targetWidth) {
  if (Number.isFinite(targetWidth) && targetWidth > 0) {
    const radiusX = targetWidth / 2;
    const radiusZ = solveEllipseRadiusZ(circumference, radiusX, radiusX * depthRatio);

    return {
      radiusX,
      radiusZ,
    };
  }

  const circularRadius = circumference / (2 * Math.PI);

  return {
    radiusX: circularRadius / Math.sqrt((1 + depthRatio * depthRatio) / 2),
    radiusZ: circularRadius * depthRatio / Math.sqrt((1 + depthRatio * depthRatio) / 2),
  };
}

function getClampedEllipseRadii(circumference, depthRatio, minWidth, maxWidth) {
  const baseRadii = getEllipseRadii(circumference, depthRatio);
  const radiusX = clamp(baseRadii.radiusX, minWidth / 2, maxWidth / 2);
  const solvedRadiusZ = solveEllipseRadiusZ(circumference, radiusX, radiusX * depthRatio);
  const radiusZ = clamp(solvedRadiusZ, radiusX * 0.38, radiusX * 0.88);

  return {
    radiusX,
    radiusZ,
  };
}

function solveEllipseRadiusZ(circumference, radiusX, fallbackRadiusZ) {
  const target = Number(circumference);

  if (!Number.isFinite(target) || target <= 0 || !Number.isFinite(radiusX) || radiusX <= 0) {
    return fallbackRadiusZ;
  }

  let low = Math.max(radiusX * 0.18, 0.5);
  let high = Math.max(radiusX * 1.65, low + 1);

  for (let index = 0; index < 28; index += 1) {
    const middle = (low + high) / 2;
    const estimated = approximateEllipseCircumference(radiusX, middle);

    if (estimated > target) {
      high = middle;
    } else {
      low = middle;
    }
  }

  const solved = (low + high) / 2;
  return Number.isFinite(solved) ? solved : fallbackRadiusZ;
}

function approximateEllipseCircumference(radiusX, radiusZ) {
  return Math.PI * (3 * (radiusX + radiusZ) - Math.sqrt((3 * radiusX + radiusZ) * (radiusX + 3 * radiusZ)));
}

function roundMeshValue(value) {
  return Math.round(value * 1000) / 1000;
}

async function readArchiveBundle(archiveFile) {
  const archiveBytes = await readFile(resolveUploadFile(archiveFile));
  const files = unzipSync(new Uint8Array(archiveBytes));
  const manifestBytes = files["manifest.json"];
  const manifest = manifestBytes ? JSON.parse(strFromU8(manifestBytes)) : null;

  return {
    files,
    manifest,
  };
}

function getSubjectHeightCm(manifest) {
  const candidates = [
    manifest?.session?.subject?.heightCm,
    manifest?.subject?.heightCm,
  ];

  for (const candidate of candidates) {
    const height = Number(candidate);

    if (Number.isFinite(height) && height >= minimumHeightCm && height <= maximumHeightCm) {
      return roundMeasurement(height);
    }
  }

  return null;
}

function analyzeMeasurementFrame(frame, frameBytes) {
  const poseBounds = normalizeBounds(frame.vision?.bodyBounds);
  const keypoints = normalizeKeypoints(frame.vision?.keypoints);
  const segmentation = normalizeSegmentation(frame.vision?.segmentation, frame, keypoints);
  const fallbackBounds = getGuideFallbackBounds(frame);
  const silhouette = frameBytes
    ? analyzeSilhouetteFrame(
        frameBytes,
        keypoints,
        segmentation?.bodyBounds ?? poseBounds ?? fallbackBounds,
      )
    : null;
  const bodyBounds =
    segmentation?.bodyBounds ??
    silhouette?.bodyBounds ??
    poseBounds ??
    fallbackBounds;
  const rowWidths = mergeRowWidths(segmentation?.rowWidths, silhouette?.rowWidths);
  const bodyBoundsSource = segmentation?.bodyBounds
    ? "person-segmentation-mask"
    : silhouette?.bodyBoundsSource
      ? silhouette.bodyBoundsSource
      : silhouette?.bodyBounds
        ? "silhouette"
        : poseBounds
          ? "pose-landmarks"
          : "scan-guide-fallback";

  return {
    bodyBounds,
    bodyBoundsSource,
    frame,
    hasSavedPose: keypoints.size > 0,
    keypoints,
    rowWidths,
    segmentationMask: segmentation?.mask ?? null,
    sampleCount: 1,
    sourceFrames: [frame.fileName].filter(Boolean),
    score: getFrameAnalysisScore(
      frame,
      bodyBounds,
      keypoints.size,
      bodyBoundsSource,
      silhouette?.bodyBounds,
    ),
  };
}

function analyzeSilhouetteFrame(frameBytes, keypoints, guideBounds) {
  let decoded;

  try {
    decoded = jpeg.decode(Buffer.from(frameBytes), { useTArray: true });
  } catch {
    return null;
  }

  const thresholdBounds = findForegroundBounds(decoded);
  const bounds =
    thresholdBounds ??
    (guideBounds ? expandBounds(guideBounds, decoded.width, decoded.height, 0.24, 0.1) : null);

  if (!bounds) {
    return null;
  }

  const hasPoseGuidance = keypoints.size > 0;
  const rowWidths = hasPoseGuidance
    ? getPoseGuidedRowWidths(decoded, bounds, keypoints)
    : {
        chest: getForegroundWidthAtRatio(decoded, bounds, 0.34),
        hips: getForegroundWidthAtRatio(decoded, bounds, 0.6),
        shoulder: getForegroundWidthAtRatio(decoded, bounds, 0.24),
        waist: getForegroundWidthAtRatio(decoded, bounds, 0.5),
      };

  return {
    bodyBounds: bounds,
    bodyBoundsSource: thresholdBounds
      ? hasPoseGuidance
        ? "pose-guided-silhouette"
        : "silhouette"
      : "pose-guided-pose-scale",
    rowWidths,
  };
}

function normalizeSegmentation(segmentation, frame, keypoints) {
  if (!segmentation || typeof segmentation !== "object") {
    return null;
  }

  const mask = normalizeSegmentationMask(segmentation.mask);
  const bodyBounds =
    normalizeBounds(segmentation.bodyBounds) ??
    (mask ? getBoundsFromCompactSegmentationMask(mask, frame) : null);
  const maskRowWidths = mask && bodyBounds
    ? getCompactMaskRowWidths(mask, bodyBounds, frame, keypoints)
    : null;
  const rowWidths = mergeRowWidths(normalizeRowWidths(segmentation.rowWidths), maskRowWidths);

  if (!bodyBounds && !rowWidths) {
    return null;
  }

  return {
    bodyBounds,
    mask,
    rowWidths,
  };
}

function normalizeSegmentationMask(mask) {
  if (!mask || mask.encoding !== "rle" || !Array.isArray(mask.counts)) {
    return null;
  }

  const width = Number(mask.width);
  const height = Number(mask.height);

  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return null;
  }

  const expectedLength = width * height;
  const values = new Uint8Array(expectedLength);
  let offset = 0;
  let value = 0;

  for (const rawCount of mask.counts) {
    const count = Number(rawCount);

    if (!Number.isInteger(count) || count < 0 || offset + count > expectedLength) {
      return null;
    }

    if (value === 1 && count > 0) {
      values.fill(1, offset, offset + count);
    }

    offset += count;
    value = value === 1 ? 0 : 1;
  }

  if (offset !== expectedLength) {
    return null;
  }

  return {
    height,
    values,
    width,
  };
}

function getBoundsFromCompactSegmentationMask(mask, frame) {
  const frameWidth = Number(frame.width);
  const frameHeight = Number(frame.height);

  if (!Number.isFinite(frameWidth) || !Number.isFinite(frameHeight) || frameWidth <= 0 || frameHeight <= 0) {
    return null;
  }

  let left = mask.width;
  let right = 0;
  let top = mask.height;
  let bottom = 0;
  let count = 0;

  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if (mask.values[y * mask.width + x] !== 1) {
        continue;
      }

      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      count += 1;
    }
  }

  if (count < 24 || right <= left || bottom <= top) {
    return null;
  }

  const scaleX = frameWidth / mask.width;
  const scaleY = frameHeight / mask.height;

  return {
    bottom: Math.min(frameHeight - 1, (bottom + 1) * scaleY),
    height: (bottom - top + 1) * scaleY,
    left: left * scaleX,
    right: Math.min(frameWidth - 1, (right + 1) * scaleX),
    top: top * scaleY,
    width: (right - left + 1) * scaleX,
  };
}

function getCompactMaskRowWidths(mask, bounds, frame, keypoints) {
  const frameWidth = Number(frame.width);
  const frameHeight = Number(frame.height);

  if (!Number.isFinite(frameWidth) || !Number.isFinite(frameHeight) || frameWidth <= 0 || frameHeight <= 0) {
    return null;
  }

  const rowTargets = getMeasurementRowTargets(keypoints, bounds);

  return Object.fromEntries(
    Object.entries(rowTargets).map(([key, target]) => [
      key,
      getCompactMaskWidthAtRow(mask, bounds, target, frameWidth, frameHeight),
    ]),
  );
}

function getCompactMaskWidthAtRow(mask, bounds, target, frameWidth, frameHeight) {
  const scaleX = mask.width / frameWidth;
  const scaleY = mask.height / frameHeight;
  const targetY = clamp(Math.round(target.y * scaleY), 0, mask.height - 1);
  const centerXs = (target.centerXs ?? [target.centerX])
    .filter((value) => Number.isFinite(value))
    .map((value) => clamp(Math.round(value * scaleX), 0, mask.width - 1));
  const band = Math.max(1, Math.round(mask.height * 0.006));
  const minY = Math.max(0, targetY - band);
  const maxY = Math.min(mask.height - 1, targetY + band);
  const defaultMinX = bounds.left - frameWidth * 0.035;
  const defaultMaxX = bounds.right + frameWidth * 0.035;
  const minX = Math.max(0, Math.round((target.minX ?? defaultMinX) * scaleX));
  const maxX = Math.min(mask.width - 1, Math.round((target.maxX ?? defaultMaxX) * scaleX));
  const searchRadius = target.searchRadius
    ? Math.max(2, Math.round(target.searchRadius * scaleX))
    : null;
  const widths = [];

  for (let y = minY; y <= maxY; y += 1) {
    const rowWidths = centerXs
      .map((centerX) => {
        const localMinX = searchRadius ? Math.max(minX, centerX - searchRadius) : minX;
        const localMaxX = searchRadius ? Math.min(maxX, centerX + searchRadius) : maxX;
        const run = findCompactMaskRunAtRow(mask, y, localMinX, localMaxX, centerX);

        return run ? (run.right - run.left) / scaleX : null;
      })
      .filter((value) => Number.isFinite(value) && value > 0);

    if (rowWidths.length > 0) {
      widths.push(getRobustMedian(rowWidths));
    }
  }

  return getRobustMedian(widths);
}

function findCompactMaskRunAtRow(mask, y, minX, maxX, centerX) {
  const runs = [];
  let activeRun = null;

  for (let x = minX; x <= maxX; x += 1) {
    if (mask.values[y * mask.width + x] === 1) {
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
    .filter((run) => run.right - run.left >= 2)
    .sort((left, right) => {
      const leftDistance = getRunDistanceFromCenter(left, centerX);
      const rightDistance = getRunDistanceFromCenter(right, centerX);

      return leftDistance - rightDistance;
    })[0] ?? null;
}

function normalizeRowWidths(rowWidths) {
  if (!rowWidths || typeof rowWidths !== "object") {
    return null;
  }

  const normalized = {};

  for (const key of measurementRowWidthKeys) {
    const width = Number(rowWidths[key]);

    if (Number.isFinite(width) && width > 0) {
      normalized[key] = width;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function mergeRowWidths(primary, fallback) {
  const merged = {};

  for (const source of [fallback, primary]) {
    if (!source || typeof source !== "object") {
      continue;
    }

    for (const key of measurementRowWidthKeys) {
      const width = Number(source[key]);

      if (Number.isFinite(width) && width > 0) {
        merged[key] = width;
      }
    }
  }

  return Object.keys(merged).length > 0 ? merged : null;
}

function getPoseGuidedRowWidths(decoded, bounds, keypoints) {
  const rowTargets = getMeasurementRowTargets(keypoints, bounds);

  return Object.fromEntries(
    Object.entries(rowTargets).map(([key, target]) => [
      key,
      getMeasurementWidthAtRow(decoded, bounds, target),
    ]),
  );
}

function findForegroundBounds(decoded) {
  const { data, height, width } = decoded;
  const minX = Math.round(width * 0.12);
  const maxX = Math.round(width * 0.88);
  const minY = Math.round(height * 0.12);
  const maxY = Math.round(height * 0.97);
  let left = width;
  let right = 0;
  let top = height;
  let bottom = 0;
  let count = 0;

  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      const pixelIndex = (y * width + x) * 4;

      if (!isForegroundPixel(data, pixelIndex)) {
        continue;
      }

      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      count += 1;
    }
  }

  if (count < 200 || right <= left || bottom <= top) {
    return null;
  }

  return {
    bottom,
    height: bottom - top,
    left,
    right,
    top,
    width: right - left,
  };
}

function getForegroundWidthAtRatio(decoded, bounds, ratio) {
  const { data, height, width } = decoded;
  const targetY = Math.round(bounds.top + bounds.height * ratio);
  const band = Math.max(8, Math.round(height * 0.009));
  const minY = Math.max(0, targetY - band);
  const maxY = Math.min(height - 1, targetY + band);
  const minX = Math.max(0, Math.round(bounds.left - width * 0.03));
  const maxX = Math.min(width - 1, Math.round(bounds.right + width * 0.03));
  let left = width;
  let right = 0;
  let count = 0;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const pixelIndex = (y * width + x) * 4;

      if (!isForegroundPixel(data, pixelIndex)) {
        continue;
      }

      left = Math.min(left, x);
      right = Math.max(right, x);
      count += 1;
    }
  }

  if (count < 8 || right <= left) {
    return null;
  }

  return right - left;
}

function getMeasurementRowTargets(keypoints, bounds) {
  const shoulderCenter = getMidpoint(
    keypoints.get("left_shoulder"),
    keypoints.get("right_shoulder"),
  );
  const hipCenter = getMidpoint(keypoints.get("left_hip"), keypoints.get("right_hip"));
  const leftShoulder = keypoints.get("left_shoulder");
  const rightShoulder = keypoints.get("right_shoulder");
  const leftHip = keypoints.get("left_hip");
  const rightHip = keypoints.get("right_hip");
  const leftKnee = keypoints.get("left_knee");
  const rightKnee = keypoints.get("right_knee");
  const fallbackCenterX = bounds.left + bounds.width / 2;

  if (
    shoulderCenter &&
    hipCenter &&
    leftShoulder &&
    rightShoulder &&
    leftHip &&
    rightHip &&
    hipCenter.y > shoulderCenter.y
  ) {
    const torsoHeight = hipCenter.y - shoulderCenter.y;
    const centerX = getRobustMedian([shoulderCenter.x, hipCenter.x]) ?? fallbackCenterX;
    const shoulderLeft = Math.min(leftShoulder.x, rightShoulder.x);
    const shoulderRight = Math.max(leftShoulder.x, rightShoulder.x);
    const hipLeft = Math.min(leftHip.x, rightHip.x);
    const hipRight = Math.max(leftHip.x, rightHip.x);
    const shoulderSpan = shoulderRight - shoulderLeft;
    const hipSpan = hipRight - hipLeft;
    const torsoWindow = (topWidthRatio, hipWidthRatio, paddingRatio = 0.28) => {
      const left = shoulderLeft * topWidthRatio + hipLeft * hipWidthRatio;
      const right = shoulderRight * topWidthRatio + hipRight * hipWidthRatio;
      const width = Math.max(shoulderSpan, hipSpan, right - left, bounds.width * 0.22);
      const padding = width * paddingRatio;

      return {
        maxX: Math.min(bounds.right, right + padding),
        minX: Math.max(bounds.left, left - padding),
      };
    };
    const thighCenters = [
      leftKnee ? (leftHip.x + leftKnee.x) / 2 : leftHip.x,
      rightKnee ? (rightHip.x + rightKnee.x) / 2 : rightHip.x,
    ].filter((value) => Number.isFinite(value));
    const thighSearchRadius = Math.max(bounds.width * 0.09, hipSpan * 0.22, 12);

    return {
      neck: {
        centerX: shoulderCenter.x,
        ...torsoWindow(1, 0, 0.08),
        y: Math.max(bounds.top, shoulderCenter.y - torsoHeight * 0.16),
      },
      chest: {
        centerX,
        ...torsoWindow(0.82, 0.18, 0.16),
        y: shoulderCenter.y + torsoHeight * 0.22,
      },
      hips: {
        centerX,
        ...torsoWindow(0.05, 0.95, 0.24),
        y: hipCenter.y + torsoHeight * 0.06,
      },
      shoulder: {
        centerX: shoulderCenter.x,
        maxX: Math.min(bounds.right, shoulderRight + shoulderSpan * 0.08),
        minX: Math.max(bounds.left, shoulderLeft - shoulderSpan * 0.08),
        y: shoulderCenter.y,
      },
      thigh: {
        centerX: thighCenters[0] ?? centerX,
        centerXs: thighCenters.length > 0 ? thighCenters : [centerX],
        maxX: Math.min(bounds.right, Math.max(...thighCenters, centerX) + thighSearchRadius),
        minX: Math.max(bounds.left, Math.min(...thighCenters, centerX) - thighSearchRadius),
        searchRadius: thighSearchRadius,
        y: hipCenter.y + torsoHeight * 0.48,
      },
      waist: {
        centerX,
        ...torsoWindow(0.36, 0.64, 0.16),
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

function getMeasurementWidthAtRow(decoded, bounds, target) {
  const contrastWidth = target.centerXs || target.searchRadius
    ? null
    : getContrastEdgeWidthAtRow(decoded, bounds, target);

  if (contrastWidth) {
    return contrastWidth;
  }

  return getForegroundWidthAtRow(decoded, bounds, target);
}

function getContrastEdgeWidthAtRow(decoded, bounds, target) {
  const profile = getLuminanceProfile(decoded, bounds, target);

  if (!profile) {
    return null;
  }

  const centerX = clamp(Math.round(target.centerX), profile.minX + 2, profile.maxX - 2);
  const minimumWidth = Math.max(18, bounds.width * 0.24);
  const maximumWidth = Math.max(minimumWidth + 8, bounds.width * 1.24);
  const leftEdge = findStrongestProfileEdge(
    profile,
    profile.minX,
    Math.max(profile.minX + 2, centerX - Math.round(minimumWidth * 0.2)),
  );
  const rightEdge = findStrongestProfileEdge(
    profile,
    Math.min(profile.maxX - 2, centerX + Math.round(minimumWidth * 0.2)),
    profile.maxX,
  );

  if (!leftEdge || !rightEdge || rightEdge <= leftEdge) {
    return null;
  }

  const measuredWidth = rightEdge - leftEdge;

  if (measuredWidth < minimumWidth || measuredWidth > maximumWidth) {
    return null;
  }

  return measuredWidth;
}

function getForegroundWidthAtRow(decoded, bounds, target) {
  const { data, height, width } = decoded;
  const targetY = clamp(Math.round(target.y), 0, height - 1);
  const centerXs = (target.centerXs ?? [target.centerX])
    .filter((value) => Number.isFinite(value))
    .map((value) => clamp(Math.round(value), 0, width - 1));
  const band = Math.max(8, Math.round(height * 0.009));
  const minY = Math.max(0, targetY - band);
  const maxY = Math.min(height - 1, targetY + band);
  const minX = Math.max(0, Math.round(target.minX ?? bounds.left - width * 0.04));
  const maxX = Math.min(width - 1, Math.round(target.maxX ?? bounds.right + width * 0.04));
  const searchRadius = target.searchRadius ? Math.max(8, Math.round(target.searchRadius)) : null;
  const widths = [];

  for (let y = minY; y <= maxY; y += 1) {
    const rowWidths = centerXs
      .map((centerX) => {
        const localMinX = searchRadius ? Math.max(minX, centerX - searchRadius) : minX;
        const localMaxX = searchRadius ? Math.min(maxX, centerX + searchRadius) : maxX;
        const run = findForegroundRunAtRow(data, width, y, localMinX, localMaxX, centerX);

        return run ? run.right - run.left : null;
      })
      .filter((value) => Number.isFinite(value) && value > 0);

    if (rowWidths.length > 0) {
      widths.push(getRobustMedian(rowWidths));
    }
  }

  return getRobustMedian(widths);
}

function getLuminanceProfile(decoded, bounds, target) {
  const { data, height, width } = decoded;
  const targetY = clamp(Math.round(target.y), 0, height - 1);
  const band = Math.max(5, Math.round(height * 0.006));
  const minY = Math.max(0, targetY - band);
  const maxY = Math.min(height - 1, targetY + band);
  const minX = Math.max(0, Math.round(target.minX ?? bounds.left - width * 0.08));
  const maxX = Math.min(width - 1, Math.round(target.maxX ?? bounds.right + width * 0.08));

  if (maxX - minX < 24) {
    return null;
  }

  const values = [];

  for (let x = minX; x <= maxX; x += 1) {
    let total = 0;
    let count = 0;

    for (let y = minY; y <= maxY; y += 1) {
      const pixelIndex = (y * width + x) * 4;
      total += getPixelLuminance(data, pixelIndex);
      count += 1;
    }

    values.push(total / Math.max(1, count));
  }

  return {
    maxX,
    minX,
    values,
  };
}

function findStrongestProfileEdge(profile, minX, maxX) {
  const { values } = profile;
  const windowRadius = 4;
  const localMin = Math.max(0, minX - profile.minX);
  const localMax = Math.min(values.length - 1, maxX - profile.minX);
  let bestScore = 0;
  let bestX = null;

  for (let x = localMin + windowRadius; x <= localMax - windowRadius; x += 1) {
    const left = getAverageProfileValue(values, x - windowRadius, x - 1);
    const right = getAverageProfileValue(values, x + 1, x + windowRadius);
    const score = Math.abs(right - left);

    if (score > bestScore) {
      bestScore = score;
      bestX = x;
    }
  }

  if (bestScore < 7 || bestX === null) {
    return null;
  }

  return profile.minX + bestX;
}

function getAverageProfileValue(values, start, end) {
  let total = 0;
  let count = 0;

  for (let index = Math.max(0, start); index <= Math.min(values.length - 1, end); index += 1) {
    total += values[index];
    count += 1;
  }

  return count > 0 ? total / count : 0;
}

function findForegroundRunAtRow(data, width, y, minX, maxX, centerX) {
  const runs = [];
  let activeRun = null;

  for (let x = minX; x <= maxX; x += 1) {
    const pixelIndex = (y * width + x) * 4;

    if (isForegroundPixel(data, pixelIndex)) {
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

  if (runs.length === 0) {
    return null;
  }

  return runs
    .filter((run) => run.right - run.left >= 8)
    .sort((left, right) => {
      const leftDistance = getRunDistanceFromCenter(left, centerX);
      const rightDistance = getRunDistanceFromCenter(right, centerX);

      return leftDistance - rightDistance;
    })[0] ?? null;
}

function getRunDistanceFromCenter(run, centerX) {
  if (centerX >= run.left && centerX <= run.right) {
    return 0;
  }

  return Math.min(Math.abs(centerX - run.left), Math.abs(centerX - run.right));
}

function isForegroundPixel(data, pixelIndex) {
  const red = data[pixelIndex];
  const green = data[pixelIndex + 1];
  const blue = data[pixelIndex + 2];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  const chroma = max - min;

  return (luma > 138 && chroma < 95) || (luma > 112 && chroma > 52);
}

function getPixelLuminance(data, pixelIndex) {
  return data[pixelIndex] * 0.2126 +
    data[pixelIndex + 1] * 0.7152 +
    data[pixelIndex + 2] * 0.0722;
}

function normalizeBounds(bounds) {
  if (!bounds) {
    return null;
  }

  const left = Number(bounds.left);
  const right = Number(bounds.right);
  const top = Number(bounds.top);
  const bottom = Number(bounds.bottom);
  const width = Number(bounds.width);
  const height = Number(bounds.height);

  if (
    [left, right, top, bottom, width, height].some((value) => !Number.isFinite(value)) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  return {
    bottom,
    height,
    left,
    right,
    top,
    width,
  };
}

function normalizeKeypoints(keypoints) {
  const normalized = new Map();

  if (!Array.isArray(keypoints)) {
    return normalized;
  }

  for (const keypoint of keypoints) {
    const name = String(keypoint?.name ?? "");
    const x = Number(keypoint?.x);
    const y = Number(keypoint?.y);
    const score = Number(keypoint?.score ?? 0);

    if (!name || !Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }

    normalized.set(name, {
      name,
      score: Number.isFinite(score) ? score : null,
      x,
      y,
    });
  }

  return normalized;
}

function getMidpoint(first, second) {
  if (!first || !second) {
    return null;
  }

  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  };
}

function expandBounds(bounds, imageWidth, imageHeight, horizontalRatio, verticalRatio) {
  const horizontalPadding = bounds.width * horizontalRatio;
  const verticalPadding = bounds.height * verticalRatio;
  const left = clamp(bounds.left - horizontalPadding, 0, imageWidth - 1);
  const right = clamp(bounds.right + horizontalPadding, 0, imageWidth - 1);
  const top = clamp(bounds.top - verticalPadding, 0, imageHeight - 1);
  const bottom = clamp(bounds.bottom + verticalPadding, 0, imageHeight - 1);

  return {
    bottom,
    height: bottom - top,
    left,
    right,
    top,
    width: right - left,
  };
}

function getGuideFallbackBounds(frame) {
  const width = Number(frame.width);
  const height = Number(frame.height);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  const top = height * 0.14;
  const bottom = height * 0.94;
  const left = width * 0.3;
  const right = width * 0.7;

  return {
    bottom,
    height: bottom - top,
    left,
    right,
    top,
    width: right - left,
  };
}

function getFrameAnalysisScore(frame, bounds, keypointCount, bodyBoundsSource, silhouetteBounds) {
  const width = Number(frame.width);
  const height = Number(frame.height);
  const phaseProgress = Number(frame.phaseProgress);
  const phaseScore = Number.isFinite(phaseProgress)
    ? 1 - Math.min(1, Math.abs(phaseProgress - 50) / 50)
    : 0;
  const bodyRatio = bounds && Number.isFinite(height) && height > 0 ? bounds.height / height : 0;
  const geometryBonus = bodyBoundsSource?.includes("person-segmentation-mask")
    ? 2.5
    : silhouetteBounds
      ? 1.5
      : keypointCount > 0
        ? 1
        : 0;
  const dimensionScore = Number.isFinite(width) && Number.isFinite(height) ? 1 : 0;

  return bodyRatio * 4 + phaseScore + keypointCount / 17 + geometryBonus + dimensionScore;
}

function chooseMeasurementFrame(analyses, states) {
  return analyses
    .filter((analysis) => states.includes(analysis.frame.state) && analysis.bodyBounds)
    .sort((left, right) => right.score - left.score)[0] ?? null;
}

function chooseMeasurementAggregate(analyses, states, heightCm) {
  const candidates = analyses
    .filter((analysis) => states.includes(analysis.frame.state) && analysis.bodyBounds)
    .sort((left, right) => right.score - left.score);

  if (candidates.length === 0) {
    return null;
  }

  const preferredCandidates = candidates.filter(
    (analysis) => analysis.bodyBoundsSource !== "scan-guide-fallback",
  );
  const selected = (preferredCandidates.length >= 2 ? preferredCandidates : candidates)
    .slice(0, 8);
  const representative = selected[0];
  const widthSamplesCm = {};

  for (const key of measurementRowWidthKeys) {
    const samples = selected
      .map((analysis) => {
        const scale = getCmPerPixel(analysis, heightCm);
        const widthPx = resolveWidthPx(analysis, key);

        return scale && widthPx ? widthPx * scale : null;
      })
      .filter((value) => Number.isFinite(value) && value > 0);

    const value = getRobustMedian(samples);

    if (value) {
      widthSamplesCm[key] = value;
    }
  }

  const keypoints = aggregateKeypoints(selected);
  const bodyBounds = aggregateBounds(selected.map((analysis) => analysis.bodyBounds));
  const sourceFrames = uniqueFrames(
    selected.flatMap((analysis) => analysis.sourceFrames ?? [analysis.frame.fileName]),
  );
  const sourceRank = selected.some((analysis) => analysis.bodyBoundsSource === "person-segmentation-mask")
    ? "multi-frame-person-segmentation-mask"
    : selected.some((analysis) => analysis.bodyBoundsSource === "pose-guided-silhouette")
    ? "multi-frame-pose-guided-silhouette"
    : selected.some((analysis) => analysis.bodyBoundsSource === "silhouette")
      ? "multi-frame-silhouette"
      : selected.some((analysis) => analysis.bodyBoundsSource.includes("pose"))
        ? "multi-frame-pose-landmarks"
        : "scan-guide-fallback";

  return {
    ...representative,
    bodyBounds: bodyBounds ?? representative.bodyBounds,
    bodyBoundsSource: sourceRank,
    hasSavedPose: keypoints.size > 0 || selected.some((analysis) => analysis.hasSavedPose),
    keypoints: keypoints.size > 0 ? keypoints : representative.keypoints,
    measurementWidthsCm: widthSamplesCm,
    sampleCount: selected.length,
    sourceFrames,
  };
}

function buildMeasurements({ frontFrame, heightCm, sideFrame }) {
  const calibrationFrame = frontFrame ?? sideFrame;
  const cmPerPixel = getCmPerPixel(calibrationFrame, heightCm);

  if (!cmPerPixel) {
    return [];
  }

  const frontScale = frontFrame ? getCmPerPixel(frontFrame, heightCm) ?? cmPerPixel : cmPerPixel;
  const sideScale = sideFrame ? getCmPerPixel(sideFrame, heightCm) ?? cmPerPixel : cmPerPixel;
  const rawNeckWidth = getLinearWidthCm({
    analysis: frontFrame,
    fallbackCm: heightCm * 0.07,
    key: "neck",
    scale: frontScale,
  });
  const shoulderWidth = clampLinearMeasurementEstimate(
    getLinearWidthCm({
      analysis: frontFrame,
      fallbackCm: heightCm * 0.255,
      key: "shoulder",
      scale: frontScale,
    }),
    "shoulderWidth",
    heightCm,
    null,
  );
  const neckWidth = clampLinearMeasurementEstimate(
    rawNeckWidth,
    "neckWidth",
    heightCm,
    shoulderWidth.valueCm,
  );
  const chestWidth = clampLinearMeasurementEstimate(getLinearWidthCm({
    analysis: frontFrame,
    fallbackCm: heightCm * 0.235,
    key: "chest",
    scale: frontScale,
  }), "chestWidth", heightCm, shoulderWidth.valueCm);
  const waistWidth = clampLinearMeasurementEstimate(getLinearWidthCm({
    analysis: frontFrame,
    fallbackCm: heightCm * 0.185,
    key: "waist",
    scale: frontScale,
  }), "waistWidth", heightCm, shoulderWidth.valueCm);
  const hipWidth = clampLinearMeasurementEstimate(getLinearWidthCm({
    analysis: frontFrame,
    fallbackCm: heightCm * 0.22,
    key: "hips",
    scale: frontScale,
  }), "hipWidth", heightCm, shoulderWidth.valueCm);
  const thighWidth = clampLinearMeasurementEstimate(getLinearWidthCm({
    analysis: frontFrame,
    fallbackCm: heightCm * 0.105,
    key: "thigh",
    scale: frontScale,
  }), "thighWidth", heightCm, shoulderWidth.valueCm);
  const neckDepth = clampDepthMeasurementEstimate(getDepthCm({
    fallbackRatio: 0.86,
    key: "neck",
    sideFrame,
    sideScale,
    widthCm: neckWidth.valueCm,
  }), "neck", neckWidth.valueCm);
  const chestDepth = clampDepthMeasurementEstimate(getDepthCm({
    fallbackRatio: 0.48,
    key: "chest",
    sideFrame,
    sideScale,
    widthCm: chestWidth.valueCm,
  }), "chest", chestWidth.valueCm);
  const waistDepth = clampDepthMeasurementEstimate(getDepthCm({
    fallbackRatio: 0.4,
    key: "waist",
    sideFrame,
    sideScale,
    widthCm: waistWidth.valueCm,
  }), "waist", waistWidth.valueCm);
  const hipDepth = clampDepthMeasurementEstimate(getDepthCm({
    fallbackRatio: 0.52,
    key: "hips",
    sideFrame,
    sideScale,
    widthCm: hipWidth.valueCm,
  }), "hips", hipWidth.valueCm);
  const thighDepth = clampDepthMeasurementEstimate(getDepthCm({
    fallbackRatio: 0.92,
    key: "thigh",
    sideFrame,
    sideScale,
    widthCm: thighWidth.valueCm,
  }), "thigh", thighWidth.valueCm);
  const inseam = getInseamCm(frontFrame, frontScale, heightCm);
  const sleeveLength = getSleeveLengthCm(frontFrame, frontScale, heightCm);

  return normalizeBodyMeasurements([
    {
      confidence: "high",
      key: "height",
      label: "Height",
      method: "User supplied height calibration",
      notes: ["Entered before upload and stored with the scan manifest."],
      sourceFrames: [],
      unit: "cm",
      valueCm: heightCm,
    },
    {
      confidence: combineConfidence(neckWidth.confidence, neckDepth.confidence),
      key: "neck",
      label: "Neck",
      method: "Height-calibrated front width and side-depth ellipse",
      notes: [...neckWidth.notes, ...neckDepth.notes],
      sourceFrames: uniqueFrames([...neckWidth.sourceFrames, ...neckDepth.sourceFrames]),
      unit: "cm",
      valueCm: ellipseCircumference(neckWidth.valueCm, neckDepth.valueCm),
    },
    {
      confidence: shoulderWidth.confidence,
      key: "shoulderWidth",
      label: "Shoulder width",
      method: shoulderWidth.method,
      notes: shoulderWidth.notes,
      sourceFrames: shoulderWidth.sourceFrames,
      unit: "cm",
      valueCm: shoulderWidth.valueCm,
    },
    {
      confidence: combineConfidence(chestWidth.confidence, chestDepth.confidence),
      key: "chest",
      label: "Chest",
      method: "Height-calibrated front width and side-depth ellipse",
      notes: [...chestWidth.notes, ...chestDepth.notes],
      sourceFrames: uniqueFrames([...chestWidth.sourceFrames, ...chestDepth.sourceFrames]),
      unit: "cm",
      valueCm: ellipseCircumference(chestWidth.valueCm, chestDepth.valueCm),
    },
    {
      confidence: combineConfidence(waistWidth.confidence, waistDepth.confidence),
      key: "waist",
      label: "Waist",
      method: "Height-calibrated front width and side-depth ellipse",
      notes: [...waistWidth.notes, ...waistDepth.notes],
      sourceFrames: uniqueFrames([...waistWidth.sourceFrames, ...waistDepth.sourceFrames]),
      unit: "cm",
      valueCm: ellipseCircumference(waistWidth.valueCm, waistDepth.valueCm),
    },
    {
      confidence: combineConfidence(hipWidth.confidence, hipDepth.confidence),
      key: "hips",
      label: "Hips",
      method: "Height-calibrated front width and side-depth ellipse",
      notes: [...hipWidth.notes, ...hipDepth.notes],
      sourceFrames: uniqueFrames([...hipWidth.sourceFrames, ...hipDepth.sourceFrames]),
      unit: "cm",
      valueCm: ellipseCircumference(hipWidth.valueCm, hipDepth.valueCm),
    },
    {
      confidence: combineConfidence(thighWidth.confidence, thighDepth.confidence),
      key: "thigh",
      label: "Thigh",
      method: "Height-calibrated front width and side-depth ellipse",
      notes: [...thighWidth.notes, ...thighDepth.notes],
      sourceFrames: uniqueFrames([...thighWidth.sourceFrames, ...thighDepth.sourceFrames]),
      unit: "cm",
      valueCm: ellipseCircumference(thighWidth.valueCm, thighDepth.valueCm),
    },
    {
      confidence: inseam.confidence,
      key: "inseam",
      label: "Inseam",
      method: inseam.method,
      notes: inseam.notes,
      sourceFrames: inseam.sourceFrames,
      unit: "cm",
      valueCm: inseam.valueCm,
    },
    {
      confidence: sleeveLength.confidence,
      key: "sleeveLength",
      label: "Sleeve length",
      method: sleeveLength.method,
      notes: sleeveLength.notes,
      sourceFrames: sleeveLength.sourceFrames,
      unit: "cm",
      valueCm: sleeveLength.valueCm,
    },
  ], heightCm).map((measurement) => ({
    ...measurement,
    valueCm: roundMeasurement(measurement.valueCm),
  }));
}

function clampLinearMeasurementEstimate(measurement, key, heightCm, shoulderWidthCm) {
  const range = getLinearWidthPlausibleRange(key, heightCm, shoulderWidthCm);

  if (!range) {
    return measurement;
  }

  return clampMeasurementEstimate(measurement, range, `${key} constrained to a human-proportion range.`);
}

function clampDepthMeasurementEstimate(measurement, key, widthCm) {
  const ranges = {
    chest: [0.48, 0.72],
    hips: [0.52, 0.82],
    neck: [0.72, 1.05],
    thigh: [0.75, 1.05],
    waist: [0.48, 0.78],
  };
  const ratioRange = ranges[key];

  if (!ratioRange || !Number.isFinite(widthCm) || widthCm <= 0) {
    return measurement;
  }

  return clampMeasurementEstimate(
    measurement,
    {
      max: widthCm * ratioRange[1],
      min: widthCm * ratioRange[0],
    },
    `${key} side-depth constrained relative to front width.`,
  );
}

function normalizeBodyMeasurements(measurements, heightCm) {
  const values = Object.fromEntries(measurements.map((measurement) => [measurement.key, measurement.valueCm]));
  const shoulderWidthCm = Number(values.shoulderWidth);

  const clampedMeasurements = measurements.map((measurement) => {
    const range = getBodyMeasurementPlausibleRange(measurement.key, heightCm, shoulderWidthCm);

    if (!range) {
      return measurement;
    }

    return clampMeasurementEstimate(
      measurement,
      range,
      `${measurement.label} constrained to a calibrated human-proportion range.`,
    );
  });

  return applyTorsoContinuityCheck(clampedMeasurements, heightCm, shoulderWidthCm);
}

function applyTorsoContinuityCheck(measurements, heightCm, shoulderWidthCm) {
  const byKey = new Map(measurements.map((measurement) => [measurement.key, measurement]));
  const chest = Number(byKey.get("chest")?.valueCm);
  const waist = Number(byKey.get("waist")?.valueCm);
  const hips = Number(byKey.get("hips")?.valueCm);

  if (![chest, waist, hips].every((value) => Number.isFinite(value) && value > 0)) {
    return measurements;
  }

  const torsoSpread = (Math.max(chest, waist, hips) - Math.min(chest, waist, hips)) / chest;
  const waistLooksLikeMergedTorso =
    torsoSpread < 0.18 &&
    waist >= chest * 0.96 &&
    waist >= hips * 0.9;

  if (!waistLooksLikeMergedTorso) {
    return measurements;
  }

  const waistRange = getBodyMeasurementPlausibleRange("waist", heightCm, shoulderWidthCm);
  const relationLimitedWaist = Math.max(chest * 0.92, hips * 0.88, heightCm * 0.44);
  const nextWaist = waistRange
    ? clamp(Math.min(waist, relationLimitedWaist), waistRange.min, waistRange.max)
    : Math.min(waist, relationLimitedWaist);

  if (Math.abs(nextWaist - waist) < 0.05) {
    return measurements;
  }

  return measurements.map((measurement) => {
    if (measurement.key !== "waist") {
      return measurement;
    }

    return updateMeasurementEstimate(
      measurement,
      nextWaist,
      "Waist adjusted by torso-continuity check because chest, waist, and hip rows were nearly flat.",
    );
  });
}

function updateMeasurementEstimate(measurement, nextValue, note) {
  const value = Number(measurement.valueCm);

  if (!Number.isFinite(value) || !Number.isFinite(nextValue)) {
    return measurement;
  }

  if (Math.abs(nextValue - value) < 0.05) {
    return measurement;
  }

  return {
    ...measurement,
    confidence: measurement.confidence === "high" ? "medium" : measurement.confidence,
    notes: [
      ...measurement.notes,
      `${note} Raw estimate was ${roundMeasurement(value)} cm.`,
    ],
    valueCm: nextValue,
  };
}

function clampMeasurementEstimate(measurement, range, note) {
  const value = Number(measurement.valueCm);

  if (!Number.isFinite(value)) {
    return measurement;
  }

  const clamped = clamp(value, range.min, range.max);

  if (Math.abs(clamped - value) < 0.05) {
    return measurement;
  }

  return {
    ...measurement,
    confidence: measurement.confidence === "high" ? "medium" : measurement.confidence,
    notes: [
      ...measurement.notes,
      `${note} Raw estimate was ${roundMeasurement(value)} cm.`,
    ],
    valueCm: clamped,
  };
}

function getLinearWidthPlausibleRange(key, heightCm, shoulderWidthCm) {
  const shoulder = Number.isFinite(shoulderWidthCm) && shoulderWidthCm > 0
    ? shoulderWidthCm
    : heightCm * 0.255;
  const ranges = {
    chestWidth: {
      max: Math.min(heightCm * 0.31, shoulder * 1.22),
      min: Math.max(heightCm * 0.18, shoulder * 0.82),
    },
    hipWidth: {
      max: Math.min(heightCm * 0.33, shoulder * 1.32),
      min: Math.max(heightCm * 0.17, shoulder * 0.72),
    },
    neckWidth: {
      max: Math.min(heightCm * 0.095, shoulder * 0.42),
      min: Math.max(heightCm * 0.052, shoulder * 0.24),
    },
    shoulderWidth: {
      max: heightCm * 0.32,
      min: heightCm * 0.2,
    },
    thighWidth: {
      max: Math.min(heightCm * 0.17, shoulder * 0.65),
      min: Math.max(heightCm * 0.075, shoulder * 0.36),
    },
    waistWidth: {
      max: Math.min(heightCm * 0.3, shoulder * 1.15),
      min: Math.max(heightCm * 0.15, shoulder * 0.62),
    },
  };

  return ranges[key] ?? null;
}

function getBodyMeasurementPlausibleRange(key, heightCm, shoulderWidthCm) {
  const shoulder = Number.isFinite(shoulderWidthCm) && shoulderWidthCm > 0
    ? shoulderWidthCm
    : heightCm * 0.255;
  const ranges = {
    chest: {
      max: Math.min(heightCm * 0.68, shoulder * 3),
      min: Math.max(heightCm * 0.43, shoulder * 2.1),
    },
    hips: {
      max: Math.min(heightCm * 0.72, shoulder * 3.15),
      min: Math.max(heightCm * 0.44, shoulder * 2.1),
    },
    inseam: {
      max: heightCm * 0.52,
      min: heightCm * 0.39,
    },
    neck: {
      max: Math.min(heightCm * 0.29, shoulder * 1.22),
      min: Math.max(heightCm * 0.17, shoulder * 0.78),
    },
    shoulderWidth: {
      max: heightCm * 0.32,
      min: heightCm * 0.2,
    },
    sleeveLength: {
      max: heightCm * 0.4,
      min: heightCm * 0.28,
    },
    thigh: {
      max: Math.min(heightCm * 0.43, shoulder * 1.85),
      min: Math.max(heightCm * 0.24, shoulder * 1.15),
    },
    waist: {
      max: Math.min(heightCm * 0.72, shoulder * 3),
      min: Math.max(heightCm * 0.36, shoulder * 1.8),
    },
  };

  return ranges[key] ?? null;
}

function getCmPerPixel(analysis, heightCm) {
  const boundsHeight = analysis?.bodyBounds?.height;

  if (!Number.isFinite(boundsHeight) || boundsHeight <= 0) {
    return null;
  }

  const fullBodyFactor = analysis.bodyBoundsSource.includes("pose-landmarks") ? 0.92 : 1;
  return (heightCm * fullBodyFactor) / boundsHeight;
}

function getLinearWidthCm({ analysis, fallbackCm, key, scale }) {
  const aggregateWidthCm = analysis?.measurementWidthsCm?.[key];

  if (aggregateWidthCm) {
    const sourceFrames = getAnalysisSourceFrames(analysis);

    return {
      confidence: getAggregateConfidence(analysis),
      method: `${analysis.bodyBoundsSource} ${key} width calibrated by height`,
      notes: [`Measured from ${analysis.sampleCount ?? sourceFrames.length} accepted frames.`],
      sourceFrames,
      valueCm: aggregateWidthCm,
    };
  }

  const widthPx = resolveWidthPx(analysis, key);

  if (widthPx && scale) {
    return {
      confidence: analysis.bodyBoundsSource === "scan-guide-fallback" ? "low" : "medium",
      method: `${analysis.bodyBoundsSource} ${key} width calibrated by height`,
      notes: [`Measured from ${analysis.frame.state}.`],
      sourceFrames: getAnalysisSourceFrames(analysis),
      valueCm: widthPx * scale,
    };
  }

  return {
    confidence: "low",
    method: "Anthropometric fallback from height",
    notes: [`${key} width could not be measured from frame geometry.`],
    sourceFrames: [],
    valueCm: fallbackCm,
  };
}

function resolveWidthPx(analysis, key) {
  if (!analysis) {
    return null;
  }

  if (key === "shoulder") {
    const span = getHorizontalKeypointSpan(analysis, "left_shoulder", "right_shoulder");

    if (span) {
      return span;
    }
  }

  if (analysis.rowWidths?.[key] && analysis.rowWidths[key] > 0) {
    return analysis.rowWidths[key];
  }

  if (key === "hips") {
    const span = getHorizontalKeypointSpan(analysis, "left_hip", "right_hip");

    if (span) {
      return span * 1.12;
    }
  }

  if (analysis.bodyBounds?.width) {
    const multipliers = {
      chest: 0.88,
      hips: 0.86,
      neck: 0.32,
      shoulder: 0.98,
      thigh: 0.34,
      waist: 0.68,
    };

    return analysis.bodyBounds.width * (multipliers[key] ?? 0.8);
  }

  return null;
}

function getDepthCm({ fallbackRatio, key, sideFrame, sideScale, widthCm }) {
  if (sideFrame && sideFrame.frame.source !== "mock-camera") {
    const aggregateDepthCm = sideFrame.measurementWidthsCm?.[key];

    if (aggregateDepthCm) {
      const sourceFrames = getAnalysisSourceFrames(sideFrame);

      return {
        confidence: getAggregateConfidence(sideFrame),
        notes: [`Depth measured from ${sideFrame.sampleCount ?? sourceFrames.length} accepted side frames.`],
        sourceFrames,
        valueCm: aggregateDepthCm,
      };
    }

    const depthPx =
      sideFrame.rowWidths?.[key] ??
      (sideFrame.bodyBounds?.width ? sideFrame.bodyBounds.width * 0.9 : null);

    if (depthPx && sideScale) {
      return {
        confidence: sideFrame.bodyBoundsSource === "scan-guide-fallback" ? "low" : "medium",
        notes: [`Depth measured from ${sideFrame.frame.state}.`],
        sourceFrames: getAnalysisSourceFrames(sideFrame),
        valueCm: depthPx * sideScale,
      };
    }
  }

  return {
    confidence: "low",
    notes: [`${key} depth inferred from width ratio.`],
    sourceFrames: [],
    valueCm: widthCm * fallbackRatio,
  };
}

function getInseamCm(frontFrame, scale, heightCm) {
  const leftHip = frontFrame?.keypoints.get("left_hip");
  const rightHip = frontFrame?.keypoints.get("right_hip");
  const leftAnkle = frontFrame?.keypoints.get("left_ankle");
  const rightAnkle = frontFrame?.keypoints.get("right_ankle");

  if (leftHip && rightHip && leftAnkle && rightAnkle && scale) {
    const hipY = (leftHip.y + rightHip.y) / 2;
    const ankleY = Math.max(leftAnkle.y, rightAnkle.y);

    if (ankleY > hipY) {
      return {
        confidence: "medium",
        method: "Pose landmarks calibrated by height",
        notes: ["Hip-to-ankle length is adjusted as a crotch-to-floor estimate."],
        sourceFrames: getAnalysisSourceFrames(frontFrame),
        valueCm: (ankleY - hipY) * scale * 0.92,
      };
    }
  }

  return {
    confidence: "low",
    method: "Anthropometric fallback from height",
    notes: ["Leg landmarks were unavailable."],
    sourceFrames: [],
    valueCm: heightCm * 0.455,
  };
}

function getSleeveLengthCm(frontFrame, scale, heightCm) {
  const leftShoulder = frontFrame?.keypoints.get("left_shoulder");
  const leftWrist = frontFrame?.keypoints.get("left_wrist");
  const rightShoulder = frontFrame?.keypoints.get("right_shoulder");
  const rightWrist = frontFrame?.keypoints.get("right_wrist");
  const shoulder = leftShoulder && leftWrist ? leftShoulder : rightShoulder;
  const wrist = leftShoulder && leftWrist ? leftWrist : rightWrist;

  if (shoulder && wrist && scale) {
    return {
      confidence: "medium",
      method: "Pose landmarks calibrated by height",
      notes: ["Shoulder-to-wrist path measured from visible landmarks."],
      sourceFrames: getAnalysisSourceFrames(frontFrame),
      valueCm: getPointDistance(shoulder, wrist) * scale,
    };
  }

  return {
    confidence: "low",
    method: "Anthropometric fallback from height",
    notes: ["Wrist landmarks were unavailable."],
    sourceFrames: [],
    valueCm: heightCm * 0.335,
  };
}

function getHorizontalKeypointSpan(analysis, leftName, rightName) {
  const left = analysis.keypoints.get(leftName);
  const right = analysis.keypoints.get(rightName);

  if (!left || !right) {
    return null;
  }

  return Math.abs(left.x - right.x);
}

function aggregateBounds(boundsList) {
  const validBounds = boundsList.filter(Boolean);

  if (validBounds.length === 0) {
    return null;
  }

  const left = getRobustMedian(validBounds.map((bounds) => bounds.left));
  const right = getRobustMedian(validBounds.map((bounds) => bounds.right));
  const top = getRobustMedian(validBounds.map((bounds) => bounds.top));
  const bottom = getRobustMedian(validBounds.map((bounds) => bounds.bottom));

  if (![left, right, top, bottom].every((value) => Number.isFinite(value))) {
    return null;
  }

  return {
    bottom,
    height: bottom - top,
    left,
    right,
    top,
    width: right - left,
  };
}

function aggregateKeypoints(analyses) {
  const keypointNames = Array.from(
    new Set(analyses.flatMap((analysis) => Array.from(analysis.keypoints.keys()))),
  );
  const keypoints = new Map();

  for (const name of keypointNames) {
    const samples = analyses
      .map((analysis) => analysis.keypoints.get(name))
      .filter(Boolean);

    if (samples.length < 2) {
      continue;
    }

    const x = getRobustMedian(samples.map((sample) => sample.x));
    const y = getRobustMedian(samples.map((sample) => sample.y));
    const score = getRobustMedian(
      samples
        .map((sample) => sample.score)
        .filter((value) => Number.isFinite(value)),
    );

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }

    keypoints.set(name, {
      name,
      score: Number.isFinite(score) ? score : null,
      x,
      y,
    });
  }

  return keypoints;
}

function getAnalysisSourceFrames(analysis) {
  return uniqueFrames(analysis?.sourceFrames ?? [analysis?.frame?.fileName]);
}

function getAggregateConfidence(analysis) {
  if (analysis.bodyBoundsSource === "scan-guide-fallback") {
    return "low";
  }

  if (analysis.bodyBoundsSource.includes("person-segmentation-mask")) {
    return (analysis.sampleCount ?? 1) >= 3 ? "medium" : "low";
  }

  if ((analysis.sampleCount ?? 1) >= 3) {
    return "medium";
  }

  return "low";
}

function getPointDistance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function ellipseCircumference(widthCm, depthCm) {
  const a = Math.max(widthCm, 1) / 2;
  const b = Math.max(depthCm, 1) / 2;

  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
}

function combineConfidence(first, second) {
  if (first === "low" || second === "low") {
    return "low";
  }

  if (first === "medium" || second === "medium") {
    return "medium";
  }

  return "high";
}

function uniqueFrames(frames) {
  return Array.from(new Set(frames.filter(Boolean)));
}

function getRobustMedian(values) {
  const sortedValues = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);

  if (sortedValues.length === 0) {
    return null;
  }

  if (sortedValues.length < 4) {
    return getMedian(sortedValues);
  }

  const median = getMedian(sortedValues);
  const deviations = sortedValues
    .map((value) => Math.abs(value - median))
    .sort((left, right) => left - right);
  const medianDeviation = getMedian(deviations);

  if (!medianDeviation) {
    return median;
  }

  const maximumDeviation = Math.max(medianDeviation * 2.5, median * 0.06);
  const filteredValues = sortedValues.filter(
    (value) => Math.abs(value - median) <= maximumDeviation,
  );

  return getMedian(filteredValues.length > 0 ? filteredValues : sortedValues);
}

function getMedian(sortedValues) {
  const middle = Math.floor(sortedValues.length / 2);

  if (sortedValues.length % 2 === 1) {
    return sortedValues[middle];
  }

  return (sortedValues[middle - 1] + sortedValues[middle]) / 2;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundMeasurement(value) {
  return Math.round(value * 10) / 10;
}

function buildValidationReport(job, checks, archiveSize, manifest) {
  const frames = Array.isArray(manifest?.frames) ? manifest.frames : [];
  const failedChecks = checks.filter((check) => check.status === "failed");

  return {
    blockingIssues: failedChecks.map((check) => `${check.label}: ${check.detail}`),
    checks,
    generatedAt: new Date().toISOString(),
    jobId: job.id,
    schemaVersion: "scan-validation-report.v1",
    sessionId: job.sessionId,
    status: failedChecks.length === 0 ? "passed" : "failed",
    summary: {
      archiveSize,
      cameraMode: manifest?.session?.cameraMode ?? "unknown",
      frameCount: frames.length,
      manifestSchemaVersion: manifest?.schemaVersion ?? "unknown",
      phaseFrameCounts: countFramesByState(frames),
    },
  };
}

async function ensureFailedReport(reportFile, job, message) {
  const existingReport = await readJson(reportFile);

  if (existingReport) {
    return existingReport;
  }

  return {
    blockingIssues: [message],
    checks: [
      {
        detail: message,
        id: "worker-error",
        label: "Worker error",
        status: "failed",
      },
    ],
    generatedAt: new Date().toISOString(),
    jobId: job.id,
    schemaVersion: "scan-validation-report.v1",
    sessionId: job.sessionId,
    status: "failed",
    summary: {
      archiveSize: 0,
      cameraMode: "unknown",
      frameCount: 0,
      manifestSchemaVersion: "unknown",
      phaseFrameCounts: {},
    },
  };
}

async function checkFile(checks, id, label, filePath) {
  try {
    const fileStats = await stat(filePath);
    addCheck(checks, id, label, "passed", `${relativeToWorkspace(filePath)} exists.`);
    return fileStats;
  } catch {
    addCheck(checks, id, label, "failed", `${relativeToWorkspace(filePath)} is missing.`);
    return null;
  }
}

function countFramesByState(frames) {
  return frames.reduce((counts, frame) => {
    if (typeof frame.state === "string") {
      counts[frame.state] = (counts[frame.state] ?? 0) + 1;
    }

    return counts;
  }, {});
}

function getReconstructionProfile(manifest) {
  return manifest?.reconstructionProfile ?? manifest?.session?.reconstructionProfile ?? null;
}

function getReconstructionPhaseTarget(manifest, state) {
  const profile = getReconstructionProfile(manifest);
  const target = profile?.phaseTargets?.[state];

  if (
    target &&
    Number.isFinite(Number(target.minimumFrameCount)) &&
    Number(target.minimumFrameCount) > 0
  ) {
    return target;
  }

  return {
    angleDeg: null,
    angleLabel: state,
    minimumFrameCount: fallbackMinimumFramesByPhase[state] ?? 4,
    requiredSignals: [],
    state,
    targetFrameCount:
      fallbackTargetFramesByPhase[state] ?? fallbackMinimumFramesByPhase[state] ?? 4,
  };
}

function getMinimumReconstructionFramesForState(manifest, state) {
  return Number(getReconstructionPhaseTarget(manifest, state).minimumFrameCount);
}

function getTargetReconstructionFramesForState(manifest, state) {
  return Number(getReconstructionPhaseTarget(manifest, state).targetFrameCount);
}

function getMinimumReconstructionFrameCount(manifest) {
  return getRequiredCaptureStates(manifest).reduce(
    (total, state) => total + getMinimumReconstructionFramesForState(manifest, state),
    0,
  );
}

function getTargetReconstructionFrameCount(manifest) {
  return getRequiredCaptureStates(manifest).reduce(
    (total, state) => total + getTargetReconstructionFramesForState(manifest, state),
    0,
  );
}

function getRequiredCaptureStates(manifest) {
  const phaseTargets = getReconstructionProfile(manifest)?.phaseTargets;
  const profileStates = phaseTargets && typeof phaseTargets === "object"
    ? Object.keys(phaseTargets).filter((state) => phaseTargets[state])
    : [];

  return profileStates.length > 0 ? profileStates : legacyRequiredCaptureStates;
}

function addCheck(checks, id, label, status, detail) {
  checks.push({ detail, id, label, status });
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function readCurrentMeasurementReport(sessionDirectory) {
  const reportFile = path.join(sessionDirectory, measurementReportFileName);
  const avatarMeshFile = path.join(sessionDirectory, bodyAvatarFileName);
  const report = await readJson(reportFile);

  if (
    report?.schemaVersion === "body-measurements.v1" &&
    report.provider?.version === measurementProviderVersion
  ) {
    return normalizeBodyMeasurementReport(report);
  }

  const job = await readJson(path.join(sessionDirectory, "processing-job.json"));

  if (job?.status === "completed" && job.input?.archiveFile) {
    try {
      const nextReport = await createBodyMeasurementReport(job);
      const nextAvatarMesh = await createBodyAvatarMeshReport(nextReport, job);

      await writeJson(reportFile, nextReport);
      await writeJson(avatarMeshFile, nextAvatarMesh);

      return nextReport;
    } catch {
      return report?.schemaVersion === "body-measurements.v1"
        ? normalizeBodyMeasurementReport(report)
        : null;
    }
  }

  return report?.schemaVersion === "body-measurements.v1"
    ? normalizeBodyMeasurementReport(report)
    : null;
}

async function readMeasurementReport(sessionDirectory) {
  const report = await readJson(path.join(sessionDirectory, measurementReportFileName));

  if (report?.schemaVersion === "body-measurements.v1") {
    return normalizeBodyMeasurementReport(report);
  }

  const legacyReport = await readJson(path.join(sessionDirectory, legacyMeasurementsFileName));

  if (legacyReport?.schemaVersion) {
    return null;
  }

  return null;
}

async function readBodyAvatarMeshReport(sessionDirectory, measurementReport) {
  const avatarMeshFile = path.join(sessionDirectory, bodyAvatarFileName);
  const report = await readJson(avatarMeshFile);

  if (
    report?.schemaVersion === "body-avatar.v1" &&
    report.provider?.version === bodyAvatarProviderVersion
  ) {
    return report;
  }

  if (measurementReport?.schemaVersion === "body-measurements.v1") {
    const job = await readJson(path.join(sessionDirectory, "processing-job.json"));
    const nextReport = await createBodyAvatarMeshReport(measurementReport, job);

    await writeJson(avatarMeshFile, nextReport);
    return nextReport;
  }

  return null;
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2));
}

function relativeToWorkspace(filePath) {
  return path.relative(process.cwd(), filePath);
}

function resolveUploadFile(filePath) {
  const normalizedPath = String(filePath).replaceAll("\\", path.sep);
  const uploadRootPrefix = `.scan-uploads${path.sep}`;
  const relativeToUploads = normalizedPath.startsWith(uploadRootPrefix)
    ? normalizedPath.slice(uploadRootPrefix.length)
    : normalizedPath;
  const resolvedPath = path.resolve(uploadRoot, relativeToUploads);
  const uploadRootWithSeparator = `${uploadRoot}${path.sep}`;

  if (resolvedPath !== uploadRoot && !resolvedPath.startsWith(uploadRootWithSeparator)) {
    throw new Error("Scan upload path must stay inside the upload directory.");
  }

  return resolvedPath;
}

function sanitizePathSegment(value) {
  const sanitized = String(value).replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
  return sanitized.slice(0, 96) || `scan-${Date.now()}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
