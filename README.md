# Guided Body Reconstruction

A self-hosted research platform for reconstructing accurate, metric digital humans from a guided smartphone video.

The project is deliberately focused on human digitisation. It does not contain wardrobe selection, garment fit scoring, virtual try-on providers, or clothing catalogue code.

## Mission

Build the most accurate smartphone-based human digitisation pipeline possible by treating capture, calibration, model fitting, validation, and uncertainty as one system.

The target output is not merely a plausible avatar. It is a traceable human model with:

- Metric body shape and measurements.
- Recognisable identity and surface detail.
- SMPL-X body, hand, jaw, and facial parameters.
- Per-frame pose and camera estimates.
- A web-viewable GLB and reproducible reconstruction metadata.
- Explicit capture coverage, confidence, and failure diagnostics.

## Current System

The first working milestone includes:

- A guided fixed-camera smartphone capture flow.
- Front and back holds, both side profiles, four slow quarter-turn sweeps, T/Y/wide-stance visibility poses, controlled arm motion, and separate face and hand detail passes.
- Continuous MP4/WebM recording with phase timestamps.
- Quality-gated JPEG reference frames selected from the temporal sequence.
- MoveNet landmarks and locally hosted MediaPipe person segmentation.
- Compact RLE person masks, body bounds, framing metrics, estimated yaw, and camera settings in the session manifest.
- Height-calibrated local measurements.
- Local session validation, processing, storage, and diagnostics.
- A bundled self-hosted SMPL-X worker.
- Direct SMPL-X beta optimisation against calibrated measurements and yaw-balanced silhouette profiles from every approved neutral-turn frame.
- A temporal perspective refiner that shares one identity shape while solving focal length, camera pitch/roll, per-frame depth, translation, yaw correction, and body pose.
- Confidence-weighted robust 2D landmark reprojection plus differentiable full-mask soft-silhouette supervision over sampled SMPL-X surface points.
- Smooth-normal GLB export with SMPL-X parameters and fitting diagnostics.
- A reconstruction workbench with surface, silhouette, and topology inspection modes.
- Optional ECON, LHM, and LHM++ adapter discovery for future checkpoint-backed reconstruction.

## Capture Protocol

The phone remains fixed while the subject moves. Geometry phases keep the full body and feet visible at a constant zoom:

1. Neutral front A-pose.
2. Front-to-left sweep.
3. Left profile hold.
4. Left-to-back sweep.
5. Back hold.
6. Back-to-right sweep.
7. Right profile hold.
8. Right-to-front sweep.
9. Static T-pose for shoulder, arm, and armpit visibility.
10. Static overhead Y-pose for shoulder articulation and torso-side visibility.
11. Static wide stance for inner-leg and lower-body visibility.
12. Controlled arm raise for temporal joint tracking.
13. Close face pass with small head turns.
14. Close open-palm hand pass.

Each geometry frame records its capture role and estimated yaw. The worker receives eight angle-balanced references, the complete approved frame sequence, temporal video metadata, masks, landmarks, measurements, and camera metadata.

The evidence and planned ablations behind this sequence are documented in [`docs/capture-protocol-research.md`](docs/capture-protocol-research.md).

## Run Locally

```bash
npm install
npm run build
npm run start -- --hostname 0.0.0.0 --port 3100
```

Open `http://127.0.0.1:3100` on the development machine.

Phone camera access requires a secure origin. For quick research testing, expose the local server with a temporary HTTPS tunnel:

```bash
cloudflared tunnel --url http://127.0.0.1:3100 --no-autoupdate
```

The repository also contains a Windows local-certificate proxy:

```bash
npm run https-proxy
```

## SMPL-X Setup

SMPL-X model files are intentionally ignored by Git. Place the downloaded files under:

```text
.avatar-models/smplx/models/smplx/SMPLX_NEUTRAL.npz
.avatar-models/smplx/models/smplx/SMPLX_MALE.npz
.avatar-models/smplx/models/smplx/SMPLX_FEMALE.npz
```

Install the lightweight worker dependencies:

```bash
npm run setup-avatar-worker
```

Process and reconstruct a captured session:

```bash
npm run process-scans
npm run reconstruct-avatar -- <session-id> --force
```

The bundled CPU path writes:

