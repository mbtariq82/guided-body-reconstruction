import { exec } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { unzipSync } from "fflate";
import { readScanSessionDetail } from "./process-scan-jobs.mjs";

const execAsync = promisify(exec);
loadLocalEnvironmentFile(".env.local");
loadLocalEnvironmentFile(".env");

const uploadRoot = path.resolve(/*turbopackIgnore: true*/ process.cwd(), ".scan-uploads");
const bundledWorkerFile = path.resolve(
  /*turbopackIgnore: true*/ process.cwd(),
  "scripts/self_hosted_avatar_worker.py",
);
const defaultSmplxModelDir = path.resolve(
  /*turbopackIgnore: true*/ process.cwd(),
  ".avatar-models/smplx/models",
);
const defaultEconHome = path.resolve(
  /*turbopackIgnore: true*/ process.cwd(),
  ".avatar-models/repos/ECON",
);
const defaultLhmHome = path.resolve(
  /*turbopackIgnore: true*/ process.cwd(),
  ".avatar-models/repos/LHM",
);
const defaultLhmPlusPlusHome = path.resolve(
  /*turbopackIgnore: true*/ process.cwd(),
  ".avatar-models/repos/LHM-plusplus",
);
const reconstructionDirectoryName = "avatar-reconstruction";
const inputDirectoryName = "inputs";
const outputDirectoryName = "output";
const assetDirectoryName = "assets";
const jobFileName = "self-hosted-avatar-job.json";
const assetManifestFileName = "avatar-assets.json";
const requestFileName = "self-hosted-request.json";
const provider = {
  id: "self-hosted-smplx-econ-lhm",
  mode: "local",
  name: "Self-hosted SMPL-X / ECON / LHM",
};

export async function readAvatarReconstructionState(sessionId) {
  const sessionDirectory = getSessionDirectory(sessionId);
  const reconstructionDirectory = path.join(sessionDirectory, reconstructionDirectoryName);
  const assetManifestFile = path.join(reconstructionDirectory, assetManifestFileName);
  const jobFile = path.join(reconstructionDirectory, jobFileName);
  const assets = await readJson(assetManifestFile) ?? [];
  const job = await readJson(jobFile);

  return {
    assets: normalizeAssets(sessionId, assets),
    configured: isSelfHostedAvatarCommandConfigured(),
    job: job ? { ...job, assets: normalizeAssets(sessionId, job.assets ?? assets) } : null,
    setup: getSelfHostedAvatarSetup(),
  };
}

