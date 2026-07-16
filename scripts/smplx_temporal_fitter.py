"""Perspective, temporal SMPL-X fitting for guided monocular sequences."""

from __future__ import annotations

import math
import os
import json
from pathlib import Path
from typing import Any


POSE_TO_SMPLX = {
    "nose": 55,
    "left_eye": 57,
    "right_eye": 56,
    "left_ear": 59,
    "right_ear": 58,
    "left_shoulder": 16,
    "right_shoulder": 17,
    "left_elbow": 18,
    "right_elbow": 19,
    "left_wrist": 20,
    "right_wrist": 21,
    "left_pinky": 70,
    "right_pinky": 75,
    "left_index": 67,
    "right_index": 72,
    "left_thumb": 66,
    "right_thumb": 71,
    "left_hip": 1,
    "right_hip": 2,
    "left_knee": 4,
    "right_knee": 5,
    "left_ankle": 7,
    "right_ankle": 8,
    "left_heel": 62,
    "right_heel": 65,
    "left_foot_index": 60,
    "right_foot_index": 63,
    "mouth_left": 113,
    "mouth_right": 107,
}

GEOMETRY_STATES = {
    "front-view",
    "rotate-left",
    "side-view",
    "rotate-to-back",
    "back-view",
    "rotate-right",
    "right-side-view",
    "return-front",
}

ACTION_STATES = (
    "arm-span",
    "overhead-reach",
    "wide-stance",
    "motion-range",
)


def fit_temporal_smplx(
    *,
    request: dict[str, Any],
    model_dir: Path,
    gender: str,
    initial_betas: Any,
    torch: Any,
) -> tuple[Any, dict[str, Any]]:
    import smplx  # type: ignore

    default_frame_count = "18" if has_pose_track_reference(request) else "14"
    maximum_frames = max(
        4,
        min(24, int(os.environ.get("SMPLX_TEMPORAL_MAX_FRAMES", default_frame_count))),
    )
    selected_frames = select_temporal_frames(request, maximum_frames)

    if len(selected_frames) < 3:
        return initial_betas, {
            "reason": "At least three full-body frames with masks and landmarks are required.",
            "selectedFrameCount": len(selected_frames),
            "status": "skipped",
        }

    prepared_frames = [prepare_frame(frame, torch) for frame in selected_frames]
    prepared_frames = [frame for frame in prepared_frames if frame is not None]

    if len(prepared_frames) < 3:
        return initial_betas, {
            "reason": "Selected frames were missing image dimensions, masks, or usable landmarks.",
            "selectedFrameCount": len(prepared_frames),
            "status": "skipped",
        }

    batch_size = len(prepared_frames)
    model = smplx.create(
        str(model_dir),
        model_type="smplx",
        gender=gender,
        ext="npz",
        flat_hand_mean=True,
        num_betas=10,
        use_pca=False,
        batch_size=batch_size,
    )
    initial_pose = build_initial_body_poses(prepared_frames, torch)
    initial_yaw = torch.tensor(
        [[0.0, math.radians(normalize_signed_yaw(frame["yawDeg"])), 0.0]
         for frame in prepared_frames],
        dtype=torch.float32,
    )
    betas = torch.nn.Parameter(initial_betas.detach().clone())
    body_pose = torch.nn.Parameter(initial_pose.clone())
    yaw_delta = torch.nn.Parameter(torch.zeros((batch_size,), dtype=torch.float32))
    camera_pitch_roll = torch.nn.Parameter(torch.zeros((2,), dtype=torch.float32))
    widths = torch.tensor([frame["width"] for frame in prepared_frames], dtype=torch.float32)
    heights = torch.tensor([frame["height"] for frame in prepared_frames], dtype=torch.float32)
    initial_focal_px = float(max(float(widths.max()), float(heights.max())) * 1.2)
    log_focal = torch.nn.Parameter(torch.tensor(math.log(initial_focal_px), dtype=torch.float32))

    with torch.no_grad():
        initial_output = model(
            betas=betas.expand(batch_size, -1),
            body_pose=body_pose,
            global_orient=initial_yaw,
            return_verts=True,
        )
        camera_xy_value, log_depth_value = initialize_cameras(
            initial_output.vertices,
            prepared_frames,
            initial_focal_px,
            torch,
        )

    camera_xy = torch.nn.Parameter(camera_xy_value)
    log_depth = torch.nn.Parameter(log_depth_value)
    target_keypoints, keypoint_weights, joint_indices = build_keypoint_targets(
        prepared_frames,
        torch,
    )
    render_height = max(32, min(72, int(os.environ.get("SMPLX_RENDER_HEIGHT", "48"))))
    median_aspect = sorted(frame["width"] / frame["height"] for frame in prepared_frames)[
        len(prepared_frames) // 2
    ]
    render_width = max(20, min(96, round(render_height * median_aspect)))
    target_masks = build_target_masks(prepared_frames, render_height, render_width, torch)
    temporal_indices = [
        index for index, frame in enumerate(prepared_frames) if frame["isGeometry"]
    ]
    if not temporal_indices:
        temporal_indices = list(range(batch_size))
    silhouette_indices = [
        index
        for index, frame in enumerate(prepared_frames)
        if frame["isGeometry"] and frame["hasMask"]
    ]
    if not silhouette_indices:
        silhouette_indices = [
            index for index, frame in enumerate(prepared_frames) if frame["hasMask"]
        ]
    target_world, world_weights = build_world_targets(prepared_frames, torch)
    surface_face_indices = sample_surface_faces(
        model.faces,
        max(600, min(4000, int(os.environ.get("SMPLX_SURFACE_POINT_COUNT", "1800")))),
        torch,
    )
    context = {
        "bodyPose": body_pose,
        "cameraPitchRoll": camera_pitch_roll,
        "cameraXy": camera_xy,
        "silhouetteIndices": silhouette_indices,
        "temporalIndices": temporal_indices,
        "heights": heights,
        "initialBetas": initial_betas.detach().clone(),
        "initialFocal": initial_focal_px,
        "initialPose": initial_pose,
        "initialYaw": initial_yaw,
        "jointIndices": joint_indices,
        "keypointWeights": keypoint_weights,
        "logDepth": log_depth,
        "logFocal": log_focal,
        "model": model,
        "renderHeight": render_height,
        "renderWidth": render_width,
        "surfaceFaceIndices": surface_face_indices,
        "targetKeypoints": target_keypoints,
        "targetMasks": target_masks,
        "targetWorld": target_world,
        "torch": torch,
        "widths": widths,
        "worldWeights": world_weights,
        "yawDelta": yaw_delta,
        "betas": betas,
    }

    initial_metrics = evaluate_fit(context, include_silhouette=True)
    stage_history = []
    stage_history.append(run_optimisation_stage(
        "perspective-camera",
        [camera_xy, log_depth, log_focal, yaw_delta, camera_pitch_roll],
        max(1, int(os.environ.get("SMPLX_CAMERA_ITERATIONS", "24"))),
        0.04,
        context,
        silhouette_weight=0.0,
    ))
    stage_history.append(run_optimisation_stage(
        "per-frame-pose",
        [camera_xy, log_depth, log_focal, yaw_delta, camera_pitch_roll, body_pose],
        max(1, int(os.environ.get("SMPLX_POSE_ITERATIONS", "20"))),
        0.025,
        context,
        silhouette_weight=0.0,
    ))
    stage_history.append(run_optimisation_stage(
        "shared-shape-soft-silhouette",
        [
            camera_xy,
            log_depth,
            log_focal,
            yaw_delta,
            camera_pitch_roll,
            body_pose,
            betas,
        ],
        max(1, int(os.environ.get("SMPLX_SILHOUETTE_ITERATIONS", "10"))),
        0.012,
        context,
        silhouette_weight=max(
            0.0,
            float(os.environ.get("SMPLX_SOFT_SILHOUETTE_WEIGHT", "0.16")),
        ),
    ))
    final_metrics = evaluate_fit(context, include_silhouette=True)
    frame_results = build_frame_results(prepared_frames, context)
    focal_px = float(torch.exp(log_focal).detach())

    return betas.detach(), {
        "cameraModel": {
            "focalLengthOptimized": True,
            "focalLengthPx": round(focal_px, 3),
            "focalLengthToImageHeight": round(focal_px / float(heights.median()), 6),
            "lensDistortionModel": "none",
            "pitchDeg": round(math.degrees(float(camera_pitch_roll[0].detach())), 4),
            "principalPoint": "image-center",
            "principalPointOptimized": False,
            "rollDeg": round(math.degrees(float(camera_pitch_roll[1].detach())), 4),
            "type": "full-perspective",
        },
        "finalMetrics": final_metrics,
        "frameCount": batch_size,
        "frames": frame_results,
        "densePoseTrackFrameCount": sum(
            1 for frame in prepared_frames if frame["sourceType"] == "pose-track"
        ),
        "geometryFrameCount": len(temporal_indices),
        "initialMetrics": initial_metrics,
        "method": "confidence-weighted SMPL-X joints plus differentiable soft-silhouette point splatting",
        "schemaVersion": "smplx-temporal-perspective-fit.v1",
        "shapeModel": {
            "initialBetas": [
                round(float(value), 6)
                for value in initial_betas.detach().cpu()[0]
            ],
            "refinedBetas": [
                round(float(value), 6)
                for value in betas.detach().cpu()[0]
            ],
        },
        "softRasterizer": {
            "renderHeight": render_height,
            "renderWidth": render_width,
            "surfacePointCount": int(surface_face_indices.shape[0]),
        },
        "silhouetteFrameCount": len(silhouette_indices),
        "stages": stage_history,
        "status": "succeeded",
    }


