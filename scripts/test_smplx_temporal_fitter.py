from __future__ import annotations

import unittest

from smplx_temporal_fitter import (
    ACTION_STATES,
    decode_rle_mask,
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


if __name__ == "__main__":
    unittest.main()