export async function requestSelfHostedAvatarReconstruction(sessionId, options = {}) {
  const detail = await readScanSessionDetail(sessionId);
  const currentState = await readAvatarReconstructionState(sessionId);

  if (
    currentState.job?.status === "succeeded" &&
    currentState.assets.length > 0 &&
    !options.force
  ) {
    return currentState;
  }

  const directories = await ensureReconstructionDirectories(sessionId);
  const createdAt = new Date().toISOString();
  const selectedFrames = selectSelfHostedInputFrames(detail);
  const warnings = getInputWarnings(detail, selectedFrames);
  const request = await writeSelfHostedRequest({
    createdAt,
    detail,
    directories,
    selectedFrames,
    sessionId,
    warnings,
  });
  let job = buildPreparedJob({
    assets: [],
    createdAt,
    directories,
    request,
    selectedFrames,
    sessionId,
    warnings,
  });

  if (!detail.measurementReport || !detail.avatarMesh) {
    job = {
      ...job,
      notes: [
        ...job.notes,
        "Process the scan locally before running self-hosted avatar reconstruction.",
      ],
      stage: "awaiting-session-processing",
      status: "blocked",
      updatedAt: new Date().toISOString(),
    };
    await writeAvatarJob(directories.reconstructionDirectory, job);
    return readAvatarReconstructionState(sessionId);
  }

  if (!isSelfHostedAvatarCommandConfigured()) {
    job = {
      ...job,
      notes: [
        ...job.notes,
        "Input package prepared. Configure SELF_HOSTED_AVATAR_COMMAND or restore the bundled worker to run a local model worker.",
      ],
      stage: "awaiting-model-runtime",
      status: "blocked",
      updatedAt: new Date().toISOString(),
      warnings: [
        ...job.warnings,
        "No self-hosted reconstruction command is configured.",
      ],
    };
    await writeAvatarJob(directories.reconstructionDirectory, job);
    return readAvatarReconstructionState(sessionId);
  }

  job = {
    ...job,
    attempts: job.attempts + 1,
    commandConfigured: true,
    notes: [...job.notes, getWorkerRunNote()],
    stage: "running-worker",
    status: "running",
    updatedAt: new Date().toISOString(),
  };
  await writeAvatarJob(directories.reconstructionDirectory, job);

  try {
    const runResult = await runSelfHostedAvatarCommand({
      outputDirectory: directories.outputDirectory,
      requestFile: request.requestFile,
    });
    const assets = await collectAvatarAssets(sessionId, directories);
    const hasRenderableAsset = assets.some((asset) => asset.type === "glb" || asset.type === "gltf");
    const completedJob = {
      ...job,
      assets,
      logs: {
        stderr: trimLogLines(runResult.stderr),
        stdout: trimLogLines(runResult.stdout),
      },
      notes: [
        ...job.notes,
        assets.length > 0
          ? `Collected ${assets.length} generated avatar asset${assets.length === 1 ? "" : "s"}.`
          : "Worker finished but did not produce recognized avatar assets.",
      ],
      stage: assets.length > 0 ? "completed" : "failed",
      status: assets.length > 0 ? "succeeded" : "failed",
      updatedAt: new Date().toISOString(),
      warnings: [
        ...job.warnings,
        ...(!hasRenderableAsset && assets.length > 0
          ? ["Worker did not produce a GLB/GLTF file; the viewer will keep using the fallback mesh."]
          : []),
      ],
    };

    await writeAvatarAssets(directories.reconstructionDirectory, assets);
    await writeAvatarJob(directories.reconstructionDirectory, completedJob);
  } catch (error) {
    const failedJob = {
      ...job,
      errorMessage: error instanceof Error ? error.message : "Self-hosted reconstruction failed.",
      logs: {
        stderr: error?.stderr ? trimLogLines(String(error.stderr)) : job.logs.stderr,
        stdout: error?.stdout ? trimLogLines(String(error.stdout)) : job.logs.stdout,
      },
      notes: [...job.notes, "Self-hosted reconstruction worker failed."],
      stage: "failed",
      status: "failed",
      updatedAt: new Date().toISOString(),
    };

    await writeAvatarJob(directories.reconstructionDirectory, failedJob);
  }

  return readAvatarReconstructionState(sessionId);
}

function buildPreparedJob({
  assets,
  createdAt,
  directories,
  request,
  selectedFrames,
  sessionId,
  warnings,
}) {
  return {
    assets,
    attempts: 0,
    commandConfigured: isSelfHostedAvatarCommandConfigured(),
    createdAt,
    id: `self-hosted-avatar-${sessionId}`,
    input: {
      inputDirectory: relativeToWorkspace(directories.inputDirectory),
      localAvatarReportFile: request.avatarReportFile
        ? relativeToWorkspace(request.avatarReportFile)
        : null,
      measurementReportFile: request.measurementReportFile
        ? relativeToWorkspace(request.measurementReportFile)
        : null,
      requestFile: relativeToWorkspace(request.requestFile),
      referenceViewCount: request.referenceViewCount,
      selectedFrames: {
        back: selectedFrames.back?.fileName ?? null,
        front: selectedFrames.front?.fileName ?? null,
        hands: selectedFrames.hands?.fileName ?? null,
        identity: selectedFrames.identity?.fileName ?? null,
        side: selectedFrames.side?.fileName ?? null,
      },
      videoFile: request.videoFile ? relativeToWorkspace(request.videoFile) : null,
    },
    logs: {
      stderr: [],
      stdout: [],
    },
    notes: ["Prepared self-hosted avatar reconstruction input package."],
    output: {
      assetManifestFile: relativeToWorkspace(path.join(directories.reconstructionDirectory, assetManifestFileName)),
      outputDirectory: relativeToWorkspace(directories.outputDirectory),
    },
    provider,
    schemaVersion: "self-hosted-avatar-reconstruction-job.v1",
    sessionId,
    stage: "input-prepared",
    status: "blocked",
    updatedAt: createdAt,
    warnings,
  };
}

