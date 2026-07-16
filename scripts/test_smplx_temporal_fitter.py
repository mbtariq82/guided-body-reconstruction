from __future__ import annotations

import unittest
import json
import tempfile
from pathlib import Path

from smplx_temporal_fitter import (
    ACTION_STATES,
    decode_rle_mask,
    pairwise_world_pose_loss,
    select_temporal_frames,
)


class TemporalFrameSelectionTests(unittest.TestCase):
    def test_selects_angle_coverage_and_each_action(self) -> None:
        frames = [
            make_frame(f"geometry-{index}", "rotate-left", index * 45, "geometry", index * 100)
            for index in range(8)
        ]
        frames.extend(
            make_frame(f"action-{index}", state, 0, "motion", 1000 + index * 100)
            for index, state in enumerate(ACTION_STATES)
        )

        selected = select_temporal_frames({"inputSequence": {"frames": frames}}, 12)

        self.assertEqual(len(selected), 12)
        self.assertEqual(
            {frame["state"] for frame in selected if frame["state"] in ACTION_STATES},
            set(ACTION_STATES),
        )
        self.assertEqual(
            {round(float(frame["yawDeg"])) for frame in selected if frame["state"] == "rotate-left"},
            {0, 45, 90, 135, 180, 225, 270, 315},
        )

    def test_excludes_identity_detail_frames(self) -> None:
        geometry = [
            make_frame(f"geometry-{index}", "front-view", 0, "geometry", index * 100)
            for index in range(3)
        ]
        identity = make_frame("identity", "identity-detail", 0, "identity", 1000)
        hands = make_frame("hands", "hand-detail", 0, "identity", 1100)

        selected = select_temporal_frames(
            {"inputSequence": {"frames": [*geometry, identity, hands]}},
            8,
        )

        self.assertEqual([frame["sourceFile"] for frame in selected], [
            "geometry-0.jpg",
            "geometry-1.jpg",
            "geometry-2.jpg",
        ])

    def test_small_budget_preserves_geometry_core(self) -> None:
        geometry = [
            make_frame(f"geometry-{index}", "rotate-left", index * 45, "geometry", index * 100)
            for index in range(8)
        ]
        actions = [
            make_frame(f"action-{index}", state, 0, "motion", 1000 + index * 100)
            for index, state in enumerate(ACTION_STATES)
        ]

        selected = select_temporal_frames(
            {"inputSequence": {"frames": [*geometry, *actions]}},
            4,
        )

        self.assertEqual(len(selected), 4)
        self.assertTrue(all(frame["state"] == "rotate-left" for frame in selected))

    def test_mixes_dense_track_with_mask_keyframes(self) -> None:
        geometry = [
            make_frame(f"geometry-{index}", "rotate-left", index * 30, "geometry", index * 100)
            for index in range(12)
        ]
        track_frames = [
            make_track_frame(index, index * 18, index * 80)
            for index in range(20)
        ]

        with tempfile.TemporaryDirectory() as directory:
            track_file = Path(directory) / "pose-track.json"
            track_file.write_text(json.dumps({
                "frames": track_frames,
                "provider": "mediapipe-blazepose",
                "schemaVersion": "guided-pose-track.v1",
                "sessionElapsedOffsetMs": 5000,
            }))
            selected = select_temporal_frames({
                "inputSequence": {
                    "frames": geometry,
                    "poseTrack": {"file": str(track_file)},
                },
            }, 18)

        track_count = sum(frame.get("sourceType") == "pose-track" for frame in selected)
        mask_count = sum(frame.get("sourceType") != "pose-track" for frame in selected)
        self.assertEqual(len(selected), 18)
        self.assertGreaterEqual(track_count, 5)
        self.assertGreaterEqual(mask_count, 8)
        self.assertGreaterEqual(
            min(float(frame["elapsedMs"]) for frame in selected if frame.get("sourceType") == "pose-track"),
            5000,
        )

    def test_accepts_track_when_keyframe_sequence_is_missing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            track_file = Path(directory) / "pose-track.json"
            track_file.write_text(json.dumps({
                "frames": [make_track_frame(index, index * 45, index * 180) for index in range(8)],
                "provider": "mediapipe-blazepose",
                "schemaVersion": "guided-pose-track.v1",
                "sessionElapsedOffsetMs": 2000,
            }))
            selected = select_temporal_frames({
                "inputSequence": {"poseTrack": {"file": str(track_file)}},
            }, 8)

        self.assertEqual(len(selected), 8)
        self.assertTrue(all(frame.get("sourceType") == "pose-track" for frame in selected))