- `smplx-avatar.glb`
- `smplx-params.json`
- `smplx-temporal-fit.json`
- `diagnostics.json`
- a fallback GLB only when SMPL-X cannot run

Set `SMPLX_GENDER=neutral`, `male`, or `female` to select an available body model. The default is `neutral`.

The temporal refiner runs by default and falls back to the measurement fit if it cannot use at least three frames. Set `SMPLX_TEMPORAL_ENABLE=0` to disable it. Research runs can tune `SMPLX_TEMPORAL_MAX_FRAMES`, `SMPLX_CAMERA_ITERATIONS`, `SMPLX_POSE_ITERATIONS`, `SMPLX_SILHOUETTE_ITERATIONS`, `SMPLX_RENDER_HEIGHT`, and `SMPLX_SURFACE_POINT_COUNT`.

Run its deterministic frame-selection and mask tests with:

```bash
npm run test-avatar-worker
```

## Research Backends

The reconstruction adapter discovers ignored local repositories at:

```text
.avatar-models/repos/ECON
.avatar-models/repos/LHM
.avatar-models/repos/LHM-plusplus
```

Use `AVATAR_WORKER_BACKEND=smplx`, `econ`, `lhm`, `lhmpp`, or `all` after installing the backend-specific dependencies and checkpoints. A completely custom worker can be supplied with:

```bash
SELF_HOSTED_AVATAR_COMMAND="python /path/to/reconstruct.py {input} {output}" npm run reconstruct-avatar -- <session-id>
```

## Important Routes

- `/` - guided capture application
- `/sessions` - reconstruction session dashboard
- `/sessions/[sessionId]` - human model workbench, evidence, measurements, and frame review
- `/api/scan-sessions` - session upload and listing
- `/api/scan-sessions/[sessionId]/process` - validation and local processing
- `/api/scan-sessions/[sessionId]/avatar-reconstruction` - reconstruction status and execution
- `/api/scan-sessions/[sessionId]/avatar-assets/[...assetPath]` - generated model assets

## Repository Structure

- `app/` - Next.js pages and local API routes
- `components/scanner/` - guided capture and quality UI
- `components/sessions/` - reconstruction inspection and session controls
- `hooks/` - camera, pose, segmentation, and temporal capture hooks
- `lib/reconstruction-profile.ts` - reconstruction-grade capture contract
- `services/` - frame quality, segmentation, pose, camera, upload, and packaging
- `scripts/process-scan-jobs.mjs` - validation, measurements, and reconstruction handoff
- `scripts/self_hosted_avatar_worker.py` - SMPL-X and research-backend adapter
- `scripts/smplx_temporal_fitter.py` - perspective camera, per-frame pose, and soft-silhouette optimisation
- `types/` - versioned capture and reconstruction contracts
- `.scan-uploads/` - ignored local session and output store
- `.avatar-models/` - ignored models, repositories, and checkpoints

## Accuracy Roadmap

The current SMPL-X pipeline is measurement-, landmark-, and silhouette-constrained across representative frames from the guided sequence. It is a useful metric human prior with an explicit temporal camera model, not yet the final likeness system.

The next accuracy milestones are:

1. Replace sparse MoveNet observations with dense body, foot, hand, and face landmarks and stable temporal tracks.
2. Decode and fit denser samples from the continuous video instead of only the quality-approved reference sequence.
3. Replace the CPU surface-point silhouette approximation with triangle rasterization on a Linux/NVIDIA worker.
4. Calibrate or infer camera intrinsics from device metadata instead of relying on a focal prior.
5. Add learned normal and depth priors for clothed surface refinement.
6. Run LHM++ or an equivalent identity reconstruction model with local checkpoints and register it to SMPL-X.
7. Build scan-to-scan repeatability benchmarks against tape, body scanner, and motion-capture ground truth.
8. Report per-measurement uncertainty and request retakes using expected information gain.

Accuracy claims must be backed by a versioned benchmark cohort, repeat scans, calibrated ground truth, and published error distributions. Visual plausibility alone is not an accuracy metric.

## Data and Licensing

Capture sessions contain sensitive biometric imagery. Keep `.scan-uploads/`, models, checkpoints, credentials, and generated identity assets out of Git. Add authentication, encryption, retention controls, consent records, and deletion workflows before any deployment beyond controlled research.

SMPL-X and the optional research backends have their own model and code licences. Confirm the applicable terms before production or commercial use.
