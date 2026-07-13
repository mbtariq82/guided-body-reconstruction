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

const sampleIntervalMs = 850;

export function usePoseQuality({
  active,
  scanState,
  videoRef,
}: UsePoseQualityOptions): PoseQualityResult {
  const detectorRef = useRef<PoseDetector | null>(null);
  const backendRef = useRef<string | null>(null);
  const isLoadingRef = useRef(false);
  const isEstimatingRef = useRef(false);
  const [quality, setQuality] = useState<PoseQualityResult>(() =>
    getPoseLoadingResult(scanState, null),
  );

  useEffect(() => {
    if (!active || detectorRef.current || isLoadingRef.current) {
      return;
    }

    let isCancelled = false;
    isLoadingRef.current = true;
    setQuality(getPoseLoadingResult(scanState, backendRef.current));

    async function loadDetector() {
      try {
        const [tf, moveNetDetector, moveNetConstants] = await Promise.all([
          import("@tensorflow/tfjs-core"),
          import("@tensorflow-models/pose-detection/dist/movenet/detector"),
          import("@tensorflow-models/pose-detection/dist/movenet/constants"),
          import("@tensorflow/tfjs-backend-webgl"),
          import("@tensorflow/tfjs-backend-cpu"),
        ]).then(
          ([tfModule, detectorModule, constantsModule]) =>
            [tfModule, detectorModule, constantsModule] as const,
        );

        try {
          await tf.setBackend("webgl");
        } catch {
          await tf.setBackend("cpu");
        }

        await tf.ready();

        if (isCancelled) {
          return;
        }

        backendRef.current = tf.getBackend();
        detectorRef.current = await moveNetDetector.load({
          enableSmoothing: true,
          minPoseScore: 0.18,
          modelType: moveNetConstants.SINGLEPOSE_THUNDER,
        });

        if (!isCancelled) {
          setQuality(getPoseLoadingResult(scanState, backendRef.current));
        }
      } catch (error) {
        if (!isCancelled) {
          setQuality(
            getPoseErrorResult(
              scanState,
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
  }, [active, scanState]);

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
          flipHorizontal: true,
          maxPoses: 1,
        });

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
    }, sampleIntervalMs);

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
