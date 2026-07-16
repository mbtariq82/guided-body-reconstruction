# Temporal Perspective SMPL-X Fitting

Updated: 2026-07-16

## Purpose

The temporal refiner turns a collection of guided-video observations into one identity-consistent SMPL-X body. It starts from the calibrated measurement fit, then jointly uses multiple views instead of treating each silhouette as an independent width measurement.

The CPU implementation is deliberately dependency-light. It is a reproducible research baseline for camera and pose optimisation, not a claim that monocular clothed reconstruction is solved.

## Selected Evidence

The refiner selects up to 14 quality-approved full-body frames. It balances neutral geometry frames by estimated yaw and time, then adds the best available T-pose, overhead Y-pose, wide-stance, and controlled-motion frames. Face and hand close-ups are excluded because they do not share the full-body camera framing.

Every selected frame must contain:

- Image dimensions.
- A valid person mask.
- Usable MoveNet landmarks with confidence scores.
- Capture state, timestamp, and estimated yaw.

Older requests without explicit image dimensions remain usable because the fitter reads dimensions from the JPEG header.

## Model

One ten-dimensional SMPL-X shape vector is shared by every selected frame. The fitted variables are:

- Shared shape betas.
- Shared focal length, camera pitch, and camera roll.
- Per-frame camera-plane translation and positive depth.
- Per-frame SMPL-X body pose.
- Per-frame correction to the capture-derived body yaw.

The principal point is fixed at the image centre. Focal length is initialized from the larger image dimension and regularized around that prior. Geometry-frame depth, pose, and yaw corrections receive temporal consistency penalties.

## Objective

Optimisation runs in three stages so camera errors are not immediately absorbed by body shape:

1. Perspective camera and global yaw correction.
2. Camera plus per-frame articulated body pose.
3. Shared shape plus camera, pose, and differentiable silhouette supervision.

The combined loss contains:

- Confidence-weighted robust 2D joint reprojection.
- Differentiable soft-Dice loss against the complete person mask.
- Pose-deviation and temporal pose priors.
- Temporal yaw and absolute yaw-correction priors.
- Camera rotation, focal-length, and geometry-depth priors.
- Shape anchor to the metric measurement fit and a weak zero-shape prior.

The silhouette renderer samples deterministic SMPL-X triangle centroids, projects them with the fitted perspective camera, and splats them into a low-resolution soft occupancy mask. This provides gradients across the full mask on CPU. It is an approximation to full triangle rasterization and can miss thin boundaries or poorly sampled regions.

## Outputs and Diagnostics

`smplx-temporal-fit.json` records:

- Initial and final landmark RMSE in pixels.
- Initial and final mean soft-silhouette Dice.
- Shared camera parameters and focal-to-image-height ratio.
- Initial and final shape betas.
- Every selected frame, its source role, optimized yaw, pose, translation, depth, RMSE, and silhouette Dice.
- Per-stage loss terms and optimization settings.

The final neutral A-pose GLB is regenerated from the refined shared betas. If the temporal stage is disabled, receives insufficient evidence, or throws an exception, the worker preserves the preceding measurement-based result and writes the skip or failure reason into diagnostics.

## Runtime Controls

- `SMPLX_TEMPORAL_ENABLE=0` disables the refiner.
- `SMPLX_TEMPORAL_MAX_FRAMES` controls the selected-frame cap, from 4 to 20.
- `SMPLX_CAMERA_ITERATIONS`, `SMPLX_POSE_ITERATIONS`, and `SMPLX_SILHOUETTE_ITERATIONS` control optimization work.
- `SMPLX_RENDER_HEIGHT` controls soft-mask resolution.
- `SMPLX_SURFACE_POINT_COUNT` controls sampled surface density.
- `SMPLX_SPLAT_SIGMA_PX` controls point-splat radius.

The default 14-frame CPU configuration takes roughly half a minute on the current Apple Silicon development machine. This should be re-benchmarked per hardware and pipeline revision.

## Research Basis

- SMPLify-X fits expressive SMPL-X bodies from body, hand, face, and foot detections with learned priors: https://openaccess.thecvf.com/content_CVPR_2019/html/Pavlakos_Expressive_Body_Capture_3D_Hands_Face_and_Body_From_a_CVPR_2019_paper.html
- MoRF shares shape across a monocular sequence while optimizing per-frame pose, silhouette Dice, and temporal consistency: https://openaccess.thecvf.com/content/WACV2024/html/Bashirov_MoRF_Mobile_Realistic_Fullbody_Avatars_From_a_Monocular_Video_WACV_2024_paper.html
- BLADE demonstrates joint full-perspective camera and body optimization with differentiable rasterization: https://openaccess.thecvf.com/content/CVPR2025/html/Wang_BLADE_Single-view_Body_Mesh_Estimation_through_Accurate_Depth_Estimation_CVPR_2025_paper.html

## Known Limits

- MoveNet supplies only 17 sparse landmarks and no reliable toe, heel, finger, or dense facial constraints.
- The browser sequence stores selected JPEG observations; the worker does not yet decode and track all continuous-video frames.
- Clothing and hair are included in person masks but are not represented by naked-body SMPL-X, so silhouette pressure can bias shape outward.
- Principal point and lens distortion are not calibrated.
- Back-view left-right ambiguity is regularized, not fully resolved by the sparse landmarks.
- Soft point splatting is less geometrically exact than differentiable triangle rasterization.
- Monocular depth and body thickness remain underconstrained without learned priors or an external metric reference.
