#!/usr/bin/env python3
"""Local SMPL-X / ECON / LHM worker adapter.

This worker fits a licensed local SMPL-X model to calibrated measurements,
guided silhouettes, landmarks, and per-frame perspective cameras on CPU, then
exports a web GLB. ECON and LHM remain opt-in refinement hooks.
"""

from __future__ import annotations

import json
import math
import os
import platform
import shutil
import struct
import subprocess
import sys
from pathlib import Path
from typing import Any


def main() -> int:
    if len(sys.argv) < 3:
        print("Usage: self_hosted_avatar_worker.py <request.json> <output-dir>", file=sys.stderr)
        return 2

    request_file = Path(sys.argv[1]).resolve()
    output_dir = Path(sys.argv[2]).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    request = read_json(request_file)
    diagnostics: dict[str, Any] = {
        "environment": collect_environment(),
        "inputs": validate_inputs(request),
        "pipelines": {},
        "requestFile": str(request_file),
        "status": "completed-with-diagnostics",
    }

    produced_files: list[str] = []

    if os.environ.get("SMPLX_ENABLE", "1") != "0":
        diagnostics["pipelines"]["smplx"] = run_smplx(request, request_file, output_dir)
        produced_files.extend(diagnostics["pipelines"]["smplx"].get("producedFiles", []))

    if should_run_backend("econ"):
        diagnostics["pipelines"]["econ"] = run_econ(request, request_file, output_dir)
        produced_files.extend(diagnostics["pipelines"]["econ"].get("producedFiles", []))

    if should_run_backend("lhm"):
        diagnostics["pipelines"]["lhm"] = run_lhm(request, request_file, output_dir)
        produced_files.extend(diagnostics["pipelines"]["lhm"].get("producedFiles", []))

    if should_run_backend("lhmpp"):
        diagnostics["pipelines"]["lhmpp"] = run_lhmpp(request, request_file, output_dir)
        produced_files.extend(diagnostics["pipelines"]["lhmpp"].get("producedFiles", []))

    econ_obj = first_existing_file(output_dir, ["*full.obj", "*_full.obj", "*econ*.obj", "*.obj"])
    if econ_obj and not (output_dir / "avatar.glb").exists():
        try:
            vertices, faces = parse_obj_mesh(econ_obj)
            write_glb(output_dir / "avatar.glb", vertices, faces, color=[0.72, 0.67, 0.61, 1.0])
            diagnostics["pipelines"]["objToGlb"] = {
                "source": str(econ_obj),
                "status": "succeeded",
            }
            produced_files.append(str(output_dir / "avatar.glb"))
        except Exception as error:  # noqa: BLE001 - diagnostics should preserve worker failures.
            diagnostics["pipelines"]["objToGlb"] = {
                "error": str(error),
                "source": str(econ_obj),
                "status": "failed",
            }

    if not has_renderable_model(output_dir):
        fallback = export_fallback_glb(request, request_file, output_dir)
        diagnostics["pipelines"]["fallbackGlb"] = fallback
        if fallback.get("file"):
            produced_files.append(str(fallback["file"]))

    diagnostics["producedFiles"] = sorted(set(produced_files))
    write_json(output_dir / "diagnostics.json", diagnostics)
    print(json.dumps(diagnostics, indent=2))
    return 0


def collect_environment() -> dict[str, Any]:
    smplx_root = get_smplx_model_dir()
    econ_home = get_path_env("ECON_HOME", ".avatar-models/repos/ECON")
    lhm_home = get_path_env("LHM_HOME", ".avatar-models/repos/LHM")
    lhmpp_home = get_path_env("LHMPP_HOME", ".avatar-models/repos/LHM-plusplus")

    return {
        "backend": os.environ.get("AVATAR_WORKER_BACKEND", "smplx"),
        "econHome": str(econ_home) if econ_home else None,
        "econPresent": bool(econ_home and econ_home.exists()),
        "lhmHome": str(lhm_home) if lhm_home else None,
        "lhmPresent": bool(lhm_home and lhm_home.exists()),
        "lhmPlusPlusHome": str(lhmpp_home) if lhmpp_home else None,
        "lhmPlusPlusPresent": bool(lhmpp_home and lhmpp_home.exists()),
        "platform": platform.platform(),
        "python": sys.version,
        "smplxModelDir": str(smplx_root) if smplx_root else None,
        "smplxModelFiles": list_smplx_model_files(smplx_root),
        "torch": detect_torch(),
    }


