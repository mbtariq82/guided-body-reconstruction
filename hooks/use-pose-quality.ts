"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { analyzeVideoFrameQuality } from "@/services/frame-quality-service";
import {
  buildPoseQualityResult,
  getPoseErrorResult,
  getPoseLoadingResult,
} from "@/services/pose-quality-service";
import type { ScanState } from "@/types/scan";
import type { PoseQualityResult } from "@/types/vision";

type PoseDetector = import("@tensorflow-models/pose-detection/dist/pose_detector").PoseDetector;

type UsePoseQualityOptions = {
  active: boolean;
  scanState: ScanState;
  videoRef: RefObject<HTMLVideoElement | null>;
};

export const poseTrackSampleIntervalMs = 180;

export function usePoseQuality({
  active,
  scanState,
  videoRef,
}: UsePoseQualityOptions): PoseQualityResult {
  const detectorRef = useRef<PoseDetector | null>(null);
  const backendRef = useRef<string | null>(null);
  const isLoadingRef = useRef(false);
  const isEstimatingRef = useRef(false);
  const scanStateRef = useRef(scanState);
  scanStateRef.current = scanState;
  const [quality, setQuality] = useState<PoseQualityResult>(() =>
    getPoseLoadingResult(scanState, null),
  );

  useEffect(() => {
    if (!active || detectorRef.current || isLoadingRef.current) {
      return;
    }

    let isCancelled = false;
    isLoadingRef.current = true;
    setQuality(getPoseLoadingResult(scanStateRef.current, backendRef.current));

    async function loadDetector() {
      try {
        const blazePoseDetector = await import(
          "@tensorflow-models/pose-detection/dist/blazepose_mediapipe/detector"
        );

        const detector = await blazePoseDetector.load({
          enableSmoothing: true,
          enableSegmentation: false,
          modelType: "full",
          runtime: "mediapipe",
          smoothSegmentation: false,
          solutionPath: "/api/vision-assets/pose",
        });

        if (isCancelled) {
          detector.dispose();
          return;
        }

        backendRef.current = "mediapipe-wasm";
        detectorRef.current = detector;
        setQuality(getPoseLoadingResult(scanStateRef.current, backendRef.current));
      } catch (error) {
        if (!isCancelled) {
          setQuality(
            getPoseErrorResult(
              scanStateRef.current,
              error instanceof Error ? error.message : "Model load failed",
            ),
          );
        }
      } finally {
        isLoadingRef.current = false;
      }
    }

    void loadDetector();

    return () => {
      isCancelled = true;
    };
  }, [active]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const estimate = async () => {
      const detector = detectorRef.current;
      const video = videoRef.current;

      if (!detector) {
        setQuality(getPoseLoadingResult(scanState, backendRef.current));
        return;
      }

      if (
        !video ||
        video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        video.videoWidth <= 0 ||
        video.videoHeight <= 0 ||
        isEstimatingRef.current
      ) {
        return;
      }

      isEstimatingRef.current = true;

      try {
        const frameQuality = analyzeVideoFrameQuality(video);
        const poses = await detector.estimatePoses(video, {
          // Captured JPEGs and video frames use the raw sensor orientation.
          // CSS mirroring of the preview must not alter stored landmark coordinates.
          flipHorizontal: false,
          maxPoses: 1,
        }, performance.now());

        setQuality(
          buildPoseQualityResult({
            backend: backendRef.current,
            frameQuality,
            height: video.videoHeight,
            pose: poses[0] ?? null,
            scanState,
            width: video.videoWidth,
          }),
        );
      } catch (error) {
        setQuality(
          getPoseErrorResult(
            scanState,
            error instanceof Error ? error.message : "Pose estimate failed",
          ),
        );
      } finally {
        isEstimatingRef.current = false;
      }
    };

    void estimate();
    const timer = window.setInterval(() => {
      void estimate();
    }, poseTrackSampleIntervalMs);

    return () => window.clearInterval(timer);
  }, [active, scanState, videoRef]);

  useEffect(() => {
    return () => {
      detectorRef.current?.dispose();
      detectorRef.current = null;
    };
  }, []);

  return quality;
}
