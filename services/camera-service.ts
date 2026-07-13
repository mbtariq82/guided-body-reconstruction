const cameraRequestTimeoutMs = 20000;

export type CameraFacingMode = "environment" | "user";

export const defaultCameraFacingMode: CameraFacingMode = "environment";

const anyCameraRequest: MediaStreamConstraints = {
  video: true,
  audio: false,
};

const reconstructionCameraRequest = {
  frameRate: { ideal: 30 },
  height: { ideal: 1080 },
  width: { ideal: 1920 },
} satisfies MediaTrackConstraints;

export async function requestCameraStream(
  facingMode: CameraFacingMode = defaultCameraFacingMode,
): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new DOMException("Camera access is not supported by this browser.", "NotSupportedError");
  }

  return getCameraWithFallback([
    getExactCameraRequest(facingMode, true),
    getExactCameraRequest(facingMode, false),
    getIdealCameraRequest(facingMode, true),
    getIdealCameraRequest(facingMode, false),
    anyCameraRequest,
  ]);
}

export function stopMediaStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export function getFacingModeFromStream(
  stream: MediaStream | null,
): CameraFacingMode | null {
  const facingMode = stream?.getVideoTracks()[0]?.getSettings().facingMode;

  return facingMode === "environment" || facingMode === "user" ? facingMode : null;
}

function getExactCameraRequest(
  facingMode: CameraFacingMode,
  includeSize: boolean,
): MediaStreamConstraints {
  return {
    video: {
      facingMode: { exact: facingMode },
      ...(includeSize
        ? reconstructionCameraRequest
        : {}),
    },
    audio: false,
  };
}

function getIdealCameraRequest(
  facingMode: CameraFacingMode,
  includeSize: boolean,
): MediaStreamConstraints {
  return {
    video: {
      facingMode: { ideal: facingMode },
      ...(includeSize
        ? reconstructionCameraRequest
        : {}),
    },
    audio: false,
  };
}

async function getCameraWithFallback(
  attempts: MediaStreamConstraints[],
): Promise<MediaStream> {
  let lastError: unknown = null;

  for (const constraints of attempts) {
    try {
      return await withCameraTimeout(
        navigator.mediaDevices.getUserMedia(constraints),
        cameraRequestTimeoutMs,
      );
    } catch (error) {
      lastError = error;

      if (isPermissionError(error) || isTimeoutError(error)) {
        throw error;
      }
    }
  }

  throw lastError ?? new DOMException("No camera is available.", "NotFoundError");
}

function withCameraTimeout(
  request: Promise<MediaStream>,
  timeoutMs: number,
): Promise<MediaStream> {
  let didTimeout = false;
  let timeoutId: ReturnType<typeof setTimeout>;

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      didTimeout = true;
      reject(
        new DOMException(
          "Camera permission did not complete. Check the browser camera prompt or site permissions, then try again.",
          "AbortError",
        ),
      );
    }, timeoutMs);
  });

  const guardedRequest = request.then((stream) => {
    if (didTimeout) {
      stopMediaStream(stream);
    }

    return stream;
  });

  return Promise.race([guardedRequest, timeout]).finally(() => {
    clearTimeout(timeoutId);
  });
}

function isPermissionError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "NotAllowedError" || error.name === "SecurityError")
  );
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