def validate_inputs(request: dict[str, Any]) -> dict[str, Any]:
    input_frames = request.get("inputFrames", {})
    frame_status = {}

    for label in ["front", "side", "back"]:
        frame_path = resolve_workspace_path(input_frames.get(label))
        frame_status[label] = {
            "exists": bool(frame_path and frame_path.exists()),
            "path": str(frame_path) if frame_path else None,
        }

    reference_views = request.get("inputReferenceViews", [])
    valid_reference_views = [
        view for view in reference_views
        if isinstance(view, dict)
        and (path_value := resolve_workspace_path(view.get("file")))
        and path_value.exists()
    ]
    input_sequence = request.get("inputSequence", {})
    sequence_frames = input_sequence.get("frames") if isinstance(input_sequence, dict) else []
    valid_sequence_frames = [
        frame for frame in sequence_frames
        if isinstance(frame, dict)
        and (path_value := resolve_workspace_path(frame.get("file")))
        and path_value.exists()
    ] if isinstance(sequence_frames, list) else []
    video_metadata = input_sequence.get("video") if isinstance(input_sequence, dict) else None
    video_path = resolve_workspace_path(
        video_metadata.get("file") if isinstance(video_metadata, dict) else None
    )

    local_avatar_path = resolve_workspace_path(request.get("localAvatarReportFile"))
    measurement_path = resolve_workspace_path(request.get("measurementReportFile"))

    return {
        "frames": frame_status,
        "referenceViews": {
            "available": len(valid_reference_views),
            "requested": len(reference_views),
        },
        "sequenceFrames": {
            "available": len(valid_sequence_frames),
            "requested": len(sequence_frames) if isinstance(sequence_frames, list) else 0,
        },
        "temporalVideo": {
            "exists": bool(video_path and video_path.exists()),
            "path": str(video_path) if video_path else None,
        },
        "localAvatarReport": {
            "exists": bool(local_avatar_path and local_avatar_path.exists()),
            "path": str(local_avatar_path) if local_avatar_path else None,
        },
        "measurementReport": {
            "exists": bool(measurement_path and measurement_path.exists()),
            "path": str(measurement_path) if measurement_path else None,
        },
    }