async function writeSelfHostedRequest({
  createdAt,
  detail,
  directories,
  selectedFrames,
  sessionId,
  warnings,
}) {
  const frameFiles = {
    back: await writeSelectedFrame(directories.inputDirectory, "back", selectedFrames.back),
    front: await writeSelectedFrame(directories.inputDirectory, "front", selectedFrames.front),
    side: await writeSelectedFrame(directories.inputDirectory, "side", selectedFrames.side),
  };
  const identityFrameFile = await writeSelectedFrame(
    directories.inputDirectory,
    "identity-detail",
    selectedFrames.identity,
  );
  const handFrameFile = await writeSelectedFrame(
    directories.inputDirectory,
    "hand-detail",
    selectedFrames.hands,
  );
  const referenceViews = await writeReferenceViews(
    directories.inputDirectory,
    selectedFrames.referenceViews,
  );
  const frameSequence = await writeFrameSequence(directories.inputDirectory, detail.frames);
  const videoFile = await writeGuidedScanVideo(directories.inputDirectory, detail);
  const measurementReportFile = detail.measurementReport
    ? path.join(directories.inputDirectory, "body-measurements.json")
    : null;
  const avatarReportFile = detail.avatarMesh
    ? path.join(directories.inputDirectory, "body-avatar-local.json")
    : null;
  const requestFile = path.join(directories.inputDirectory, requestFileName);

  if (measurementReportFile) {
    await writeJson(measurementReportFile, detail.measurementReport);
  }

  if (avatarReportFile) {
    await writeJson(avatarReportFile, detail.avatarMesh);
  }

  await writeJson(requestFile, {
    createdAt,
    expectedOutputs: [
      "avatar.glb",
      "avatar.gltf",
      "smplx-params.json",
      "smplx-temporal-fit.json",
      "econ-mesh.obj",
      "lhm-avatar.ply",
      "preview.png",
      "diagnostics.json",
    ],
    inputFrames: {
      back: frameFiles.back ? relativeToWorkspace(frameFiles.back) : null,
      front: frameFiles.front ? relativeToWorkspace(frameFiles.front) : null,
      side: frameFiles.side ? relativeToWorkspace(frameFiles.side) : null,
    },
    inputIdentityFrame: identityFrameFile
      ? relativeToWorkspace(identityFrameFile)
      : null,
    inputHandFrame: handFrameFile ? relativeToWorkspace(handFrameFile) : null,
    inputReferenceViews: referenceViews.map((view) => ({
      ...view,
      file: relativeToWorkspace(view.file),
    })),
    inputSequence: {
      frames: frameSequence.map((frame) => ({
        ...frame,
        file: relativeToWorkspace(frame.file),
      })),
      video: videoFile
        ? {
            ...videoFile.metadata,
            file: relativeToWorkspace(videoFile.file),
          }
        : null,
    },
    localAvatarReportFile: avatarReportFile ? relativeToWorkspace(avatarReportFile) : null,
    measurementReportFile: measurementReportFile ? relativeToWorkspace(measurementReportFile) : null,
    measurements: detail.measurementReport,
    modelRoots: getSelfHostedAvatarSetup().modelRoots,
    outputDirectory: relativeToWorkspace(directories.outputDirectory),
    pipeline: {
      preferred: "ECON for clothed mesh with SMPL-X guidance; LHM/LHM++ for animatable avatar experiments.",
      providerId: provider.id,
      stages: [
        "human parsing and matte cleanup",
        "temporal 2D/3D pose estimation from guided video",
        "shared-shape SMPL-X fitting across angle-balanced views",
        "clothed mesh or Gaussian avatar reconstruction",
        "GLB/GLTF export for web preview",
      ],
    },
    selectedFrameVision: {
      back: selectedFrames.back?.vision ?? null,
      front: selectedFrames.front?.vision ?? null,
      side: selectedFrames.side?.vision ?? null,
      identity: selectedFrames.identity?.vision ?? null,
      hands: selectedFrames.hands?.vision ?? null,
    },
    sessionId,
    warnings,
  });

  return {
    avatarReportFile,
    measurementReportFile,
    referenceViewCount: referenceViews.length,
    requestFile,
    videoFile: videoFile?.file ?? null,
  };
}

