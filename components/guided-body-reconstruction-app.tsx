"use client";

import type { MouseEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CameraPermissionScreen } from "@/components/screens/camera-permission-screen";
import { LandingPage } from "@/components/screens/landing-page";
import { ScanIntroScreen } from "@/components/screens/scan-intro-screen";
import { ScannerExperience } from "@/components/scanner/scanner-experience";
import { useCaptureSession } from "@/hooks/use-capture-session";
import { getNextScanState } from "@/lib/scan-machine";
import { getAppViewFromStepParam, getStepHref, type AppView } from "@/lib/scan-routes";
import { useCameraAccess } from "@/hooks/use-camera-access";
import type { ScanState } from "@/types/scan";

type GuidedBodyReconstructionAppProps = {
  initialCameraMode: "live" | "mock";
  initialView: AppView;
};

export function GuidedBodyReconstructionApp({
  initialCameraMode,
  initialView,
}: GuidedBodyReconstructionAppProps) {
  const [view, setView] = useState<AppView>(initialView);
  const viewRef = useRef<AppView>(initialView);
  const [cameraMode, setCameraMode] = useState<"live" | "mock">(initialCameraMode);
  const [isHydrated, setIsHydrated] = useState(false);
  const {
    cameraFacingMode,
    canSwitchCamera,
    status,
    stream,
    errorMessage,
    lastAction,
    diagnostics,
    requestCamera,
    stopCamera,
    switchCamera,
  } = useCameraAccess();
  const {
    captureFrame,
    captureVideo,
    exportCaptureSession,
    markCaptureComplete,
    processUploadedSession,
    resetCaptureSession,
    retakeCapturePhase,
    refreshProcessingJobStatus,
    setSubjectHeightCm,
    setVideoStatus,
    sessionSummary,
    uploadCaptureSession,
    uploadState,
  } = useCaptureSession(initialCameraMode);
  const hydrationMarker = (
    <div
      data-hydration-state={isHydrated ? "ready" : "loading"}
      data-testid="hydration-state"
      hidden
    />
  );

  const navigateToView = useCallback((nextView: AppView) => {
    viewRef.current = nextView;
    setView(nextView);
    window.history.pushState(null, "", getStepHref(nextView));
  }, []);

  const handleLinkedNavigation = useCallback(
    (nextView: AppView) => (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      navigateToView(nextView);
    },
    [navigateToView],
  );

  const goToNextScanState = useCallback(() => {
    const currentView = viewRef.current;
    const nextView = currentView === "landing"
      ? "introduction"
      : getNextScanState(currentView);

    navigateToView(nextView);
  }, [navigateToView]);

  const resetSession = useCallback(() => {
    stopCamera({ resetStatus: true });
    setCameraMode("live");
    resetCaptureSession("live");
    navigateToView("introduction");
  }, [navigateToView, resetCaptureSession, stopCamera]);

  const handleRetakePhase = useCallback(
    (scanState: ScanState) => {
      retakeCapturePhase(scanState);
      viewRef.current = scanState;
      setView(scanState);
      window.history.pushState(
        null,
        "",
        `${getStepHref(scanState)}${cameraMode === "mock" ? "&camera=mock" : ""}`,
      );
    },
    [cameraMode, retakeCapturePhase],
  );

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const step = new URLSearchParams(window.location.search).get("step");
      const nextView = getAppViewFromStepParam(step ?? undefined);
      viewRef.current = nextView;
      setView(nextView);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (view === "finish") {
      markCaptureComplete();
    }
  }, [markCaptureComplete, view]);

  if (view === "landing") {
    return (
      <>
        {hydrationMarker}
        <LandingPage
          onStart={handleLinkedNavigation("introduction")}
          startHref={getStepHref("introduction")}
        />
      </>
    );
  }

  if (view === "introduction") {
    return (
      <>
        {hydrationMarker}
        <ScanIntroScreen
          beginHref={getStepHref("camera-permission")}
          onBegin={handleLinkedNavigation("camera-permission")}
        />
      </>
    );
  }

  if (view === "camera-permission") {
    return (
      <>
        {hydrationMarker}
        <CameraPermissionScreen
          diagnostics={diagnostics}
          errorMessage={errorMessage}
          isReady={isHydrated}
          lastAction={lastAction}
          onContinue={() => {
            resetCaptureSession("live");
            navigateToView("position-user");
          }}
          onUseMockCamera={() => {
            setCameraMode("mock");
            resetCaptureSession("mock");
            viewRef.current = "position-user";
            window.history.pushState(null, "", "/?step=position-user&camera=mock");
            setView("position-user");
          }}
          onRequestCamera={requestCamera}
          status={status}
        />
      </>
    );
  }

  return (
    <>
      {hydrationMarker}
      <ScannerExperience
        captureSummary={sessionSummary}
        captureUploadState={uploadState}
        cameraFacingMode={cameraFacingMode}
        canSwitchCamera={canSwitchCamera}
        onCaptureFrame={captureFrame}
        onCaptureVideo={captureVideo}
        onAdvance={goToNextScanState}
        onExportSession={exportCaptureSession}
        onExit={resetSession}
        onProcessSession={processUploadedSession}
        onRetakePhase={handleRetakePhase}
        onRestart={resetSession}
        onRefreshProcessing={refreshProcessingJobStatus}
        onSubjectHeightChange={setSubjectHeightCm}
        onVideoStatusChange={setVideoStatus}
        onSwitchCamera={switchCamera}
        onUploadSession={uploadCaptureSession}
        subjectHeightCm={sessionSummary.subject.heightCm}
        useMockCamera={cameraMode === "mock"}
        scanState={view}
        stream={stream}
      />
    </>
  );
}