def run_smplx(request: dict[str, Any], request_file: Path, output_dir: Path) -> dict[str, Any]:
    model_dir = get_smplx_model_dir()
    measurement_values = get_measurement_values(request)

    if not model_dir or not model_dir.exists():
        return {"reason": "SMPL-X model directory was not found.", "status": "skipped"}

    if "height" not in measurement_values:
        return {"reason": "A calibrated height is required for SMPL-X fitting.", "status": "skipped"}

    try:
        import smplx  # type: ignore
        import torch  # type: ignore

        gender = os.environ.get("SMPLX_GENDER", "neutral").lower()
        if gender not in {"female", "male", "neutral"}:
            gender = "neutral"

        model = smplx.create(
            str(model_dir),
            model_type="smplx",
            gender=gender,
            ext="npz",
            flat_hand_mean=True,
            num_betas=10,
            use_pca=False,
        )
        body_pose = build_smplx_body_pose(torch)

        with torch.no_grad():
            template_output = model(body_pose=body_pose, return_verts=True)
            template_vertices = template_output.vertices[0]
            template_height = template_vertices[:, 1].max() - template_vertices[:, 1].min()
            normalized_y = (
                template_vertices[:, 1] - template_vertices[:, 1].min()
            ) / template_height
            # Exclude posed arms from torso section measurements.
            torso_mask = template_vertices[:, 0].abs() < template_height * 0.13
            section_masks = {
                "chest": ((normalized_y - 0.70).abs() < 0.018) & torso_mask,
                "hips": ((normalized_y - 0.50).abs() < 0.018) & torso_mask,
                "waist": ((normalized_y - 0.60).abs() < 0.018) & torso_mask,
            }

        target_height_cm = float(measurement_values["height"])
        target_ratios = {
            key: torch.tensor(float(measurement_values[key]) / target_height_cm)
            for key in ["chest", "hips", "shoulderWidth", "waist"]
            if key in measurement_values
        }
        silhouette_observations = get_silhouette_observations(request)
        silhouette_diagnostics = summarize_silhouette_observations(silhouette_observations)
        silhouette_loss_weight = max(
            0.0,
            float(os.environ.get("SMPLX_SILHOUETTE_LOSS_WEIGHT", "0.02")),
        )
        beta_prior_weight = max(
            0.0,
            float(os.environ.get("SMPLX_BETA_PRIOR_WEIGHT", "0.002")),
        )
        betas = torch.zeros((1, 10), dtype=torch.float32, requires_grad=True)
        optimizer = torch.optim.Adam([betas], lr=0.06)
        iterations = max(12, min(120, int(os.environ.get("SMPLX_FIT_ITERATIONS", "45"))))
        final_loss = 0.0

        for _ in range(iterations):
            optimizer.zero_grad()
            output = model(betas=betas, body_pose=body_pose, return_verts=True)
            predictions = predict_smplx_measurement_ratios(
                output.vertices[0],
                output.joints[0],
                section_masks,
                torch,
            )
            weighted_errors = []

            for key, target in target_ratios.items():
                weight = 2.0 if key == "shoulderWidth" else 1.0
                weighted_errors.append(weight * (predictions[key] - target) ** 2)

            weighted_errors.extend(
                predict_silhouette_errors(
                    output.vertices[0],
                    section_masks,
                    silhouette_observations,
                    silhouette_loss_weight,
                    torch,
                )
            )

            loss = sum(weighted_errors) + beta_prior_weight * (betas * betas).mean()
            loss.backward()
            optimizer.step()
            with torch.no_grad():
                betas.clamp_(-1.5, 1.5)
            final_loss = float(loss.detach())

        fitted_betas = betas.detach()
        temporal_fit_file = output_dir / "smplx-temporal-fit.json"
        temporal_fit: dict[str, Any]

        if os.environ.get("SMPLX_TEMPORAL_ENABLE", "1") == "0":
            temporal_fit = {
                "reason": "SMPLX_TEMPORAL_ENABLE is disabled.",
                "status": "skipped",
            }
        else:
            try:
                from smplx_temporal_fitter import fit_temporal_smplx

                fitted_betas, temporal_fit = fit_temporal_smplx(
                    request=request,
                    model_dir=model_dir,
                    gender=gender,
                    initial_betas=fitted_betas,
                    torch=torch,
                )
            except Exception as error:  # noqa: BLE001 - baseline fitting must remain available.
                temporal_fit = {
                    "error": str(error),
                    "reason": "Temporal perspective refinement failed; retained the measurement fit.",
                    "status": "failed",
                }

        write_json(temporal_fit_file, temporal_fit)

        with torch.no_grad():
            fitted_output = model(betas=fitted_betas, body_pose=body_pose, return_verts=True)
            fitted_vertices = fitted_output.vertices[0]
            fitted_height = fitted_vertices[:, 1].max() - fitted_vertices[:, 1].min()
            scale_to_cm = target_height_cm / float(fitted_height)
            fitted_vertices = fitted_vertices * scale_to_cm
            fitted_vertices[:, 1] -= fitted_vertices[:, 1].min()
            fitted_predictions = predict_smplx_measurement_ratios(
                fitted_output.vertices[0],
                fitted_output.joints[0],
                section_masks,
                torch,
            )

        glb_file = output_dir / "smplx-avatar.glb"
        params_file = output_dir / "smplx-params.json"
        write_glb(
            glb_file,
            fitted_vertices.detach().cpu().tolist(),
            model.faces.tolist(),
            color=[0.72, 0.58, 0.48, 1.0],
        )
        write_json(params_file, {
            "achievedMeasurementsCm": {
                key: round(float(value) * target_height_cm, 2)
                for key, value in fitted_predictions.items()
            },
            "betas": [round(float(value), 6) for value in fitted_betas.cpu()[0]],
            "bodyPose": [round(float(value), 6) for value in body_pose.detach().cpu()[0]],
            "fitIterations": iterations,
            "fitLoss": round(final_loss, 8),
            "gender": gender,
            "method": "SMPL-X shared shape fitted to measurements, yaw-balanced silhouettes, temporal landmarks, and perspective cameras",
            "modelDirectory": str(model_dir),
            "schemaVersion": "smplx-guided-multiview-fit.v3",
            "betaPriorWeight": beta_prior_weight,
            "silhouetteObservationCount": len(silhouette_observations),
            "silhouetteFrameCount": silhouette_diagnostics["frameCount"],
            "silhouetteLossWeight": silhouette_loss_weight,
            "silhouetteSequenceFrameCount": silhouette_diagnostics["sequenceFrameCount"],
            "silhouetteViewCount": silhouette_diagnostics["frameCount"],
            "silhouetteYawBinCount": silhouette_diagnostics["yawBinCount"],
            "sourceMeasurementsCm": measurement_values,
            "temporalFit": {
                "cameraModel": temporal_fit.get("cameraModel"),
                "finalMetrics": temporal_fit.get("finalMetrics"),
                "frameCount": temporal_fit.get("frameCount", 0),
                "outputFile": str(temporal_fit_file),
                "status": temporal_fit.get("status", "unknown"),
            },
        })
        return {
            "fitIterations": iterations,
            "fitLoss": round(final_loss, 8),
            "gender": gender,
            "betaPriorWeight": beta_prior_weight,
            "silhouetteObservationCount": len(silhouette_observations),
            "silhouetteFrameCount": silhouette_diagnostics["frameCount"],
            "silhouetteLossWeight": silhouette_loss_weight,
            "silhouetteSequenceFrameCount": silhouette_diagnostics["sequenceFrameCount"],
            "silhouetteViewCount": silhouette_diagnostics["frameCount"],
            "silhouetteYawBinCount": silhouette_diagnostics["yawBinCount"],
            "temporalFit": {
                "finalMetrics": temporal_fit.get("finalMetrics"),
                "frameCount": temporal_fit.get("frameCount", 0),
                "status": temporal_fit.get("status", "unknown"),
            },
            "mesh": {
                "faces": int(len(model.faces)),
                "vertices": int(fitted_vertices.shape[0]),
            },
            "producedFiles": [str(glb_file), str(params_file), str(temporal_fit_file)],
            "status": "succeeded",
        }
    except Exception as error:  # noqa: BLE001 - preserve actionable local diagnostics.
        return {
            "error": str(error),
            "modelDirectory": str(model_dir),
            "status": "failed",
        }