async function writeSelectedFrame(inputDirectory, label, frame) {
  if (!frame?.dataUrl) {
    return null;
  }

  const extension = getDataUrlExtension(frame.dataUrl) ?? "jpg";
  const filePath = path.join(inputDirectory, `${label}.${extension}`);
  await writeFile(filePath, dataUrlToBuffer(frame.dataUrl));
  return filePath;
}

async function writeReferenceViews(inputDirectory, frames) {
  const viewsDirectory = path.join(inputDirectory, "reference-views");

  await mkdir(viewsDirectory, { recursive: true });

  return Promise.all(frames.map(async (frame, index) => {
    const extension = getDataUrlExtension(frame.dataUrl) ?? "jpg";
    const yawDeg = normalizeYawDeg(getFrameYawDeg(frame) ?? index * 45);
    const filePath = path.join(
      viewsDirectory,
      `${String(index).padStart(2, "0")}-yaw-${String(Math.round(yawDeg)).padStart(3, "0")}.${extension}`,
    );

    await writeFile(filePath, dataUrlToBuffer(frame.dataUrl));
    return {
      file: filePath,
      height: frame.height ?? null,
      phaseProgress: frame.phaseProgress ?? null,
      reconstruction: frame.reconstruction ?? null,
      sourceFile: frame.fileName,
      state: frame.state,
      vision: frame.vision ?? null,
      width: frame.width ?? null,
      yawDeg,
    };
  }));
}

async function writeFrameSequence(inputDirectory, frames) {
  const sequenceDirectory = path.join(inputDirectory, "frame-sequence");
  const orderedFrames = frames
    .filter((frame) => frame?.dataUrl)
    .sort((left, right) => Number(left.elapsedMs ?? 0) - Number(right.elapsedMs ?? 0));

  await mkdir(sequenceDirectory, { recursive: true });

  return Promise.all(orderedFrames.map(async (frame, index) => {
    const extension = getDataUrlExtension(frame.dataUrl) ?? "jpg";
    const filePath = path.join(
      sequenceDirectory,
      `${String(index).padStart(4, "0")}-${sanitizeAssetName(frame.state)}.${extension}`,
    );

    await writeFile(filePath, dataUrlToBuffer(frame.dataUrl));
    return {
      elapsedMs: frame.elapsedMs ?? null,
      file: filePath,
      height: frame.height ?? null,
      metrics: frame.metrics ?? [],
      phaseProgress: frame.phaseProgress ?? null,
      reconstruction: frame.reconstruction ?? null,
      sourceFile: frame.fileName,
      state: frame.state,
      vision: frame.vision ?? null,
      width: frame.width ?? null,
      yawDeg: getFrameYawDeg(frame),
    };
  }));
}

async function writeGuidedScanVideo(inputDirectory, detail) {
  const video = Array.isArray(detail.videos) ? detail.videos[0] : null;
  const archiveFile = detail.session?.archive?.file;

  if (!video?.fileName || !archiveFile) {
    return null;
  }

  try {
    const archivePath = path.resolve(process.cwd(), archiveFile);

    if (!archivePath.startsWith(`${uploadRoot}${path.sep}`)) {
      return null;
    }

    const files = unzipSync(new Uint8Array(await readFile(archivePath)));
    const videoBytes = files[`video/${video.fileName}`];

    if (!videoBytes) {
      return null;
    }

    const videoDirectory = path.join(inputDirectory, "video");
    const filePath = path.join(videoDirectory, sanitizeAssetName(video.fileName));

    await mkdir(videoDirectory, { recursive: true });
    await writeFile(filePath, videoBytes);
    return {
      file: filePath,
      metadata: video,
    };
  } catch {
    return null;
  }
}

