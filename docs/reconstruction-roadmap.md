# Human Reconstruction Roadmap

Updated: 2026-07-13

## Accuracy Objective

Recover a metric, animatable, identity-consistent human model from one guided smartphone capture. Optimise for repeatable geometric error and identity similarity, not only visual plausibility.

## Implemented Baseline

- Fixed-camera full-body geometry pass with a closed 360-degree turn.
- Neutral front/back holds and both side-profile holds.
- Controlled arm motion isolated from body-shape fitting.
- Separate high-resolution face and hands pass.
- Continuous temporal video plus quality-approved keyframes.
- Angle-balanced reference selection using estimated yaw.
- MoveNet landmarks and local MediaPipe person masks.
- Calibrated measurements and direct multi-view silhouette profile constraints.
- Shared SMPL-X beta fitting and smooth-normal GLB export.
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

1. Replace sparse pose landmarks with dense body, face, and hand landmarks plus world coordinates.
2. Add a calibrated perspective camera model and solve intrinsics/extrinsics jointly.
3. Replace section-width silhouette losses with differentiable full-mask rendering.
4. Fit one shared shape over the complete video while allowing per-frame articulation.
5. Add temporal tracking and reject inconsistent masks or landmark identities.
6. Run checkpoint-backed ECON and LHM++ on a Linux/NVIDIA worker.
7. Build automatic face/body registration between the high-detail output and SMPL-X.
8. Add scan repeatability and ground-truth benchmark tooling.
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
