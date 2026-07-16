# Human Reconstruction Roadmap

Updated: 2026-07-16

## Accuracy Objective

Recover a metric, animatable, identity-consistent human model from one guided smartphone capture. Optimise for repeatable geometric error and identity similarity, not only visual plausibility.

## Implemented Baseline

- Fixed-camera full-body geometry pass with a closed 360-degree turn.
- Neutral front/back holds and both side-profile holds.
- T-pose, overhead Y-pose, and wide-stance visibility passes.
- Controlled arm motion isolated from body-shape fitting.
- Separate high-resolution face and hand passes with spoken self-capture guidance.
- Continuous temporal video plus quality-approved keyframes.
- Angle-balanced reference selection using estimated yaw.
- Self-hosted BlazePose with 33 image landmarks, 33 world landmarks, temporal smoothing, and local MediaPipe person masks.
- Synchronized pose-track archives sampled throughout video recording, with phase, yaw, dimensions, and timestamps.
- Calibrated measurements and yaw-balanced silhouette profiles from the complete approved neutral sequence.
- Shared SMPL-X beta fitting and smooth-normal GLB export.
- Shared-focal perspective fitting with camera pitch/roll and per-frame translation, depth, yaw correction, and articulated body pose.
- Confidence-weighted landmark reprojection and differentiable full-mask soft-silhouette fitting over sampled SMPL-X surface points.
- Temporal pose, yaw, and depth consistency priors with explicit per-frame residual diagnostics.
- Scale-normalized 3D pose-structure supervision and mixed selection of dense-track observations plus mask-bearing keyframes.
- Optional ECON, LHM, and LHM++ worker adapters.
- Surface, silhouette, and topology inspection in the web workbench.

## Reconstruction Stack

### Stage 1: Capture and calibration

Retain camera intrinsics where the browser exposes them, actual frame dimensions, focal-length proxies, device orientation, timestamps, exposure stability, rolling-shutter risk, and a metric height anchor. The phone stays fixed during geometry capture.

### Stage 2: Per-frame observations

Extract dense body, hand, and face landmarks; binary and semantic human masks; body-part boundaries; surface normals; depth priors; sharpness; occlusion; and estimated yaw. Preserve every quality-approved temporal frame.

### Stage 3: Shared parametric identity

Fit one SMPL-X identity shape across the entire neutral sequence. Optimise independent per-frame pose, global translation, and camera parameters. Losses should include dense silhouettes, landmarks, temporal consistency, body measurements, pose priors, shape priors, and left-right consistency.

### Stage 4: Surface and identity detail

Use ECON-style normal integration for clothed geometry and LHM++-style identity reconstruction for face, hair, hands, texture, and high-frequency surface detail. Maintain explicit registration back to SMPL-X for animation and measurement.

### Stage 5: Validation and uncertainty

Report per-measurement error estimates, capture coverage, fitting residuals, view disagreement, and low-confidence body regions. Retakes should be requested only when the expected information gain is meaningful.

## Engineering Milestones

1. Add robust temporal outlier rejection, occlusion reasoning, identity checks, and track uncertainty.
2. Add dedicated face-mesh and 21-point hand tracks for close detail phases.
3. Replace CPU surface-point splatting with differentiable triangle rasterization on a Linux/NVIDIA worker.
4. Retain or estimate calibrated intrinsics, lens distortion, and principal point from device metadata and calibration captures.
5. Run checkpoint-backed ECON and LHM++ on a Linux/NVIDIA worker.
6. Build automatic face/body registration between the high-detail output and SMPL-X.
7. Add scan repeatability and ground-truth benchmark tooling.
8. Add uncertainty-aware retake guidance driven by anatomical coverage and residual disagreement.
9. Add consent, encryption, retention, export, and deletion controls for biometric data.

## Benchmark Protocol

For every pipeline version, record:

- Mean absolute error by body measurement.
- Surface-to-scan distance by anatomical region.
- Joint-position error in neutral and articulated poses.
- Face identity similarity using a documented evaluation model.
- Same-subject repeatability across devices, operators, lighting, and clothing.
- Failure rate and retake rate.
- Runtime, memory, and hardware class.

Use calibrated tape or anthropometer measurements, a reference body scanner, and motion-capture data where available. Publish distributions and cohort details instead of a single average accuracy number.

## Research References

- SMPL-X: https://smpl-x.is.tue.mpg.de/
- SMPLify-X: https://github.com/vchoutas/smplify-x
- ECON: https://econ.is.tue.mpg.de/
- LHM++: https://github.com/aigc3d/LHM-plusplus
- EasyMocap: https://github.com/zju3dv/EasyMocap
- 4DHumans: https://github.com/shubham-goel/4D-Humans
- MediaPipe Pose Landmarker: https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker
- Capture protocol evidence and ablations: ./capture-protocol-research.md
- Temporal perspective fitting design and limits: ./temporal-perspective-fitting.md
- Dense pose tracking format and data flow: ./dense-pose-tracking.md