async function runSelfHostedAvatarCommand({ outputDirectory, requestFile }) {
  const commandTemplate = getSelfHostedAvatarCommand();
  const timeoutMs = Number(process.env.SELF_HOSTED_AVATAR_TIMEOUT_MS ?? 10 * 60 * 1000);

  if (!commandTemplate) {
    throw new Error("No self-hosted avatar worker command is configured.");
  }

  await mkdir(outputDirectory, { recursive: true });

  const command = commandTemplate.includes("{input}") || commandTemplate.includes("{output}")
    ? commandTemplate
        .replaceAll("{input}", shellQuote(requestFile))
        .replaceAll("{output}", shellQuote(outputDirectory))
    : `${commandTemplate} ${shellQuote(requestFile)} ${shellQuote(outputDirectory)}`;

  return execAsync(command, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AVATAR_RECONSTRUCTION_INPUT: requestFile,
      AVATAR_RECONSTRUCTION_OUTPUT: outputDirectory,
      ECON_HOME: process.env.ECON_HOME ?? defaultEconHome,
      LHM_HOME: process.env.LHM_HOME ?? defaultLhmHome,
      LHMPP_HOME: process.env.LHMPP_HOME ?? defaultLhmPlusPlusHome,
      SMPLX_MODEL_DIR: process.env.SMPLX_MODEL_DIR ?? defaultSmplxModelDir,
    },
    maxBuffer: 8 * 1024 * 1024,
    timeout: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10 * 60 * 1000,
  });
}

async function collectAvatarAssets(sessionId, directories) {
  const outputFiles = await listFilesRecursively(directories.outputDirectory);
  const candidates = outputFiles
    .map((filePath) => ({
      filePath,
      type: getAvatarAssetType(filePath),
    }))
    .filter((candidate) => candidate.type);
  const assets = [];
  const seenNames = new Set();

  for (const candidate of candidates) {
    const baseName = sanitizeAssetName(path.basename(candidate.filePath));
    const targetName = seenNames.has(baseName)
      ? `${path.parse(baseName).name}-${assets.length + 1}${path.parse(baseName).ext}`
      : baseName;
    const targetPath = path.join(directories.assetDirectory, targetName);
    const fileStats = await stat(candidate.filePath);

    seenNames.add(targetName);
    await copyFile(candidate.filePath, targetPath);

    assets.push({
      createdAt: new Date().toISOString(),
      file: targetName,
      id: `asset-${path.parse(targetName).name}`,
      label: getAssetLabel(candidate.type, targetName),
      provider,
      sizeBytes: fileStats.size,
      status: "ready",
      type: candidate.type,
      url: getAvatarAssetUrl(sessionId, targetName),
    });
  }

  return normalizeAssets(sessionId, assets);
}

function selectSelfHostedInputFrames(detail) {
  const selected = detail.avatarMesh?.aiReconstruction?.selectedInputs;
  const front = findFrameByFileName(detail.frames, selected?.frontFrameFile) ??
    selectBestFrame(detail.frames, ["front-view"]);
  const side = findFrameByFileName(detail.frames, selected?.sideFrameFile) ??
    selectBestFrame(detail.frames, ["side-view", "right-side-view", "rotate-left", "rotate-right"]);
  const back = findFrameByFileName(detail.frames, selected?.backFrameFile) ??
    selectBestFrame(detail.frames, ["back-view"]);

  return {
    back,
    front,
    hands: selectBestFrame(detail.frames, ["hand-detail"]),
    identity: selectBestFrame(detail.frames, ["identity-detail"]),
    referenceViews: selectAngleBalancedReferenceViews(detail.frames, 8),
    side,
  };
}