def select_temporal_frames(request: dict[str, Any], maximum_frames: int) -> list[dict[str, Any]]:
    sequence = request.get("inputSequence")
    frames = sequence.get("frames") if isinstance(sequence, dict) else None
    frames = frames if isinstance(frames, list) else []

    pose_track_frames = load_pose_track_frames(request)
    candidates = [
        frame
        for frame in [*frames, *pose_track_frames]
        if is_temporal_candidate(frame)
    ]
    geometry = [frame for frame in candidates if is_geometry_frame(frame)]
    actions = []

    for state in ACTION_STATES:
        matches = [frame for frame in candidates if frame.get("state") == state]
        if matches:
            actions.append(max(matches, key=frame_observation_score))

    geometry_slots = min(
        len(geometry),
        max(min(8, maximum_frames), maximum_frames - len(actions)),
    )
    action_slots = max(0, maximum_frames - geometry_slots)
    actions = actions[:action_slots]
    selected_geometry = select_geometry_sources(geometry, geometry_slots)
    selected = selected_geometry + actions
    selected_ids = {frame_identity(frame) for frame in selected}

    if len(selected) < maximum_frames:
        remaining = sorted(
            [frame for frame in candidates if frame_identity(frame) not in selected_ids],
            key=frame_observation_score,
            reverse=True,
        )
        selected.extend(remaining[:maximum_frames - len(selected)])

    return sorted(selected, key=lambda frame: float(frame.get("elapsedMs") or 0))