def build_smplx_body_pose(torch: Any) -> Any:
    pose = torch.zeros((1, 63), dtype=torch.float32)
    # SMPL-X starts in a T-pose. Rotate both shoulders into a relaxed A-pose.
    pose[0, 15 * 3 + 2] = -1.05
    pose[0, 16 * 3 + 2] = 1.05
    return pose


def predict_smplx_measurement_ratios(
    vertices: Any,
    joints: Any,
    section_masks: dict[str, Any],
    torch: Any,
) -> dict[str, Any]:
    height = vertices[:, 1].max() - vertices[:, 1].min()
    predictions = {
        key: ellipse_section_circumference(vertices[mask], torch) / height
        for key, mask in section_masks.items()
    }
    # SMPL-X shoulder joints sit inside the skin surface. Add the neutral-model
    # soft-tissue margin so this predicts the externally measured biacromial span.
    predictions["shoulderWidth"] = (
        torch.abs(joints[16, 0] - joints[17, 0]) / height + 0.027
    )
    return predictions


def ellipse_section_circumference(vertices: Any, torch: Any) -> Any:
    width = vertices[:, 0].max() - vertices[:, 0].min()
    depth = vertices[:, 2].max() - vertices[:, 2].min()
    radius_x = width / 2
    radius_z = depth / 2
    return math.pi * (
        3 * (radius_x + radius_z) -
        torch.sqrt((3 * radius_x + radius_z) * (radius_x + 3 * radius_z))
    )


def predict_silhouette_errors(
    vertices: Any,
    section_masks: dict[str, Any],
    observations: list[dict[str, Any]],
    loss_weight: float,
    torch: Any,
) -> list[Any]:
    if not observations or loss_weight <= 0:
        return []

    height = vertices[:, 1].max() - vertices[:, 1].min()
    section_extents: dict[str, tuple[Any, Any]] = {}

    for section, mask in section_masks.items():
        section_vertices = vertices[mask]
        width = section_vertices[:, 0].max() - section_vertices[:, 0].min()
        depth = section_vertices[:, 2].max() - section_vertices[:, 2].min()
        section_extents[section] = (width, depth)

    errors = []
    weights = []

    for observation in observations:
        width, depth = section_extents[observation["section"]]
        yaw_radians = math.radians(float(observation["yawDeg"]))
        predicted_ratio = (
            width * abs(math.cos(yaw_radians)) +
            depth * abs(math.sin(yaw_radians))
        ) / height
        target_ratio = torch.tensor(float(observation["widthRatio"]), dtype=torch.float32)
        observation_weight = float(observation["weight"])
        residual = torch.abs(predicted_ratio - target_ratio)
        huber_delta = 0.025
        robust_error = torch.where(
            residual < huber_delta,
            0.5 * residual * residual / huber_delta,
            residual - 0.5 * huber_delta,
        )
        errors.append(observation_weight * robust_error)
        weights.append(observation_weight)

    # Average over views so recording more frames cannot overpower the metric
    # measurements. Silhouettes are a visual shape cue, not a scale anchor.
    return [loss_weight * sum(errors) / max(sum(weights), 1e-6)]