class MaskDecodingTests(unittest.TestCase):
    def test_decodes_row_major_rle(self) -> None:
        mask = decode_rle_mask({
            "counts": [1, 2, 2, 2, 1],
            "encoding": "rle",
            "height": 2,
            "width": 4,
        })

        self.assertEqual(mask, [[0, 1, 1, 0], [0, 1, 1, 0]])

    def test_rejects_invalid_rle_length(self) -> None:
        self.assertIsNone(decode_rle_mask({
            "counts": [0, 3],
            "encoding": "rle",
            "height": 2,
            "width": 2,
        }))


class WorldPoseLossTests(unittest.TestCase):
    def test_is_invariant_to_world_translation_and_scale(self) -> None:
        import torch

        predicted = torch.tensor([[
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 2.0, 0.0],
            [0.0, 0.0, 3.0],
            [1.0, 2.0, 3.0],
        ]])
        target = predicted * 2.4 + 7.0
        weights = torch.ones((1, 3))

        loss = pairwise_world_pose_loss(predicted, target, weights, torch)

        self.assertLess(float(loss), 1e-6)


def make_frame(
    source: str,
    state: str,
    yaw: float,
    capture_role: str,
    elapsed_ms: float,
) -> dict[str, object]:
    names = [
        "nose",
        "left_shoulder",
        "right_shoulder",
        "left_hip",
        "right_hip",
        "left_knee",
        "right_knee",
        "left_ankle",
        "right_ankle",
    ]
    return {
        "elapsedMs": elapsed_ms,
        "height": 1920,
        "reconstruction": {
            "captureRole": capture_role,
            "poseTarget": "neutral-a",
        },
        "sourceFile": f"{source}.jpg",
        "state": state,
        "vision": {
            "keypoints": [
                {"name": name, "score": 0.9, "x": 540, "y": 200 + index * 120}
                for index, name in enumerate(names)
            ],
            "segmentation": {
                "mask": {
                    "counts": [0, 16],
                    "encoding": "rle",
                    "height": 4,
                    "width": 4,
                },
                "quality": "good",
            },
        },
        "width": 1080,
        "yawDeg": yaw,
    }


def make_track_frame(index: int, yaw: float, elapsed_ms: float) -> dict[str, object]:
    names = [
        "nose",
        "left_shoulder",
        "right_shoulder",
        "left_elbow",
        "right_elbow",
        "left_wrist",
        "right_wrist",
        "left_hip",
        "right_hip",
        "left_knee",
        "right_knee",
        "left_ankle",
        "right_ankle",
        "left_heel",
        "right_heel",
        "left_foot_index",
        "right_foot_index",
        "left_index",
        "right_index",
        "left_thumb",
    ]
    return {
        "elapsedMs": elapsed_ms,
        "height": 1920,
        "keypoints": [
            {"name": name, "score": 0.92, "x": 420 + point * 8, "y": 160 + point * 70}
            for point, name in enumerate(names)
        ],
        "phaseProgress": index * 5,
        "state": "rotate-left",
        "width": 1080,
        "worldKeypoints": [
            {
                "name": name,
                "score": 0.92,
                "x": point * 0.015,
                "y": point * 0.025,
                "z": point * 0.006,
            }
            for point, name in enumerate(names)
        ],
        "yawDeg": yaw,
    }


if __name__ == "__main__":
    unittest.main()