def has_pose_track_reference(request: dict[str, Any]) -> bool:
    input_sequence = request.get("inputSequence")
    metadata = input_sequence.get("poseTrack") if isinstance(input_sequence, dict) else None
    return isinstance(metadata, dict) and isinstance(metadata.get("file"), str)


def is_temporal_candidate(frame: Any) -> bool:
    if not isinstance(frame, dict):
        return False

    if not (is_geometry_frame(frame) or frame.get("state") in ACTION_STATES):
        return False

    vision = frame.get("vision")
    segmentation = vision.get("segmentation") if isinstance(vision, dict) else None
    mask = segmentation.get("mask") if isinstance(segmentation, dict) else None
    keypoints = vision.get("keypoints") if isinstance(vision, dict) else None
    visible_count = sum(
        1 for point in keypoints or []
        if isinstance(point, dict)
        and point.get("name") in POSE_TO_SMPLX
        and isinstance(point.get("score"), (int, float))
        and float(point["score"]) >= 0.25
    )
    has_dense_track = frame.get("sourceType") == "pose-track"
    return (isinstance(mask, dict) or has_dense_track) and visible_count >= 8


def load_pose_track_frames(request: dict[str, Any]) -> list[dict[str, Any]]:
    input_sequence = request.get("inputSequence")
    metadata = input_sequence.get("poseTrack") if isinstance(input_sequence, dict) else None
    file_value = metadata.get("file") if isinstance(metadata, dict) else None

    if not isinstance(file_value, str) or not file_value:
        return []

    track_path = Path(file_value)
    if not track_path.is_absolute():
        track_path = Path.cwd() / track_path

    try:
        payload = json.loads(track_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []

    if payload.get("schemaVersion") != "guided-pose-track.v1":
        return []

    frames = payload.get("frames")
    if not isinstance(frames, list):
        return []
    timeline_offset = payload.get("sessionElapsedOffsetMs")
    timeline_offset = (
        float(timeline_offset)
        if isinstance(timeline_offset, (int, float))
        else 0.0
    )

    converted = []
    for index, frame in enumerate(frames):
        if not isinstance(frame, dict):
            continue
        state = str(frame.get("state") or "unknown")
        converted.append({
            "elapsedMs": timeline_offset + float(frame.get("elapsedMs") or 0),
            "height": frame.get("height"),
            "phaseProgress": frame.get("phaseProgress"),
            "reconstruction": {
                "captureRole": "geometry" if state in GEOMETRY_STATES else "motion",
                "poseTarget": get_pose_target(state),
            },
            "sourceFile": f"{track_path.name}#{index:05d}",
            "sourceType": "pose-track",
            "state": state,
            "vision": {
                "keypoints": frame.get("keypoints"),
                "provider": payload.get("provider", "mediapipe-blazepose"),
                "worldKeypoints": frame.get("worldKeypoints"),
            },
            "width": frame.get("width"),
            "yawDeg": frame.get("yawDeg"),
        })
    return converted


def get_pose_target(state: str) -> str:
    return {
        "arm-span": "t-pose",
        "overhead-reach": "y-pose",
        "wide-stance": "wide-stance",
        "motion-range": "controlled-motion",
    }.get(state, "neutral-a")


def select_geometry_sources(
    frames: list[dict[str, Any]],
    target_count: int,
) -> list[dict[str, Any]]:
    if target_count <= 0:
        return []

    mask_frames = [frame for frame in frames if has_segmentation_mask(frame)]
    track_frames = [frame for frame in frames if frame.get("sourceType") == "pose-track"]

    if not track_frames:
        return select_angle_and_time_balanced(mask_frames, target_count)

    mask_slots = min(
        len(mask_frames),
        target_count,
        max(min(8, target_count), round(target_count * 0.64)),
    )
    track_slots = min(len(track_frames), target_count - mask_slots)
    selected = [
        *select_angle_and_time_balanced(mask_frames, mask_slots),
        *select_angle_and_time_balanced(track_frames, track_slots),
    ]
    selected_ids = {frame_identity(frame) for frame in selected}

    if len(selected) < target_count:
        remaining = sorted(
            [frame for frame in frames if frame_identity(frame) not in selected_ids],
            key=frame_observation_score,
            reverse=True,
        )
        selected.extend(remaining[:target_count - len(selected)])

    return selected[:target_count]


def has_segmentation_mask(frame: dict[str, Any]) -> bool:
    vision = frame.get("vision")
    segmentation = vision.get("segmentation") if isinstance(vision, dict) else None
    return isinstance(segmentation, dict) and isinstance(segmentation.get("mask"), dict)


def is_geometry_frame(frame: dict[str, Any]) -> bool:
    reconstruction = frame.get("reconstruction")
    if isinstance(reconstruction, dict) and reconstruction.get("captureRole"):
        return reconstruction.get("captureRole") == "geometry"
    return frame.get("state") in GEOMETRY_STATES


def select_angle_and_time_balanced(
    frames: list[dict[str, Any]],
    target_count: int,
) -> list[dict[str, Any]]:
    if target_count <= 0 or not frames:
        return []
    if len(frames) <= target_count:
        return list(frames)

    selected: list[dict[str, Any]] = []
    selected_ids: set[str] = set()

    for yaw_bin in range(8):
        matches = [
            frame for frame in frames
            if get_yaw_bin(float(frame.get("yawDeg") or 0)) == yaw_bin
        ]
        if not matches:
            continue
        best = max(matches, key=frame_observation_score)
        selected.append(best)
        selected_ids.add(frame_identity(best))
        if len(selected) >= target_count:
            return selected

    remaining = [frame for frame in frames if frame_identity(frame) not in selected_ids]
    needed = target_count - len(selected)
    if needed > 0 and remaining:
        for index in evenly_spaced_indices(len(remaining), needed):
            frame = remaining[index]
            if frame_identity(frame) not in selected_ids:
                selected.append(frame)
                selected_ids.add(frame_identity(frame))

    return selected[:target_count]


def evenly_spaced_indices(length: int, count: int) -> list[int]:
    if count <= 0 or length <= 0:
        return []
    if count >= length:
        return list(range(length))
    if count == 1:
        return [length // 2]
    return [round(index * (length - 1) / (count - 1)) for index in range(count)]


def frame_observation_score(frame: dict[str, Any]) -> float:
    vision = frame.get("vision")
    keypoints = vision.get("keypoints") if isinstance(vision, dict) else []
    scores = [
        float(point["score"])
        for point in keypoints or []
        if isinstance(point, dict)
        and point.get("name") in POSE_TO_SMPLX
        and isinstance(point.get("score"), (int, float))
    ]
    segmentation = vision.get("segmentation") if isinstance(vision, dict) else None
    quality = segmentation.get("quality") if isinstance(segmentation, dict) else "poor"
    quality_bonus = {"good": 2.0, "partial": 0.8}.get(str(quality), 0.0)
    world_keypoints = vision.get("worldKeypoints") if isinstance(vision, dict) else None
    world_bonus = min(2.5, len(world_keypoints or []) / 12) if isinstance(world_keypoints, list) else 0
    return sum(scores) + quality_bonus + world_bonus


def frame_identity(frame: dict[str, Any]) -> str:
    return str(frame.get("sourceFile") or frame.get("file") or id(frame))


def prepare_frame(frame: dict[str, Any], torch: Any) -> dict[str, Any] | None:
    width = frame.get("width")
    height = frame.get("height")
    if not isinstance(width, (int, float)) or not isinstance(height, (int, float)):
        dimensions = read_jpeg_dimensions(resolve_frame_path(frame.get("file")))
        if dimensions:
            width, height = dimensions
    if not isinstance(width, (int, float)) or not isinstance(height, (int, float)):
        return None
    if width <= 0 or height <= 0:
        return None

    vision = frame.get("vision")
    segmentation = vision.get("segmentation") if isinstance(vision, dict) else None
    mask = decode_rle_mask(segmentation.get("mask") if isinstance(segmentation, dict) else None)
    if mask is None and frame.get("sourceType") != "pose-track":
        return None
    keypoints = {
        str(point.get("name")): point
        for point in (vision.get("keypoints") if isinstance(vision, dict) else []) or []
        if isinstance(point, dict)
    }
    mapped_keypoints = [name for name in keypoints if name in POSE_TO_SMPLX]
    if len(mapped_keypoints) < 8:
        return None
    world_keypoints = {
        str(point.get("name")): point
        for point in (vision.get("worldKeypoints") if isinstance(vision, dict) else []) or []
        if isinstance(point, dict)
    }

    reconstruction = frame.get("reconstruction")
    pose_target = reconstruction.get("poseTarget") if isinstance(reconstruction, dict) else None
    return {
        "elapsedMs": float(frame.get("elapsedMs") or 0),
        "height": float(height),
        "hasMask": mask is not None,
        "isGeometry": is_geometry_frame(frame),
        "keypoints": keypoints,
        "mask": torch.tensor(mask, dtype=torch.float32) if mask is not None else None,
        "poseTarget": str(pose_target or "neutral-a"),
        "sourceFile": str(frame.get("sourceFile") or frame.get("file") or "frame"),
        "sourceType": str(frame.get("sourceType") or "keyframe"),
        "state": str(frame.get("state") or "unknown"),
        "width": float(width),
        "worldKeypoints": world_keypoints,
        "yawDeg": float(frame.get("yawDeg") or 0),
    }


def build_initial_body_poses(frames: list[dict[str, Any]], torch: Any) -> Any:
    poses = torch.zeros((len(frames), 63), dtype=torch.float32)
    for index, frame in enumerate(frames):
        pose_target = frame["poseTarget"]
        poses[index, 15 * 3 + 2] = -1.05
        poses[index, 16 * 3 + 2] = 1.05
        if pose_target == "t-pose":
            poses[index, 15 * 3 + 2] = 0.0
            poses[index, 16 * 3 + 2] = 0.0
        elif pose_target == "y-pose":
            poses[index, 15 * 3 + 2] = 0.9
            poses[index, 16 * 3 + 2] = -0.9
        elif pose_target == "wide-stance":
            poses[index, 0 * 3 + 2] = 0.2
            poses[index, 1 * 3 + 2] = -0.2
    return poses


def build_keypoint_targets(
    frames: list[dict[str, Any]],
    torch: Any,
) -> tuple[Any, Any, Any]:
    names = list(POSE_TO_SMPLX)
    targets = torch.zeros((len(frames), len(names), 2), dtype=torch.float32)
    weights = torch.zeros((len(frames), len(names)), dtype=torch.float32)
    for frame_index, frame in enumerate(frames):
        for point_index, name in enumerate(names):
            point = frame["keypoints"].get(name)
            if not isinstance(point, dict):
                continue
            score = point.get("score")
            x = point.get("x")
            y = point.get("y")
            if not all(isinstance(value, (int, float)) for value in [score, x, y]):
                continue
            if float(score) < 0.2:
                continue
            targets[frame_index, point_index, 0] = 2 * float(x) / frame["width"] - 1
            targets[frame_index, point_index, 1] = 2 * float(y) / frame["height"] - 1
            weights[frame_index, point_index] = min(1.0, max(0.0, float(score))) ** 2
    indices = torch.tensor([POSE_TO_SMPLX[name] for name in names], dtype=torch.long)
    return targets, weights, indices


def build_world_targets(
    frames: list[dict[str, Any]],
    torch: Any,
) -> tuple[Any, Any]:
    names = list(POSE_TO_SMPLX)
    targets = torch.zeros((len(frames), len(names), 3), dtype=torch.float32)
    weights = torch.zeros((len(frames), len(names)), dtype=torch.float32)

    for frame_index, frame in enumerate(frames):
        for point_index, name in enumerate(names):
            point = frame["worldKeypoints"].get(name)
            if not isinstance(point, dict):
                continue
            score = point.get("score")
            x = point.get("x")
            y = point.get("y")
            z = point.get("z")
            if not all(isinstance(value, (int, float)) for value in [score, x, y, z]):
                continue
            if float(score) < 0.2:
                continue
            targets[frame_index, point_index] = torch.tensor(
                [float(x), float(y), float(z)],
                dtype=torch.float32,
            )
            weights[frame_index, point_index] = min(1.0, max(0.0, float(score))) ** 2

    return targets, weights


def build_target_masks(
    frames: list[dict[str, Any]],
    render_height: int,
    render_width: int,
    torch: Any,
) -> Any:
    import torch.nn.functional as functional

    masks = []
    for frame in frames:
        if frame["mask"] is None:
            masks.append(torch.zeros((render_height, render_width), dtype=torch.float32))
            continue
        resized = functional.interpolate(
            frame["mask"][None, None],
            size=(render_height, render_width),
            mode="bilinear",
            align_corners=False,
        )[0, 0]
        masks.append(resized.clamp(0, 1))
    return torch.stack(masks)


def initialize_cameras(
    vertices: Any,
    frames: list[dict[str, Any]],
    focal_px: float,
    torch: Any,
) -> tuple[Any, Any]:
    camera_xy = torch.zeros((len(frames), 2), dtype=torch.float32)
    depths = torch.zeros((len(frames),), dtype=torch.float32)
    for index, frame in enumerate(frames):
        mask = frame["mask"]
        bounds = binary_mask_bounds(mask) if mask is not None else None
        if bounds is not None and mask is not None:
            left, top, right, bottom = bounds
            mask_height, mask_width = mask.shape
            target_center_x = ((left + right + 1) / (2 * mask_width)) * 2 - 1
            target_center_y = ((top + bottom + 1) / (2 * mask_height)) * 2 - 1
            observed_height_px = max(
                1.0,
                (bottom - top + 1) / mask_height * frame["height"],
            )
        else:
            visible = [
                point
                for name, point in frame["keypoints"].items()
                if name in POSE_TO_SMPLX
                and isinstance(point.get("score"), (int, float))
                and float(point["score"]) >= 0.25
            ]
            if len(visible) < 4:
                depths[index] = 2.5
                continue
            xs = [float(point["x"]) for point in visible]
            ys = [float(point["y"]) for point in visible]
            target_center_x = ((min(xs) + max(xs)) / (2 * frame["width"])) * 2 - 1
            target_center_y = ((min(ys) + max(ys)) / (2 * frame["height"])) * 2 - 1
            observed_height_px = max(1.0, max(ys) - min(ys))

        if observed_height_px <= 1:
            depths[index] = 2.5
            continue
        model_height = float(vertices[index, :, 1].max() - vertices[index, :, 1].min())
        depth = min(8.0, max(0.7, focal_px * model_height / observed_height_px))
        model_center_x = float((vertices[index, :, 0].max() + vertices[index, :, 0].min()) / 2)
        model_center_y = float((vertices[index, :, 1].max() + vertices[index, :, 1].min()) / 2)
        camera_xy[index, 0] = target_center_x * frame["width"] * depth / (2 * focal_px) - model_center_x
        camera_xy[index, 1] = -target_center_y * frame["height"] * depth / (2 * focal_px) - model_center_y
        depths[index] = depth
    return camera_xy, torch.log(depths)


def run_optimisation_stage(
    name: str,
    parameters: list[Any],
    iterations: int,
    learning_rate: float,
    context: dict[str, Any],
    *,
    silhouette_weight: float,
) -> dict[str, Any]:
    torch = context["torch"]
    optimizer = torch.optim.Adam(parameters, lr=learning_rate)
    initial_terms: dict[str, float] | None = None
    final_terms: dict[str, float] = {}

    for _ in range(iterations):
        optimizer.zero_grad()
        loss, terms = calculate_objective(context, silhouette_weight)
        if initial_terms is None:
            initial_terms = detach_terms(terms)
        loss.backward()
        optimizer.step()
        clamp_parameters(context)
        final_terms = detach_terms(terms)

    return {
        "final": final_terms,
        "initial": initial_terms or {},
        "iterations": iterations,
        "learningRate": learning_rate,
        "name": name,
        "silhouetteWeight": silhouette_weight,
    }


def calculate_objective(
    context: dict[str, Any],
    silhouette_weight: float,
) -> tuple[Any, dict[str, Any]]:
    torch = context["torch"]
    global_orient = context["initialYaw"].clone()
    global_orient[:, 1] += context["yawDelta"]
    output = context["model"](
        betas=context["betas"].expand(context["bodyPose"].shape[0], -1),
        body_pose=context["bodyPose"],
        global_orient=global_orient,
        return_verts=True,
    )
    projected_joints = project_points(
        output.joints[:, context["jointIndices"]],
        context,
    )
    residual = projected_joints - context["targetKeypoints"]
    keypoint_error = robust_huber(residual, 0.035, torch).sum(dim=-1)
    keypoint_loss = (
        keypoint_error * context["keypointWeights"]
    ).sum() / context["keypointWeights"].sum().clamp_min(1.0)
    pose_prior = (context["bodyPose"] - context["initialPose"]).square().mean()
    yaw_prior = context["yawDelta"].square().mean()
    camera_rotation_prior = context["cameraPitchRoll"].square().mean()
    focal_prior = (
        context["logFocal"] - math.log(context["initialFocal"])
    ).square()
    beta_anchor = (context["betas"] - context["initialBetas"]).square().mean()
    beta_prior = context["betas"].square().mean()
    temporal_indices = context["temporalIndices"]
    temporal_depths = context["logDepth"][temporal_indices]
    depth_consistency = temporal_depths.var(unbiased=False) if len(temporal_indices) > 1 else temporal_depths.sum() * 0
    temporal_pose = temporal_pose_loss(context["bodyPose"], temporal_indices, torch)
    temporal_yaw = temporal_scalar_loss(context["yawDelta"], temporal_indices)
    world_pose = pairwise_world_pose_loss(
        output.joints[:, context["jointIndices"]],
        context["targetWorld"],
        context["worldWeights"],
        torch,
    )
    silhouette_loss = keypoint_loss * 0

    if silhouette_weight > 0 and context["silhouetteIndices"]:
        rendered = render_soft_silhouettes(output.vertices, context)
        targets = context["targetMasks"][context["silhouetteIndices"]]
        silhouette_loss = soft_dice_loss(rendered, targets, torch)

    total = (
        keypoint_loss
        + silhouette_weight * silhouette_loss
        + 0.018 * pose_prior
        + 0.035 * temporal_pose
        + 0.11 * temporal_yaw
        + 0.07 * world_pose
        + 0.05 * yaw_prior
        + 0.08 * camera_rotation_prior
        + 0.018 * focal_prior
        + 0.025 * depth_consistency
        + 0.09 * beta_anchor
        + 0.0015 * beta_prior
    )
    return total, {
        "betaAnchor": beta_anchor,
        "cameraRotationPrior": camera_rotation_prior,
        "depthConsistency": depth_consistency,
        "focalPrior": focal_prior,
        "keypoint": keypoint_loss,
        "posePrior": pose_prior,
        "silhouette": silhouette_loss,
        "temporalPose": temporal_pose,
        "temporalYaw": temporal_yaw,
        "total": total,
        "worldPose": world_pose,
        "yawPrior": yaw_prior,
    }


def project_points(points: Any, context: dict[str, Any]) -> Any:
    torch = context["torch"]
    rotation = camera_rotation_matrix(context["cameraPitchRoll"], torch)
    camera_points = torch.einsum("ij,bnj->bni", rotation, points)
    x = camera_points[..., 0] + context["cameraXy"][:, None, 0]
    y = camera_points[..., 1] + context["cameraXy"][:, None, 1]
    z = (camera_points[..., 2] + torch.exp(context["logDepth"])[:, None]).clamp_min(0.2)
    focal = torch.exp(context["logFocal"])
    projected_x = 2 * focal * x / (z * context["widths"][:, None])
    projected_y = -2 * focal * y / (z * context["heights"][:, None])
    return torch.stack([projected_x, projected_y], dim=-1)


def camera_rotation_matrix(pitch_roll: Any, torch: Any) -> Any:
    pitch, roll = pitch_roll[0], pitch_roll[1]
    one = torch.ones_like(pitch)
    zero = torch.zeros_like(pitch)
    cos_pitch, sin_pitch = torch.cos(pitch), torch.sin(pitch)
    cos_roll, sin_roll = torch.cos(roll), torch.sin(roll)
    rotation_x = torch.stack([
        one, zero, zero,
        zero, cos_pitch, -sin_pitch,
        zero, sin_pitch, cos_pitch,
    ]).reshape(3, 3)
    rotation_z = torch.stack([
        cos_roll, -sin_roll, zero,
        sin_roll, cos_roll, zero,
        zero, zero, one,
    ]).reshape(3, 3)
    return rotation_z @ rotation_x


def render_soft_silhouettes(vertices: Any, context: dict[str, Any]) -> Any:
    torch = context["torch"]
    silhouette_indices = context["silhouetteIndices"]
    geometry_vertices = vertices[silhouette_indices]
    face_indices = context["surfaceFaceIndices"]
    surface_points = geometry_vertices[:, face_indices].mean(dim=2)
    geometry_context = {
        **context,
        "cameraXy": context["cameraXy"][silhouette_indices],
        "heights": context["heights"][silhouette_indices],
        "logDepth": context["logDepth"][silhouette_indices],
        "widths": context["widths"][silhouette_indices],
    }
    projected = project_points(surface_points, geometry_context)
    render_height = context["renderHeight"]
    render_width = context["renderWidth"]
    grid_y = torch.linspace(-1, 1, render_height, dtype=torch.float32)
    grid_x = torch.linspace(-1, 1, render_width, dtype=torch.float32)
    mesh_y, mesh_x = torch.meshgrid(grid_y, grid_x, indexing="ij")
    grid = torch.stack([mesh_x.reshape(-1), mesh_y.reshape(-1)], dim=-1)
    density = torch.zeros((projected.shape[0], grid.shape[0]), dtype=torch.float32)
    sigma_px = max(0.7, float(os.environ.get("SMPLX_SPLAT_SIGMA_PX", "1.15")))
    point_chunk_size = 240

    for start in range(0, projected.shape[1], point_chunk_size):
        points = projected[:, start:start + point_chunk_size]
        dx = (points[:, :, None, 0] - grid[None, None, :, 0]) * (render_width - 1) / 2
        dy = (points[:, :, None, 1] - grid[None, None, :, 1]) * (render_height - 1) / 2
        squared_distance = dx.square() + dy.square()
        density = density + torch.exp(-squared_distance / (2 * sigma_px * sigma_px)).sum(dim=1)

    occupancy = 1 - torch.exp(-0.72 * density)
    return occupancy.reshape(projected.shape[0], render_height, render_width)


def sample_surface_faces(faces: Any, target_count: int, torch: Any) -> Any:
    face_tensor = torch.tensor(faces.tolist(), dtype=torch.long)
    if face_tensor.shape[0] <= target_count:
        return face_tensor
    indices = torch.linspace(0, face_tensor.shape[0] - 1, target_count).long()
    return face_tensor[indices]


def soft_dice_loss(prediction: Any, target: Any, torch: Any) -> Any:
    prediction = prediction.clamp(0, 1)
    target = target.clamp(0, 1)
    intersection = (prediction * target).sum(dim=(1, 2))
    denominator = prediction.sum(dim=(1, 2)) + target.sum(dim=(1, 2))
    dice = (2 * intersection + 1.0) / (denominator + 1.0)
    return 1 - dice.mean()


def temporal_pose_loss(body_pose: Any, geometry_indices: list[int], torch: Any) -> Any:
    if len(geometry_indices) < 2:
        return body_pose.sum() * 0
    geometry_pose = body_pose[geometry_indices]
    return (geometry_pose[1:] - geometry_pose[:-1]).square().mean()


def temporal_scalar_loss(values: Any, geometry_indices: list[int]) -> Any:
    if len(geometry_indices) < 2:
        return values.sum() * 0
    geometry_values = values[geometry_indices]
    return (geometry_values[1:] - geometry_values[:-1]).square().mean()


def pairwise_world_pose_loss(
    predicted: Any,
    target: Any,
    weights: Any,
    torch: Any,
) -> Any:
    if float(weights.sum().detach()) <= 0:
        return predicted.sum() * 0

    pair_weights = weights[:, :, None] * weights[:, None, :]
    triangle = torch.triu(
        torch.ones((weights.shape[1], weights.shape[1]), dtype=torch.float32),
        diagonal=1,
    )
    pair_weights = pair_weights * triangle[None]
    valid_pairs = pair_weights.sum(dim=(1, 2))
    valid_frames = valid_pairs > 8

    if not bool(valid_frames.any()):
        return predicted.sum() * 0

    predicted_distances = torch.cdist(predicted, predicted)
    target_distances = torch.cdist(target, target)
    predicted_scale = (
        (predicted_distances * pair_weights).sum(dim=(1, 2)) /
        valid_pairs.clamp_min(1.0)
    ).clamp_min(1e-4)
    target_scale = (
        (target_distances * pair_weights).sum(dim=(1, 2)) /
        valid_pairs.clamp_min(1.0)
    ).clamp_min(1e-4)
    residual = (
        predicted_distances / predicted_scale[:, None, None] -
        target_distances / target_scale[:, None, None]
    )
    error = robust_huber(residual, 0.08, torch) * pair_weights
    return error[valid_frames].sum() / pair_weights[valid_frames].sum().clamp_min(1.0)


def robust_huber(residual: Any, delta: float, torch: Any) -> Any:
    absolute = torch.abs(residual)
    return torch.where(
        absolute < delta,
        0.5 * absolute.square() / delta,
        absolute - 0.5 * delta,
    )


def clamp_parameters(context: dict[str, Any]) -> None:
    torch = context["torch"]
    with torch.no_grad():
        context["betas"].clamp_(-1.5, 1.5)
        context["bodyPose"].clamp_(-2.6, 2.6)
        context["cameraPitchRoll"].clamp_(-0.28, 0.28)
        context["cameraXy"].clamp_(-3.0, 3.0)
        context["logDepth"].clamp_(math.log(0.5), math.log(8.0))
        context["logFocal"].clamp_(
            math.log(context["initialFocal"] * 0.55),
            math.log(context["initialFocal"] * 2.5),
        )
        context["yawDelta"].clamp_(-0.4, 0.4)


def evaluate_fit(context: dict[str, Any], *, include_silhouette: bool) -> dict[str, Any]:
    torch = context["torch"]
    with torch.no_grad():
        global_orient = context["initialYaw"].clone()
        global_orient[:, 1] += context["yawDelta"]
        output = context["model"](
            betas=context["betas"].expand(context["bodyPose"].shape[0], -1),
            body_pose=context["bodyPose"],
            global_orient=global_orient,
            return_verts=True,
        )
        projected = project_points(output.joints[:, context["jointIndices"]], context)
        pixel_scale = torch.stack([context["widths"] / 2, context["heights"] / 2], dim=-1)
        pixel_error = (projected - context["targetKeypoints"]) * pixel_scale[:, None]
        squared = pixel_error.square().sum(dim=-1)
        weights = context["keypointWeights"]
        rmse = torch.sqrt((squared * weights).sum() / weights.sum().clamp_min(1.0))
        result = {
            "landmarkRmsePx": round(float(rmse), 3),
            "meanDepthM": round(float(torch.exp(context["logDepth"]).mean()), 5),
        }
        world_pose = pairwise_world_pose_loss(
            output.joints[:, context["jointIndices"]],
            context["targetWorld"],
            context["worldWeights"],
            torch,
        )
        if float(context["worldWeights"].sum()) > 0:
            result["normalizedWorldPoseError"] = round(float(world_pose), 6)
        if include_silhouette and context["silhouetteIndices"]:
            rendered = render_soft_silhouettes(output.vertices, context)
            targets = context["targetMasks"][context["silhouetteIndices"]]
            dice = 1 - soft_dice_loss(rendered, targets, torch)
            result["meanSoftSilhouetteDice"] = round(float(dice), 6)
        return result


def build_frame_results(
    frames: list[dict[str, Any]],
    context: dict[str, Any],
) -> list[dict[str, Any]]:
    torch = context["torch"]
    with torch.no_grad():
        global_orient = context["initialYaw"].clone()
        global_orient[:, 1] += context["yawDelta"]
        output = context["model"](
            betas=context["betas"].expand(len(frames), -1),
            body_pose=context["bodyPose"],
            global_orient=global_orient,
            return_verts=True,
        )
        projected = project_points(output.joints[:, context["jointIndices"]], context)
        geometry_dice = {}
        if context["silhouetteIndices"]:
            rendered = render_soft_silhouettes(output.vertices, context)
            for local_index, frame_index in enumerate(context["silhouetteIndices"]):
                target = context["targetMasks"][frame_index:frame_index + 1]
                prediction = rendered[local_index:local_index + 1]
                geometry_dice[frame_index] = float(1 - soft_dice_loss(prediction, target, torch))

        results = []
        for index, frame in enumerate(frames):
            scale = torch.tensor([frame["width"] / 2, frame["height"] / 2])
            pixel_error = (projected[index] - context["targetKeypoints"][index]) * scale
            squared = pixel_error.square().sum(dim=-1)
            weights = context["keypointWeights"][index]
            rmse = torch.sqrt((squared * weights).sum() / weights.sum().clamp_min(1.0))
            results.append({
                "bodyPose": [round(float(value), 6) for value in context["bodyPose"][index]],
                "cameraTranslationM": [
                    round(float(context["cameraXy"][index, 0]), 6),
                    round(float(context["cameraXy"][index, 1]), 6),
                    round(float(torch.exp(context["logDepth"][index])), 6),
                ],
                "globalOrientation": [round(float(value), 6) for value in global_orient[index]],
                "height": round(frame["height"]),
                "landmarkRmsePx": round(float(rmse), 3),
                "softSilhouetteDice": round(geometry_dice[index], 6) if index in geometry_dice else None,
                "sourceFile": frame["sourceFile"],
                "sourceType": frame["sourceType"],
                "state": frame["state"],
                "width": round(frame["width"]),
                "yawDeg": round(frame["yawDeg"], 3),
                "worldKeypointCount": len(frame["worldKeypoints"]),
                "yawCorrectionDeg": round(
                    math.degrees(float(context["yawDelta"][index])),
                    3,
                ),
                "optimizedYawDeg": round(
                    math.degrees(float(global_orient[index, 1])) % 360,
                    3,
                ),
            })
        return results


def detach_terms(terms: dict[str, Any]) -> dict[str, float]:
    return {key: round(float(value.detach()), 8) for key, value in terms.items()}


def decode_rle_mask(payload: Any) -> list[list[int]] | None:
    if not isinstance(payload, dict) or payload.get("encoding") != "rle":
        return None
    width = payload.get("width")
    height = payload.get("height")
    counts = payload.get("counts")
    if not isinstance(width, int) or not isinstance(height, int) or not isinstance(counts, list):
        return None
    values: list[int] = []
    current = 0
    for count in counts:
        if not isinstance(count, int) or count < 0:
            return None
        values.extend([current] * count)
        current = 1 - current
    if len(values) != width * height:
        return None
    return [values[row * width:(row + 1) * width] for row in range(height)]


def binary_mask_bounds(mask: Any) -> tuple[int, int, int, int] | None:
    nonzero = mask.nonzero(as_tuple=False)
    if nonzero.numel() == 0:
        return None
    top = int(nonzero[:, 0].min())
    bottom = int(nonzero[:, 0].max())
    left = int(nonzero[:, 1].min())
    right = int(nonzero[:, 1].max())
    return left, top, right, bottom


def normalize_signed_yaw(yaw_degrees: float) -> float:
    return ((float(yaw_degrees) + 180) % 360) - 180


def get_yaw_bin(yaw_degrees: float) -> int:
    return int(((yaw_degrees + 22.5) % 360) // 45)


def resolve_frame_path(value: Any) -> Path | None:
    if not isinstance(value, str) or not value:
        return None
    path = Path(value)
    return path if path.is_absolute() else (Path.cwd() / path).resolve()


def read_jpeg_dimensions(file_path: Path | None) -> tuple[int, int] | None:
    if not file_path or not file_path.exists():
        return None
    try:
        with file_path.open("rb") as stream:
            if stream.read(2) != b"\xff\xd8":
                return None
            while True:
                marker_start = stream.read(1)
                if not marker_start:
                    return None
                if marker_start != b"\xff":
                    continue
                marker = stream.read(1)
                while marker == b"\xff":
                    marker = stream.read(1)
                if marker in {b"\xc0", b"\xc1", b"\xc2", b"\xc3", b"\xc5", b"\xc6", b"\xc7", b"\xc9", b"\xca", b"\xcb", b"\xcd", b"\xce", b"\xcf"}:
                    stream.read(3)
                    height = int.from_bytes(stream.read(2), "big")
                    width = int.from_bytes(stream.read(2), "big")
                    return width, height
                length_bytes = stream.read(2)
                if len(length_bytes) != 2:
                    return None
                segment_length = int.from_bytes(length_bytes, "big")
                if segment_length < 2:
                    return None
                stream.seek(segment_length - 2, 1)
    except OSError:
        return None
