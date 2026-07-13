"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import {
  buildPersonSegmentationResult,
  getPersonSegmentationErrorResult,
  getPersonSegmentationIdleResult,
  getPersonSegmentationLoadingResult,
} from "@/services/person-segmentation-service";
import type {
  CapturedBodyBounds,
  CapturedPoseKeypoint,
  ScanState,
} from "@/types/scan";
import type { PersonSegmentationResult } from "@/types/vision";

type BodySegmenter = import("@tensorflow-models/body-segmentation").BodySegmenter;
type BodySegmentationModule = typeof import("@tensorflow-models/body-segmentation");

type UsePersonSegmentationOptions = {
  active: boolean;
  poseBodyBounds: CapturedBodyBounds | null;
  poseKeypoints: CapturedPoseKeypoint[];
  scanState: ScanState;
  videoRef: RefObject<HTMLVideoElement | null>;
};

const sampleIntervalMs = 1300;
const mediaPipeSolutionPath = "/vendor/mediapipe/selfie_segmentation";

export function usePersonSegmentation({
  active,
  poseBodyBounds,
  poseKeypoints,
  scanState,
  videoRef,
}: UsePersonSegmentationOptions): PersonSegmentationResult {
  const segmenterRef = useRef<BodySegmenter | null>(null);
  const isLoadingRef = useRef(false);
  const isSegmentingRef = useRef(false);
  const poseBodyBoundsRef = useRef<CapturedBodyBounds | null>(poseBodyBounds);
  const poseKeypointsRef = useRef<CapturedPoseKeypoint[]>(poseKeypoints);
  const scanStateRef = useRef<ScanState>(scanState);
  const [result, setResult] = useState<PersonSegmentationResult>(() =>
    getPersonSegmentationIdleResult(scanState),
  );

  useEffect(() => {
    poseBodyBoundsRef.current = poseBodyBounds;
    poseKeypointsRef.current = poseKeypoints;
    scanStateRef.current = scanState;
  }, [poseBodyBounds, poseKeypoints, scanState]);

  useEffect(() => {
    if (!active) {
      setResult(getPersonSegmentationIdleResult(scanState));
      return;
    }

    if (segmenterRef.current || isLoadingRef.current) {
      return;
    }

    let isCancelled = false;
    isLoadingRef.current = true;
    setResult(getPersonSegmentationLoadingResult(scanStateRef.current));

    async function loadSegmenter() {
      try {
        const bodySegmentation = (await import(
          "@tensorflow-models/body-segmentation/dist/index.js"
        )) as BodySegmentationModule;
        const segmenter = await bodySegmentation.createSegmenter(
          bodySegmentation.SupportedModels.MediaPipeSelfieSegmentation,
          {
            modelType: "general",
            runtime: "mediapipe",
            solutionPath: mediaPipeSolutionPath,
          },
        );

        if (isCancelled) {
          segmenter.dispose();
          return;
        }

        segmenterRef.current = segmenter;
        setResult(getPersonSegmentationLoadingResult(scanStateRef.current));
      } catch (error) {
        if (!isCancelled) {
          setResult(
            getPersonSegmentationErrorResult(
              scanStateRef.current,
              error instanceof Error ? error.message : "Segmentation model load failed",
            ),
          );
        }
      } finally {
        isLoadingRef.current = false;
      }
    }

    void loadSegmenter();

    return () => {
      isCancelled = true;
    };
  }, [active]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const segmentCurrentFrame = async () => {
      const segmenter = segmenterRef.current;
      const video = videoRef.current;

      if (!segmenter) {
        if (!isLoadingRef.current) {
          setResult(getPersonSegmentationLoadingResult(scanState));
        }
        return;
      }

      if (
        !video ||
        video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        video.videoWidth <= 0 ||
        video.videoHeight <= 0 ||
        isSegmentingRef.current
      ) {
        return;
      }

      isSegmentingRef.current = true;

      try {
        const people = await segmenter.segmentPeople(video, { flipHorizontal: false });
        const firstPerson = people[0] ?? null;

        if (!firstPerson) {
          setResult(getPersonSegmentationErrorResult(scanState, "No person mask returned"));
          return;
        }

        const imageData = await firstPerson.mask.toImageData();

        setResult(
          buildPersonSegmentationResult({
            imageData,
            poseBodyBounds: poseBodyBoundsRef.current,
            poseKeypoints: poseKeypointsRef.current,
            scanState,
          }),
        );
      } catch (error) {
        setResult(
          getPersonSegmentationErrorResult(
            scanState,
            error instanceof Error ? error.message : "Segmentation failed",
          ),
        );
      } finally {
        isSegmentingRef.current = false;
      }
    };

    void segmentCurrentFrame();
    const timer = window.setInterval(() => {
      void segmentCurrentFrame();
    }, sampleIntervalMs);

    return () => window.clearInterval(timer);
  }, [active, scanState, videoRef]);

  useEffect(() => {
    return () => {
      segmenterRef.current?.dispose();
      segmenterRef.current = null;
    };
  }, []);

  return result;
}
