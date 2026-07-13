"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  defaultCameraFacingMode,
  getFacingModeFromStream,
  requestCameraStream,
  stopMediaStream,
  type CameraFacingMode,
} from "@/services/camera-service";
import type { CameraPermissionStatus } from "@/types/scan";

type CameraDiagnostics = {
  isSecureContext: boolean;
  protocol: string;
  hasMediaDevices: boolean;
  hasGetUserMedia: boolean;
  userAgent: string;
};

function statusFromError(error: unknown): CameraPermissionStatus {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "denied";
    }

    if (
      error.name === "NotFoundError" ||
      error.name === "NotReadableError" ||
      error.name === "OverconstrainedError"
    ) {
      return "unavailable";
    }

    if (error.name === "NotSupportedError") {
      return "unsupported";
    }
  }

  return "error";
}

export function useCameraAccess() {
  const [status, setStatus] = useState<CameraPermissionStatus>("idle");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraFacingMode, setCameraFacingMode] =
    useState<CameraFacingMode>(defaultCameraFacingMode);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string>("Camera has not been requested yet.");
  const [diagnostics, setDiagnostics] = useState<CameraDiagnostics>({
    isSecureContext: false,
    protocol: "",
    hasMediaDevices: false,
    hasGetUserMedia: false,
    userAgent: "",
  });
  const isRequestingRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    streamRef.current = stream;
  }, [stream]);

  useEffect(() => {
    const nextDiagnostics = getCameraDiagnostics();
    setDiagnostics(nextDiagnostics);

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      setErrorMessage("Open this page in Safari or Chrome. This browser does not expose webcam access.");
    }
  }, []);

  const stopCamera = useCallback((options?: { resetStatus?: boolean }) => {
    setStream((currentStream) => {
      stopMediaStream(currentStream);
      streamRef.current = null;
      return null;
    });

    if (options?.resetStatus) {
      setCameraFacingMode(defaultCameraFacingMode);
      setStatus("idle");
      setErrorMessage(null);
      setLastAction("Camera has not been requested yet.");
    }
  }, []);

  const startCamera = useCallback(
    (targetFacingMode: CameraFacingMode, action: "request" | "switch") => {
      if (isRequestingRef.current) {
        return;
      }

      isRequestingRef.current = true;

      // Release the active track first so mobile browsers can swap lenses reliably.
      stopMediaStream(streamRef.current);
      streamRef.current = null;

      // Start getUserMedia before React state work so mobile browsers keep the tap activation.
      const cameraRequest = requestCameraStream(targetFacingMode);

      setStatus("requesting");
      setStream(null);
      setErrorMessage(null);
      setCameraFacingMode(targetFacingMode);
      setLastAction(
        action === "switch"
          ? `Switching to ${getFacingModeLabel(targetFacingMode)} camera...`
          : "Tap received. Opening the browser camera prompt...",
      );

      cameraRequest
        .then((nextStream) => {
          const resolvedFacingMode = getFacingModeFromStream(nextStream) ?? targetFacingMode;

          streamRef.current = nextStream;
          setStream(nextStream);
          setCameraFacingMode(resolvedFacingMode);
          setStatus("granted");
          setLastAction(
            action === "switch"
              ? `${getFacingModeLabel(resolvedFacingMode)} camera connected.`
              : "Camera connected. Continue to the preview.",
          );
        })
        .catch((error) => {
          setStatus(statusFromError(error));
          setErrorMessage(error instanceof Error ? error.message : "Unable to access the camera.");
          setLastAction(
            error instanceof Error
              ? `Camera request finished: ${error.name || "Error"}`
              : "Camera request finished with an unknown error.",
          );
        })
        .finally(() => {
          isRequestingRef.current = false;
        });
    },
    [],
  );

  const requestCamera = useCallback(() => {
    startCamera(defaultCameraFacingMode, "request");
  }, [startCamera]);

  const switchCamera = useCallback(() => {
    startCamera(getOppositeFacingMode(cameraFacingMode), "switch");
  }, [cameraFacingMode, startCamera]);

  useEffect(() => stopCamera, [stopCamera]);

  return {
    cameraFacingMode,
    canSwitchCamera: status === "granted" || status === "requesting",
    diagnostics,
    errorMessage,
    lastAction,
    requestCamera,
    status,
    stream,
    switchCamera,
    stopCamera,
  };
}

function getOppositeFacingMode(facingMode: CameraFacingMode): CameraFacingMode {
  return facingMode === "environment" ? "user" : "environment";
}

function getFacingModeLabel(facingMode: CameraFacingMode): string {
  return facingMode === "environment" ? "back" : "front";
}

function getCameraDiagnostics(): CameraDiagnostics {
  if (typeof window === "undefined") {
    return {
      isSecureContext: false,
      protocol: "",
      hasMediaDevices: false,
      hasGetUserMedia: false,
      userAgent: "",
    };
  }

  return {
    isSecureContext: window.isSecureContext,
    protocol: window.location.protocol,
    hasMediaDevices: Boolean(navigator.mediaDevices),
    hasGetUserMedia: typeof navigator.mediaDevices?.getUserMedia === "function",
    userAgent: navigator.userAgent,
  };
}