def get_silhouette_observations(request: dict[str, Any]) -> list[dict[str, Any]]:
    reference_views = request.get("inputReferenceViews")
    input_sequence = request.get("inputSequence")
    sequence_frames = input_sequence.get("frames") if isinstance(input_sequence, dict) else None
    candidates: list[tuple[str, dict[str, Any]]] = []

    if isinstance(sequence_frames, list):
        candidates.extend(
            ("sequence", frame) for frame in sequence_frames if isinstance(frame, dict)
        )

    if isinstance(reference_views, list):
        candidates.extend(
            ("reference", view) for view in reference_views if isinstance(view, dict)
        )

    observations: list[dict[str, Any]] = []
    section_rows = {
        "chest": 0.70,
        "waist": 0.60,
        "hips": 0.50,
    }

    seen_sources: set[str] = set()

    for view_index, (source_kind, view) in enumerate(candidates):
        if not is_geometry_capture(view):
            continue

        source_key = str(view.get("sourceFile") or view.get("file") or view_index)

        if source_key in seen_sources:
            continue

        vision = view.get("vision")
        segmentation = vision.get("segmentation") if isinstance(vision, dict) else None
        mask_payload = segmentation.get("mask") if isinstance(segmentation, dict) else None
        mask = decode_rle_mask(mask_payload)
        yaw_degrees = view.get("yawDeg")

        if mask is None or not isinstance(yaw_degrees, (int, float)):
            continue

        body_bounds = get_binary_mask_bounds(mask)

        if body_bounds is None or body_bounds[3] - body_bounds[1] < 12:
            continue

        body_height = body_bounds[3] - body_bounds[1] + 1
        center_x = (body_bounds[0] + body_bounds[2]) / 2
        view_name = source_key
        segmentation_quality = (
            str(segmentation.get("quality")) if isinstance(segmentation, dict) else "poor"
        )
        observation_weight = {
            "good": 1.0,
            "partial": 0.5,
            "poor": 0.25,
        }.get(segmentation_quality, 0.25)
        previous_observation_count = len(observations)

        for section, normalized_y in section_rows.items():
            row = round(body_bounds[1] + (1 - normalized_y) * (body_height - 1))
            widths = [
                get_central_mask_run_width(mask, row + row_offset, center_x)
                for row_offset in (-1, 0, 1)
            ]
            valid_widths = sorted(width for width in widths if width is not None and width > 1)

            if not valid_widths:
                continue

            width_pixels = valid_widths[len(valid_widths) // 2]
            width_ratio = width_pixels / body_height

            if width_ratio < 0.08 or width_ratio > 0.5:
                continue

            observations.append({
                "section": section,
                "sourceKind": source_kind,
                "view": view_name,
                "weight": observation_weight,
                "widthRatio": width_ratio,
                "yawBin": get_yaw_bin(float(yaw_degrees)),
                "yawDeg": float(yaw_degrees),
            })

        if len(observations) > previous_observation_count:
            seen_sources.add(source_key)

    return balance_silhouette_observations(observations)


def is_geometry_capture(view: dict[str, Any]) -> bool:
    reconstruction = view.get("reconstruction")

    if isinstance(reconstruction, dict) and reconstruction.get("captureRole"):
        return reconstruction.get("captureRole") == "geometry"

    return view.get("state") in {
        "front-view",
        "rotate-left",
        "side-view",
        "rotate-to-back",
        "back-view",
        "rotate-right",
        "right-side-view",
        "return-front",
    }


def get_yaw_bin(yaw_degrees: float) -> int:
    return int(((yaw_degrees + 22.5) % 360) // 45)


def balance_silhouette_observations(
    observations: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    groups: dict[tuple[str, int], list[dict[str, Any]]] = {}

    for observation in observations:
        key = (str(observation["section"]), int(observation["yawBin"]))
        groups.setdefault(key, []).append(observation)

    for group in groups.values():
        group_weight = sum(float(item["weight"]) for item in group)

        if group_weight <= 0:
            continue

        for item in group:
            item["weight"] = float(item["weight"]) / group_weight

    return observations


def summarize_silhouette_observations(
    observations: list[dict[str, Any]],
) -> dict[str, int]:
    frame_names = {str(item["view"]) for item in observations}
    sequence_names = {
        str(item["view"])
        for item in observations
        if item.get("sourceKind") == "sequence"
    }
    yaw_bins = {int(item["yawBin"]) for item in observations}

    return {
        "frameCount": len(frame_names),
        "sequenceFrameCount": len(sequence_names),
        "yawBinCount": len(yaw_bins),
    }


def decode_rle_mask(payload: Any) -> list[list[int]] | None:
    if not isinstance(payload, dict) or payload.get("encoding") != "rle":
        return None

    width = payload.get("width")
    height = payload.get("height")
    counts = payload.get("counts")

    if not isinstance(width, int) or not isinstance(height, int) or not isinstance(counts, list):
        return None

    values: list[int] = []
    current_value = 0

    for count in counts:
        if not isinstance(count, int) or count < 0:
            return None

        values.extend([current_value] * count)
        current_value = 1 - current_value

    expected_length = width * height

    if len(values) != expected_length:
        return None

    return [values[offset:offset + width] for offset in range(0, expected_length, width)]


def get_binary_mask_bounds(mask: list[list[int]]) -> tuple[int, int, int, int] | None:
    foreground = [
        (x, y)
        for y, row in enumerate(mask)
        for x, value in enumerate(row)
        if value == 1
    ]

    if not foreground:
        return None

    return (
        min(point[0] for point in foreground),
        min(point[1] for point in foreground),
        max(point[0] for point in foreground),
        max(point[1] for point in foreground),
    )


def get_central_mask_run_width(
    mask: list[list[int]],
    row_index: int,
    center_x: float,
) -> int | None:
    if row_index < 0 or row_index >= len(mask):
        return None

    runs: list[tuple[int, int]] = []
    run_start: int | None = None

    for x, value in enumerate(mask[row_index] + [0]):
        if value == 1 and run_start is None:
            run_start = x
        elif value == 0 and run_start is not None:
            runs.append((run_start, x - 1))
            run_start = None

    if not runs:
        return None

    selected = min(
        runs,
        key=lambda run: 0 if run[0] <= center_x <= run[1] else min(
            abs(center_x - run[0]),
            abs(center_x - run[1]),
        ),
    )
    return selected[1] - selected[0] + 1


def get_measurement_values(request: dict[str, Any]) -> dict[str, float]:
    report = request.get("measurements")
    measurements = report.get("measurements", []) if isinstance(report, dict) else []
    values: dict[str, float] = {}

    for measurement in measurements:
        if not isinstance(measurement, dict):
            continue
        key = measurement.get("key")
        value = measurement.get("valueCm")
        if isinstance(key, str) and isinstance(value, (int, float)):
            values[key] = float(value)

    return values


def run_econ(request: dict[str, Any], request_file: Path, output_dir: Path) -> dict[str, Any]:
    econ_home = get_path_env("ECON_HOME", ".avatar-models/repos/ECON")
    econ_python = os.environ.get("ECON_PYTHON", sys.executable)

    if not econ_home or not econ_home.exists():
        return {"reason": "ECON_HOME was not found.", "status": "skipped"}

    input_dir = output_dir / "econ-input"
    econ_output = output_dir / "econ-output"
    input_dir.mkdir(exist_ok=True)
    econ_output.mkdir(exist_ok=True)

    front_frame = resolve_workspace_path(request.get("inputFrames", {}).get("front"))
    if not front_frame or not front_frame.exists():
        return {"reason": "Front frame is required for ECON.", "status": "skipped"}

    shutil.copyfile(front_frame, input_dir / front_frame.name)
    command = [
        econ_python,
        "-m",
        "apps.infer",
        "-cfg",
        "./configs/econ.yaml",
        "-in_dir",
        str(input_dir),
        "-out_dir",
        str(econ_output),
        "-novis",
    ]

    return run_command("econ", command, cwd=econ_home, output_dir=output_dir)


def run_lhm(request: dict[str, Any], request_file: Path, output_dir: Path) -> dict[str, Any]:
    lhm_home = get_path_env("LHM_HOME", ".avatar-models/repos/LHM")

    if not lhm_home or not lhm_home.exists():
        return {"reason": "LHM_HOME was not found.", "status": "skipped"}

    input_dir = output_dir / "lhm-input"
    input_dir.mkdir(exist_ok=True)
    front_frame = resolve_workspace_path(request.get("inputFrames", {}).get("front"))

    if not front_frame or not front_frame.exists():
        return {"reason": "Front frame is required for LHM.", "status": "skipped"}

    shutil.copyfile(front_frame, input_dir / front_frame.name)
    model_name = os.environ.get("LHM_MODEL_NAME", "LHM-MINI")
    command = ["bash", "./inference_mesh.sh", model_name, str(input_dir)]

    return run_command("lhm", command, cwd=lhm_home, output_dir=output_dir)


def run_lhmpp(request: dict[str, Any], request_file: Path, output_dir: Path) -> dict[str, Any]:
    lhmpp_home = get_path_env("LHMPP_HOME", ".avatar-models/repos/LHM-plusplus")

    if not lhmpp_home or not lhmpp_home.exists():
        return {"reason": "LHMPP_HOME was not found.", "status": "skipped"}

    input_views = request.get("inputReferenceViews", [])
    source_views = [
        path_value for view in input_views
        if isinstance(view, dict)
        and (path_value := resolve_workspace_path(view.get("file")))
        and path_value.exists()
    ]

    if not source_views:
        return {"reason": "Angle-balanced reference views are required for LHM++.", "status": "skipped"}

    input_dir = output_dir / "lhmpp-input"
    input_dir.mkdir(exist_ok=True)

    for index, source_view in enumerate(source_views[:8]):
        shutil.copyfile(source_view, input_dir / f"{index:02d}{source_view.suffix.lower()}")

    output_file = output_dir / "lhmpp-avatar.ply"
    command = [
        os.environ.get("LHMPP_PYTHON", sys.executable),
        "scripts/inference/to_gs_ply.py",
        "--images_dir",
        str(input_dir),
        "--ref_view",
        str(min(8, len(source_views))),
        "--output",
        str(output_file),
        "--device",
        os.environ.get("LHMPP_DEVICE", "cuda"),
    ]
    model_path = os.environ.get("LHMPP_MODEL_PATH")

    if model_path:
        command.extend(["--model_path", model_path])

    return run_command("lhmpp", command, cwd=lhmpp_home, output_dir=output_dir)


def run_command(name: str, command: list[str], cwd: Path, output_dir: Path) -> dict[str, Any]:
    timeout = int(os.environ.get("AVATAR_WORKER_TIMEOUT_SECONDS", "900"))

    try:
        completed = subprocess.run(
            command,
            cwd=str(cwd),
            env=os.environ.copy(),
            capture_output=True,
            check=False,
            text=True,
            timeout=timeout,
        )
    except Exception as error:  # noqa: BLE001
        return {
            "command": command,
            "error": str(error),
            "status": "failed",
        }

    produced = [str(path) for path in output_dir.rglob("*") if path.is_file()]
    return {
        "command": command,
        "producedFiles": produced,
        "returnCode": completed.returncode,
        "status": "succeeded" if completed.returncode == 0 else "failed",
        "stderrTail": tail_lines(completed.stderr),
        "stdoutTail": tail_lines(completed.stdout),
    }


def export_fallback_glb(request: dict[str, Any], request_file: Path, output_dir: Path) -> dict[str, Any]:
    local_avatar_path = resolve_workspace_path(request.get("localAvatarReportFile"))
    if not local_avatar_path:
        local_avatar_path = request_file.parent / "body-avatar-local.json"

    if not local_avatar_path.exists():
        return {
            "reason": "No local avatar mesh report was available for fallback GLB export.",
            "status": "skipped",
        }

    try:
        avatar = read_json(local_avatar_path)
        vertices = avatar["mesh"]["vertices"]
        faces = avatar["mesh"]["faces"]
        glb_file = output_dir / "fallback-avatar.glb"
        write_glb(glb_file, vertices, faces)
        return {
            "file": str(glb_file),
            "source": str(local_avatar_path),
            "status": "succeeded",
            "warning": "This is a web-viewable fallback generated from the app's local mesh, not ECON/LHM output.",
        }
    except Exception as error:  # noqa: BLE001
        return {
            "error": str(error),
            "source": str(local_avatar_path),
            "status": "failed",
        }


def write_glb(
    output_file: Path,
    vertices: list[list[float]],
    faces: list[list[int]],
    color: list[float] | None = None,
) -> None:
    positions = [[float(v[0]), float(v[1]), float(v[2])] for v in vertices]
    indices = [int(index) for face in faces for index in face]
    normals = compute_vertex_normals(positions, faces)
    position_bytes = b"".join(struct.pack("<fff", *position) for position in positions)
    normal_bytes = b"".join(struct.pack("<fff", *normal) for normal in normals)
    index_bytes = b"".join(struct.pack("<I", index) for index in indices)
    position_offset = 0
    normal_offset = align4(len(position_bytes))
    index_offset = align4(normal_offset + len(normal_bytes))
    binary = position_bytes
    binary += b"\x00" * (normal_offset - len(binary))
    binary += normal_bytes
    binary += b"\x00" * (index_offset - len(binary))
    binary += index_bytes
    binary += b"\x00" * (align4(len(binary)) - len(binary))
    mins = [min(position[axis] for position in positions) for axis in range(3)]
    maxs = [max(position[axis] for position in positions) for axis in range(3)]
    document = {
        "asset": {"generator": "guided-body-reconstruction self-hosted worker", "version": "2.0"},
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5126,
                "count": len(positions),
                "max": maxs,
                "min": mins,
                "type": "VEC3",
            },
            {
                "bufferView": 1,
                "componentType": 5126,
                "count": len(normals),
                "type": "VEC3",
            },
            {
                "bufferView": 2,
                "componentType": 5125,
                "count": len(indices),
                "type": "SCALAR",
            },
        ],
        "bufferViews": [
            {
                "buffer": 0,
                "byteLength": len(position_bytes),
                "byteOffset": position_offset,
                "target": 34962,
            },
            {
                "buffer": 0,
                "byteLength": len(normal_bytes),
                "byteOffset": normal_offset,
                "target": 34962,
            },
            {
                "buffer": 0,
                "byteLength": len(index_bytes),
                "byteOffset": index_offset,
                "target": 34963,
            },
        ],
        "buffers": [{"byteLength": len(binary)}],
        "materials": [
            {
                "name": "Avatar surface",
                "pbrMetallicRoughness": {
                    "baseColorFactor": color or [0.78, 0.66, 0.56, 1.0],
                    "metallicFactor": 0,
                    "roughnessFactor": 0.7,
                },
            }
        ],
        "meshes": [
            {
                "name": "Avatar",
                "primitives": [
                    {
                        "attributes": {"NORMAL": 1, "POSITION": 0},
                        "indices": 2,
                        "material": 0,
                        "mode": 4,
                    }
                ],
            }
        ],
        "nodes": [{"mesh": 0, "name": "Avatar"}],
        "scene": 0,
        "scenes": [{"nodes": [0]}],
    }
    json_bytes = json.dumps(document, separators=(",", ":")).encode("utf-8")
    json_bytes += b" " * (align4(len(json_bytes)) - len(json_bytes))
    total_length = 12 + 8 + len(json_bytes) + 8 + len(binary)

    with output_file.open("wb") as glb:
        glb.write(struct.pack("<III", 0x46546C67, 2, total_length))
        glb.write(struct.pack("<I4s", len(json_bytes), b"JSON"))
        glb.write(json_bytes)
        glb.write(struct.pack("<I4s", len(binary), b"BIN\x00"))
        glb.write(binary)


def compute_vertex_normals(
    vertices: list[list[float]],
    faces: list[list[int]],
) -> list[list[float]]:
    normals = [[0.0, 0.0, 0.0] for _ in vertices]

    for face in faces:
        if len(face) < 3:
            continue

        a, b, c = face[:3]
        ax, ay, az = vertices[a]
        abx = vertices[b][0] - ax
        aby = vertices[b][1] - ay
        abz = vertices[b][2] - az
        acx = vertices[c][0] - ax
        acy = vertices[c][1] - ay
        acz = vertices[c][2] - az
        face_normal = [
            aby * acz - abz * acy,
            abz * acx - abx * acz,
            abx * acy - aby * acx,
        ]

        for vertex_index in (a, b, c):
            normals[vertex_index][0] += face_normal[0]
            normals[vertex_index][1] += face_normal[1]
            normals[vertex_index][2] += face_normal[2]

    for normal in normals:
        length = math.sqrt(normal[0] ** 2 + normal[1] ** 2 + normal[2] ** 2)

        if length > 1e-12:
            normal[0] /= length
            normal[1] /= length
            normal[2] /= length
        else:
            normal[1] = 1.0

    return normals


def parse_obj_mesh(file_path: Path) -> tuple[list[list[float]], list[list[int]]]:
    vertices: list[list[float]] = []
    faces: list[list[int]] = []

    for line in file_path.read_text(errors="ignore").splitlines():
        if line.startswith("v "):
            parts = line.split()
            vertices.append([float(parts[1]), float(parts[2]), float(parts[3])])
        elif line.startswith("f "):
            raw_indices = [part.split("/")[0] for part in line.split()[1:]]
            face = [int(index) - 1 for index in raw_indices]
            if len(face) == 3:
                faces.append(face)
            elif len(face) > 3:
                for index in range(1, len(face) - 1):
                    faces.append([face[0], face[index], face[index + 1]])

    if not vertices or not faces:
        raise ValueError(f"{file_path} did not contain a usable triangle mesh.")

    return vertices, faces


def should_run_backend(name: str) -> bool:
    backend = os.environ.get("AVATAR_WORKER_BACKEND", "fallback").lower()
    return backend in {name, "all"} or os.environ.get(f"{name.upper()}_ENABLE") == "1"


def has_renderable_model(output_dir: Path) -> bool:
    return any(output_dir.rglob("*.glb")) or any(output_dir.rglob("*.gltf"))


def first_existing_file(root: Path, patterns: list[str]) -> Path | None:
    for pattern in patterns:
        matches = sorted(root.rglob(pattern), key=lambda path: path.stat().st_mtime, reverse=True)
        if matches:
            return matches[0]
    return None


def list_smplx_model_files(model_dir: Path | None) -> list[str]:
    if not model_dir or not model_dir.exists():
        return []

    return sorted(path.name for path in model_dir.rglob("*") if path.is_file() and path.suffix in {".npz", ".pkl"})


def get_smplx_model_dir() -> Path | None:
    return get_path_env("SMPLX_MODEL_DIR", ".avatar-models/smplx/models")


def get_path_env(name: str, fallback: str) -> Path | None:
    value = os.environ.get(name)
    path_value = Path(value).expanduser() if value else Path.cwd() / fallback
    return path_value.resolve()


def resolve_workspace_path(value: Any) -> Path | None:
    if not isinstance(value, str) or not value:
        return None

    path_value = Path(value)
    if path_value.is_absolute():
        return path_value

    return (Path.cwd() / path_value).resolve()


def detect_torch() -> dict[str, Any]:
    stderr_fd = os.dup(2)
    devnull_fd = os.open(os.devnull, os.O_WRONLY)

    try:
        os.dup2(devnull_fd, 2)
        import torch  # type: ignore

        return {
            "available": True,
            "cudaAvailable": bool(torch.cuda.is_available()),
            "mpsAvailable": bool(getattr(torch.backends, "mps", None) and torch.backends.mps.is_available()),
            "version": torch.__version__,
        }
    except Exception as error:  # noqa: BLE001
        return {
            "available": False,
            "error": str(error),
        }
    finally:
        os.dup2(stderr_fd, 2)
        os.close(stderr_fd)
        os.close(devnull_fd)


def read_json(file_path: Path) -> dict[str, Any]:
    return json.loads(file_path.read_text())


def write_json(file_path: Path, value: dict[str, Any]) -> None:
    file_path.write_text(json.dumps(value, indent=2))


def align4(value: int) -> int:
    return (value + 3) & ~3


def tail_lines(value: str, limit: int = 80) -> list[str]:
    return [line.rstrip() for line in value.splitlines() if line.strip()][-limit:]


if __name__ == "__main__":
    raise SystemExit(main())