function getInputWarnings(detail, selectedFrames) {
  const warnings = [];

  if (!detail.measurementReport) {
    warnings.push("Body measurements are missing; process the scan before reconstruction.");
  }

  if (!detail.avatarMesh) {
    warnings.push("Local avatar report is missing; process the scan before reconstruction.");
  }

  for (const [label, frame] of Object.entries(selectedFrames)) {
    if (label !== "referenceViews" && !frame?.dataUrl) {
      warnings.push(`No ${label} source frame was available.`);
    }
  }

  if (selectedFrames.referenceViews.length < 8) {
    warnings.push(
      `Only ${selectedFrames.referenceViews.length} angle-balanced reference views were available; LHM++ is configured for eight.`,
    );
  }

  if (!detail.videos?.length) {
    warnings.push("No guided video was stored; temporal reconstruction will use the approved frame sequence.");
  }

  if (detail.frames.some((frame) => frame.source === "mock-camera")) {
    warnings.push("Mock-camera sessions are not suitable for real SMPL-X/ECON/LHM reconstruction.");
  }

  if (!detail.frames.some((frame) => frame.vision?.segmentation?.mask)) {
    warnings.push("No saved person masks were found; the worker must segment the source frames itself.");
  }

  return Array.from(new Set(warnings));
}

function selectBestFrame(frames, states) {
  return frames
    .filter((frame) => states.includes(frame.state) && frame.dataUrl)
    .sort((left, right) => getFrameScore(right) - getFrameScore(left))[0] ?? null;
}

function selectAngleBalancedReferenceViews(frames, targetCount) {
  const candidates = frames.filter(
    (frame) =>
      frame?.dataUrl &&
      isGeometryFrame(frame) &&
      Number.isFinite(getFrameYawDeg(frame)),
  );
  const selected = [];
  const usedFrameIds = new Set();

  for (let index = 0; index < targetCount; index += 1) {
    const targetYawDeg = index * (360 / targetCount);
    const best = candidates
      .filter((frame) => !usedFrameIds.has(frame.id ?? frame.fileName))
      .sort((left, right) => {
        const leftDistance = getAngularDistance(getFrameYawDeg(left), targetYawDeg);
        const rightDistance = getAngularDistance(getFrameYawDeg(right), targetYawDeg);
        const leftRank = getFrameScore(left) - leftDistance * 0.45;
        const rightRank = getFrameScore(right) - rightDistance * 0.45;

        return rightRank - leftRank;
      })[0];

    if (best && getAngularDistance(getFrameYawDeg(best), targetYawDeg) <= 32) {
      usedFrameIds.add(best.id ?? best.fileName);
      selected.push(best);
    }
  }

  return selected.sort(
    (left, right) => normalizeYawDeg(getFrameYawDeg(left)) - normalizeYawDeg(getFrameYawDeg(right)),
  );
}

function isGeometryFrame(frame) {
  if (frame?.reconstruction?.captureRole) {
    return frame.reconstruction.captureRole === "geometry";
  }

  return [
    "front-view",
    "rotate-left",
    "side-view",
    "rotate-to-back",
    "back-view",
    "rotate-right",
    "right-side-view",
    "return-front",
  ].includes(frame?.state);
}

function findFrameByFileName(frames, fileName) {
  return fileName
    ? frames.find((frame) => frame.fileName === fileName && frame.dataUrl) ?? null
    : null;
}

function getFrameScore(frame) {
  const warningCount = frame.metrics.filter((metric) => metric.tone === "warning").length;
  const segmentationScore = frame.vision?.segmentation?.quality === "good"
    ? 12
    : frame.vision?.segmentation?.quality === "partial"
      ? 6
      : 0;
  const bounds = frame.vision?.segmentation?.bodyBounds ?? frame.vision?.bodyBounds;
  const boundsScore = bounds && frame.height > 0 ? bounds.height / frame.height * 10 : 0;
  const phaseScore = 6 - Math.abs(50 - Number(frame.phaseProgress ?? 50)) / 10;

  return segmentationScore + boundsScore + phaseScore - warningCount * 8;
}

