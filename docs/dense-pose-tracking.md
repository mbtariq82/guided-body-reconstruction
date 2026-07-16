# Dense Pose Tracking

Updated: 2026-07-16

## Goal

Capture temporally consistent body evidence between saved JPEG keyframes without requiring the reconstruction host to decode every browser-specific MP4 or WebM variant.

## Capture Runtime

The phone runs the full MediaPipe BlazePose model through the TensorFlow.js pose-detection interface in video mode. Model binaries and WebAssembly assets are served from the installed `@mediapipe/pose` package through an allowlisted same-origin API route, so capture does not depend on a model CDN.

Inference targets one observation every 180 ms and uses MediaPipe temporal smoothing. Each accepted observation contains:

- Timestamp relative to the MediaRecorder start.
- Video-start offset relative to the capture session, so track samples and JPEG keyframes share one timeline.
- Capture state, phase progress, and protocol-derived yaw.
- Raw sensor width and height.
- 33 image landmarks with visibility scores and relative depth.
- 33 root-relative world landmarks with visibility scores.

Landmarks are never horizontally flipped before storage. The user-facing front-camera preview may be mirrored with CSS, but JPEGs and recorded video use raw sensor coordinates; keeping landmarks in that same coordinate system prevents reprojection mismatch.

## Archive Contract

The compressed session contains:

```text
video/guided-scan-<timestamp>.mp4|webm
tracks/guided-pose-track-<timestamp>.json
```

The manifest stores track metadata and frame count, while the large frame array remains in `guided-pose-track.v1`. Validation checks file presence, schema, frame count, dimensions, and minimum 2D/3D landmark coverage before reconstruction.

## SMPL-X Fusion

The worker preserves two complementary observation classes:

- Mask-bearing JPEG keyframes provide full-silhouette and 2D landmark losses.
- Dense-track samples provide additional 2D landmarks, feet and coarse hand constraints, and learned 3D pose structure.

Selection is balanced by capture yaw and time. New tracked scans use an adaptive 18-observation optimization budget with at least eight mask-bearing geometry views where available. Legacy scans retain their 14-frame behavior.

World landmarks are compared to SMPL-X with confidence-weighted, normalized pairwise distances. This term is invariant to global translation and scale, so learned BlazePose coordinates cannot override entered height or calibrated silhouette measurements.

## Research Basis

- MediaPipe Pose Landmarker for Web returns 33 image and world landmarks in video mode: https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js
- The TensorFlow.js BlazePose interface exposes 33 image keypoints, 33 world keypoints, and video smoothing: https://github.com/tensorflow/tfjs-models/tree/master/pose-detection
- MoRF shares SMPL-X identity across a monocular sequence and filters temporally inconsistent pose evidence: https://openaccess.thecvf.com/content/WACV2024/html/Bashirov_MoRF_Mobile_Realistic_Fullbody_Avatars_From_a_Monocular_Video_WACV_2024_paper.html

## Limits

- The 180 ms target is best effort; thermal throttling and browser scheduling can reduce the observed rate.
- BlazePose world coordinates are learned pose estimates, not calibrated metric depth.
- Close face and hand passes need dedicated face-mesh and hand landmark models.
- Track observations do not carry silhouettes; JPEG masks remain necessary.
- The fitter currently selects representative track samples rather than optimizing every recorded observation.
- Track confidence is used directly; robust trajectory-level outlier and occlusion rejection remain the next milestone.
