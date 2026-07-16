# Guided Capture Protocol Research

Updated: 2026-07-15

## Research Question

Which observations should a single fixed smartphone capture so that one shared SMPL-X identity is better constrained than it would be by a few front and side photographs?

The working answer is not unrestricted movement or maximum frame count. The useful evidence is a calibrated neutral turn, a small set of poses that reveal normally occluded body regions, temporal continuity, and separate close views for parts that are too small in a full-body frame.

## Evidence

- [Video Based Reconstruction of 3D People Models](https://openaccess.thecvf.com/content_cvpr_2018/html/Alldieck_Video_Based_Reconstruction_CVPR_2018_paper.html) recovers a consensus body from many monocular silhouettes and reports that known height improves scale. This supports a slow full turn, many registered views, and a metric height anchor.
- [Learning to Reconstruct People in Clothing](https://openaccess.thecvf.com/content_CVPR_2019/html/Alldieck_Learning_to_Reconstruct_People_in_Clothing_From_a_Single_RGB_CVPR_2019_paper.html) fuses one to eight moving-person frames in a canonical pose. Multiple views reduce single-image ambiguity, but only after pose alignment.
- [SMPL-X](https://openaccess.thecvf.com/content_CVPR_2019/html/Pavlakos_Expressive_Body_Capture_3D_Hands_Face_and_Body_From_a_CVPR_2019_paper.html) fits body, hands, feet, and face jointly. A full-body frame cannot supply adequate face and finger resolution, so dedicated detail observations are necessary.
- [SelfRecon](https://openaccess.thecvf.com/content/CVPR2022/html/Jiang_SelfRecon_Self_Reconstruction_Your_Digital_Avatar_From_Monocular_Video_CVPR_2022_paper.html) uses a self-rotating monocular video, differentiable masks, and a coherent explicit body to aggregate observations into one subject.
- [MoRF](https://openaccess.thecvf.com/content/WACV2024/html/Bashirov_MoRF_Mobile_Realistic_Fullbody_Avatars_From_a_Monocular_Video_WACV_2024_paper.html) uses approximately one minute of monocular video, shares SMPL-X identity shape across frames, and filters temporally inconsistent pose estimates. Its limitations explicitly include silhouette inflation from loose clothing and missing observations at the top of the head, soles, and armpits.
- [SPEC](https://openaccess.thecvf.com/content/ICCV2021/html/Kocabas_SPEC_Seeing_People_in_the_Wild_With_an_Estimated_Camera_ICCV_2021_paper.html) and [Zolly](https://openaccess.thecvf.com/content/ICCV2023/html/Wang_Zolly_Zoom_Focal_Length_Correctly_for_Perspective-Distorted_Human_Mesh_Reconstruction_ICCV_2023_paper.html) show that incorrect focal length, camera rotation, and close-camera perspective create body-shape errors. Fixed 1x capture from farther away is preferable to ultrawide or close full-body capture.
- [Boost 3D Reconstruction using Diffusion-based Monocular Camera Calibration](https://openaccess.thecvf.com/content/ICCV2025/html/Deng_Boost_3D_Reconstruction_using_Diffusion-based_Monocular_Camera_Calibration_ICCV_2025_paper.html) further demonstrates that better camera intrinsics improve metric depth, pose, and sparse-view reconstruction. Camera calibration remains part of the estimator, not merely setup advice.

## Protocol V2

### Setup

1. Use the rear 1x camera. Do not use digital zoom or the 0.5x ultrawide lens.
2. Fix the phone in portrait orientation at approximately pelvis height. The phone must not move during the full-body sequence.
3. Stand approximately 2.5 to 3 metres away, then adjust until tracked head-to-ankle height occupies roughly 48% to 86% of the image.
4. Enter measured standing height. Bare feet, a visible floor contact, and a level camera are preferred.
5. Wear fitted, matte clothing; tie back long hair; remove jackets, skirts, large accessories, and reflective items.
6. Use even front/side lighting and a plain background with contrast against clothing and skin.

### Full-Body Sequence

1. Neutral front A-pose: exposes torso boundaries while keeping arms from merging with the waist.
2. Slow 360-degree turn with explicit left, back, and right holds: constrains width, depth, posture, and view-consistent identity.
3. Static T-pose: exposes armpits and constrains shoulders, elbows, wrists, and arm span.
4. Static overhead Y-pose: exposes shoulder undersides, upper torso sides, and a second shoulder articulation.
5. Static wide stance: separates the inner legs and constrains hips, knees, ankles, and leg length.
6. One controlled arm raise/lower: supplies temporal joint trajectories and catches rig or pose-tracking failures.

### Detail Sequence

1. Close face pass: neutral front plus small left/right head turns for face shape, ears, jaw, hairline, and texture.
2. Close hand pass: both palms, fingers spread. Future protocol revisions should add backs of hands and independent left/right crops once dense hand tracking is active.

Spoken prompts are enabled because a person using the rear camera cannot reliably inspect the screen. A second person may monitor the quality indicators, but the protocol is designed for self-capture.

## How Frames Are Used

- Neutral-turn frames contribute silhouette evidence to shared SMPL-X shape.
- T, Y, wide-stance, and motion frames constrain pose, limb proportions, visibility, and future clothed-surface reconstruction. Their silhouettes must not be interpreted as neutral torso cross-sections.
- Face and hand frames contribute part landmarks and appearance. They must not affect body scale.
- Every approved neutral frame is retained. Loss weights are normalised within 45-degree yaw bins so a long front hold cannot outweigh less frequent side views.
- Continuous video remains the source for future per-frame pose, camera, optical-flow, and temporal-consistency estimation.

## Current Limits

The V2 worker still uses section-profile silhouette losses rather than full differentiable rendering. It does not yet estimate independent per-frame SMPL-X pose and perspective camera parameters from the video. MoveNet validates body actions but does not provide facial contours or finger joints. The video is retained for those next stages.

SMPL-X represents an unclothed statistical body prior. A clothing silhouette is not a direct observation of skin. Loose clothing, hair, and masks around crossed limbs require semantic parsing, robust losses, uncertainty, and eventually an explicit clothed surface such as ECON or a registered implicit model.

## Ablation Plan

Run each configuration on repeated captures of the same subjects and compare against a calibrated body scan:

1. Front/side/back keyframes only.
2. Neutral 360 video with yaw-balanced masks.
3. Neutral video plus T-pose.
4. Neutral video plus T and Y poses.
5. Full V2 protocol including wide stance and controlled motion.
6. Full V2 with estimated camera intrinsics and per-frame perspective cameras.
7. Full V2 with dense differentiable silhouettes and temporal SMPL-X fitting.

Report per-vertex error, region-wise surface distance, measurement MAE, joint error, scan-to-scan repeatability, rejected-frame rate, and uncertainty calibration. The capture protocol should change only when an ablation produces a repeatable gain.