function getFrameYawDeg(frame) {
  const savedYawDeg = Number(frame?.reconstruction?.yawDeg);

  if (Number.isFinite(savedYawDeg)) {
    return savedYawDeg;
  }

  const phaseProgress = Math.max(0, Math.min(100, Number(frame?.phaseProgress ?? 50))) / 100;
  const ranges = {
    "front-view": [0, 0],
    "rotate-left": [0, 90],
    "side-view": [90, 90],
    "rotate-to-back": [90, 180],
    "back-view": [180, 180],
    "rotate-right": [180, 270],
    "right-side-view": [270, 270],
    "return-front": [270, 360],
    "motion-range": [0, 0],
  };
  const range = ranges[frame?.state];

  return range ? range[0] + (range[1] - range[0]) * phaseProgress : null;
}

function normalizeYawDeg(value) {
  const numericValue = Number(value);

  return Number.isFinite(numericValue) ? ((numericValue % 360) + 360) % 360 : 0;
}

function getAngularDistance(left, right) {
  const difference = Math.abs(normalizeYawDeg(left) - normalizeYawDeg(right));
  return Math.min(difference, 360 - difference);
}

async function ensureReconstructionDirectories(sessionId) {
  const sessionDirectory = getSessionDirectory(sessionId);
  const reconstructionDirectory = path.join(sessionDirectory, reconstructionDirectoryName);
  const inputDirectory = path.join(reconstructionDirectory, inputDirectoryName);
  const outputDirectory = path.join(reconstructionDirectory, outputDirectoryName);
  const assetDirectory = path.join(reconstructionDirectory, assetDirectoryName);

  await mkdir(inputDirectory, { recursive: true });
  await mkdir(outputDirectory, { recursive: true });
  await mkdir(assetDirectory, { recursive: true });

  return {
    assetDirectory,
    inputDirectory,
    outputDirectory,
    reconstructionDirectory,
    sessionDirectory,
  };
}

async function listFilesRecursively(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        files.push(...await listFilesRecursively(entryPath));
      } else if (entry.isFile()) {
        files.push(entryPath);
      }
    }

    return files;
  } catch {
    return [];
  }
}

function getAvatarAssetType(filePath) {
  const name = path.basename(filePath).toLowerCase();
  const extension = path.extname(name);

  if (extension === ".glb") {
    return "glb";
  }

  if (extension === ".gltf") {
    return "gltf";
  }

  if (extension === ".obj") {
    return "obj";
  }

  if (extension === ".ply" || extension === ".splat" || extension === ".ksplat") {
    return name.includes("lhm") || name.includes("gaussian") || extension !== ".ply"
      ? "gaussian-splat"
      : "ply";
  }

  if (name.includes("temporal-fit") && extension === ".json") {
    return "temporal-fit";
  }

  if (name.includes("smpl") && extension === ".json") {
    return "smplx-params";
  }

  if (name.includes("diagnostic") && extension === ".json") {
    return "diagnostics";
  }

  if ([".png", ".jpg", ".jpeg", ".webp"].includes(extension)) {
    return "preview-image";
  }

  return null;
}

function getAssetLabel(type, fileName) {
  if (type === "glb" || type === "gltf") {
    return "Web avatar model";
  }

  if (type === "smplx-params") {
    return "SMPL-X parameters";
  }

  if (type === "temporal-fit") {
    return "Temporal camera and pose fit";
  }

  if (type === "gaussian-splat") {
    return "LHM Gaussian avatar";
  }

  if (type === "preview-image") {
    return "Preview render";
  }

  if (type === "diagnostics") {
    return "Worker diagnostics";
  }

  return fileName;
}

function getSelfHostedAvatarSetup() {
  return {
    activeCommand: getSelfHostedAvatarCommand() || null,
    bundledWorkerFile: existsSync(bundledWorkerFile)
      ? relativeToWorkspace(bundledWorkerFile)
      : null,
    commandEnvVar: "SELF_HOSTED_AVATAR_COMMAND",
    commandSource: getSelfHostedAvatarCommandSource(),
    defaultCommand: getBundledAvatarCommand() || null,
    expectedCommandContract:
      "Command receives request JSON and output directory as positional args, or use {input}/{output} placeholders.",
    modelRoots: {
      econ: process.env.ECON_HOME ?? defaultEconHome,
      lhm: process.env.LHM_HOME ?? defaultLhmHome,
      lhmPlusPlus: process.env.LHMPP_HOME ?? defaultLhmPlusPlusHome,
      smplx: process.env.SMPLX_MODEL_DIR ?? defaultSmplxModelDir,
    },
  };
}

