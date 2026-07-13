"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { CameraFacingMode } from "@/services/camera-service";
import { cn } from "@/utils/cn";

type CameraFeedProps = {
  facingMode: CameraFacingMode;
  stream: MediaStream;
  videoRef?: RefObject<HTMLVideoElement | null>;
};

export function CameraFeed({
  facingMode,
  stream,
  videoRef: externalVideoRef,
}: CameraFeedProps) {
  const internalVideoRef = useRef<HTMLVideoElement | null>(null);
  const videoRef = externalVideoRef ?? internalVideoRef;

  useEffect(() => {
    if (!videoRef.current) {
      return;
    }

    videoRef.current.srcObject = stream;
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      muted
      playsInline
      className={cn(
        "h-full w-full object-cover",
        facingMode === "user" && "scale-x-[-1]",
      )}
    />
  );
}