function isSelfHostedAvatarCommandConfigured() {
  return Boolean(getSelfHostedAvatarCommand());
}

function getSelfHostedAvatarCommand() {
  const configured = String(process.env.SELF_HOSTED_AVATAR_COMMAND ?? "").trim();

  if (configured) {
    return configured;
  }

  return getBundledAvatarCommand();
}

function getBundledAvatarCommand() {
  if (!existsSync(bundledWorkerFile)) {
    return "";
  }

  const python = existsSync("/usr/local/bin/python3.11") ? "/usr/local/bin/python3.11" : "python3";
  return `${shellQuote(python)} ${shellQuote(bundledWorkerFile)} {input} {output}`;
}

function getSelfHostedAvatarCommandSource() {
  if (String(process.env.SELF_HOSTED_AVATAR_COMMAND ?? "").trim()) {
    return "env";
  }

  if (getBundledAvatarCommand()) {
    return "bundled";
  }

  return "missing";
}

function getWorkerRunNote() {
  return getSelfHostedAvatarCommandSource() === "env"
    ? "Running configured self-hosted reconstruction worker."
    : "Running bundled self-hosted worker with local SMPL-X/ECON/LHM discovery.";
}

function normalizeAssets(sessionId, assets) {
  return Array.isArray(assets)
    ? assets
        .filter((asset) => asset && typeof asset.file === "string")
        .map((asset) => ({
          ...asset,
          provider: asset.provider ?? provider,
          status: "ready",
          url: getAvatarAssetUrl(sessionId, asset.file),
        }))
    : [];
}

async function writeAvatarJob(reconstructionDirectory, job) {
  await writeJson(path.join(reconstructionDirectory, jobFileName), job);
}

async function writeAvatarAssets(reconstructionDirectory, assets) {
  await writeJson(path.join(reconstructionDirectory, assetManifestFileName), assets);
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2));
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function dataUrlToBuffer(dataUrl) {
  const [, payload] = dataUrl.split(",", 2);

  if (!payload) {
    throw new Error("Invalid frame data URL.");
  }

  return Buffer.from(payload, "base64");
}

function getDataUrlExtension(dataUrl) {
  const match = /^data:image\/([a-zA-Z0-9.+-]+);base64,/.exec(dataUrl);
  const type = match?.[1]?.toLowerCase();

  if (type === "jpeg") {
    return "jpg";
  }

  return type && /^[a-z0-9]+$/.test(type) ? type : null;
}

function getAvatarAssetUrl(sessionId, assetFile) {
  return `/api/scan-sessions/${encodeURIComponent(sessionId)}/avatar-assets/${assetFile
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

function getSessionDirectory(sessionId) {
  return path.join(uploadRoot, sanitizePathSegment(sessionId));
}

function sanitizePathSegment(value) {
  const sanitized = String(value).replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
  return sanitized.slice(0, 96) || `scan-${Date.now()}`;
}

function sanitizeAssetName(value) {
  const sanitized = String(value).replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
  return sanitized.slice(0, 128) || `asset-${Date.now()}`;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function trimLogLines(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-80);
}

function relativeToWorkspace(filePath) {
  return path.relative(process.cwd(), filePath);
}

function loadLocalEnvironmentFile(fileName) {
  const filePath = path.resolve(/*turbopackIgnore: true*/ process.cwd(), fileName);

  if (!existsSync(filePath)) {
    return;
  }

  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);

    if (!match || process.env[match[1]] !== undefined) {
      continue;
    }

    process.env[match[1]] = parseEnvironmentValue(match[2]);
  }
}

function parseEnvironmentValue(value) {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed.replace(/\s+#.*$/, "");
}
