"use client";

import { Box, CircleUserRound, Eye, Grid3X3, RotateCw, Ruler } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type * as ThreeNamespace from "three";
import type { AvatarModelAsset, BodyAvatarMeshReport, BodyMeasurementKey } from "@/types/scan";
import { cn } from "@/utils/cn";

type ReconstructionAvatarViewerProps = {
  avatarMesh: BodyAvatarMeshReport;
  reconstructionAssets?: AvatarModelAsset[];
};

type DisplayMode = "surface" | "silhouette" | "topology";
type RuntimeStatus = "error" | "loading" | "ready";
type ThreeModule = typeof ThreeNamespace;

const measurementOrder: BodyMeasurementKey[] = [
  "height",
  "neck",
  "shoulderWidth",
  "chest",
  "waist",
  "hips",
  "thigh",
  "inseam",
  "sleeveLength",
];

const measurementLabels: Record<BodyMeasurementKey, string> = {
  chest: "Chest",
  height: "Height",
  hips: "Hips",
  inseam: "Inseam",
  neck: "Neck",
  shoulderWidth: "Shoulder",
  sleeveLength: "Sleeve",
  thigh: "Thigh",
  waist: "Waist",
};

const displayModes: Array<{
  icon: typeof Eye;
  id: DisplayMode;
  label: string;
}> = [
  { icon: CircleUserRound, id: "surface", label: "Surface" },
  { icon: Eye, id: "silhouette", label: "Silhouette" },
  { icon: Grid3X3, id: "topology", label: "Topology" },
];

export function ReconstructionAvatarViewer({
  avatarMesh,
  reconstructionAssets = [],
}: ReconstructionAvatarViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const autoRotateRef = useRef(true);
  const [autoRotate, setAutoRotate] = useState(true);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("surface");
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>("loading");
  const [meshStats, setMeshStats] = useState({ faces: 0, meshes: 0, vertices: 0 });
  const reconstructionAsset = useMemo(
    () => selectRenderableAvatarAsset(reconstructionAssets),
    [reconstructionAssets],
  );
  const measurements = measurementOrder
    .map((key) => ({ key, label: measurementLabels[key], value: avatarMesh.measurements[key] }))
    .filter((item) => typeof item.value === "number");

  useEffect(() => {
    autoRotateRef.current = autoRotate;
  }, [autoRotate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;

    if (!canvas || !container) {
      return;
    }

    const avatarCanvas = canvas;
    const avatarContainer = container;
    let disposed = false;
    let cleanup: (() => void) | null = null;

    async function renderAvatar() {
      try {
        setRuntimeStatus("loading");
        const THREE = await import("three");
        const renderer = new THREE.WebGLRenderer({ antialias: true, canvas: avatarCanvas });
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.12;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x101311);
        const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 2000);
        const targetHeight = avatarMesh.measurements.height ?? 175;
        const model = reconstructionAsset
          ? await loadReconstructedAvatar(THREE, reconstructionAsset, targetHeight)
          : createMeasuredFallbackAvatar(THREE, avatarMesh);

        if (disposed) {
          disposeObject(model);
          renderer.dispose();
          return;
        }

        applyInspectionMaterial(THREE, model, displayMode);
        const stats = getObjectGeometryStats(model);
        setMeshStats(stats);
        scene.add(model);

        const bounds = new THREE.Box3().setFromObject(model);
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        const height = Math.max(size.y, targetHeight);
        const width = Math.max(size.x, size.z, height * 0.28);
        const floorY = bounds.min.y;
        const floor = createStudioFloor(THREE, height, floorY);
        scene.add(floor);

        scene.add(new THREE.HemisphereLight(0xfff4e8, 0x1b2421, 2.35));
        const keyLight = new THREE.DirectionalLight(0xffffff, 3.9);
        keyLight.position.set(height * 0.55, height * 0.9, height * 0.72);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.set(2048, 2048);
        scene.add(keyLight);
        const fillLight = new THREE.DirectionalLight(0x8ab6ff, 1.45);
        fillLight.position.set(-height * 0.7, height * 0.55, -height * 0.5);
        scene.add(fillLight);
        const faceLight = new THREE.DirectionalLight(0xffd8bf, 1.1);
        faceLight.position.set(0, height * 0.72, height);
        scene.add(faceLight);

        let rotationY = -0.22;
        let rotationX = 0.015;
        let zoom = 1;
        let pointer: null | {
          rotationX: number;
          rotationY: number;
          x: number;
          y: number;
        } = null;
        let previousTime = performance.now();

        const updateCamera = () => {
          const halfFov = THREE.MathUtils.degToRad(camera.fov * 0.5);
          const verticalDistance = height * 0.6 / Math.tan(halfFov);
          const horizontalDistance = width * 0.7 / Math.max(0.35, Math.tan(halfFov) * camera.aspect);
          const distance = Math.max(verticalDistance, horizontalDistance, height * 1.92) * zoom;
          camera.position.set(center.x, center.y + height * 0.025, center.z + distance);
          camera.lookAt(center.x, center.y + height * 0.01, center.z);
        };

        const resize = () => {
          const rect = avatarContainer.getBoundingClientRect();
          renderer.setSize(Math.max(1, Math.floor(rect.width)), Math.max(1, Math.floor(rect.height)), false);
          camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
          camera.updateProjectionMatrix();
          updateCamera();
        };

        const animate = (time: number) => {
          if (disposed) {
            return;
          }

          const delta = Math.min(0.05, Math.max(0, (time - previousTime) / 1000));
          previousTime = time;

          if (autoRotateRef.current && !pointer) {
            rotationY += delta * 0.16;
          }

          model.rotation.set(rotationX, rotationY, 0);
          renderer.render(scene, camera);
          window.requestAnimationFrame(animate);
        };

        const handlePointerDown = (event: PointerEvent) => {
          pointer = { rotationX, rotationY, x: event.clientX, y: event.clientY };
          avatarCanvas.setPointerCapture(event.pointerId);
        };
        const handlePointerMove = (event: PointerEvent) => {
          if (!pointer) {
            return;
          }

          rotationY = pointer.rotationY + (event.clientX - pointer.x) * 0.012;
          rotationX = Math.max(-0.3, Math.min(0.2, pointer.rotationX + (event.clientY - pointer.y) * 0.006));
        };
        const clearPointer = () => {
          pointer = null;
        };
        const handleWheel = (event: WheelEvent) => {
          event.preventDefault();
          zoom = Math.max(0.82, Math.min(1.55, zoom + event.deltaY * 0.0008));
          updateCamera();
        };

        const observer = new ResizeObserver(resize);
        observer.observe(avatarContainer);
        avatarCanvas.addEventListener("pointerdown", handlePointerDown);
        avatarCanvas.addEventListener("pointermove", handlePointerMove);
        avatarCanvas.addEventListener("pointerup", clearPointer);
        avatarCanvas.addEventListener("pointercancel", clearPointer);
        avatarCanvas.addEventListener("wheel", handleWheel, { passive: false });
        resize();
        updateCamera();
        window.requestAnimationFrame(animate);
        setRuntimeStatus("ready");

        cleanup = () => {
          observer.disconnect();
          avatarCanvas.removeEventListener("pointerdown", handlePointerDown);
          avatarCanvas.removeEventListener("pointermove", handlePointerMove);
          avatarCanvas.removeEventListener("pointerup", clearPointer);
          avatarCanvas.removeEventListener("pointercancel", clearPointer);
          avatarCanvas.removeEventListener("wheel", handleWheel);
          scene.traverse((object) => {
            if ((object as ThreeNamespace.Mesh).isMesh) {
              const mesh = object as ThreeNamespace.Mesh;
              mesh.geometry.dispose();
              disposeMaterial(mesh.material);
            }
          });
          renderer.dispose();
        };
      } catch (error) {
        console.error("Unable to render reconstructed avatar.", error);
        setRuntimeStatus("error");
      }
    }

    void renderAvatar();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [avatarMesh, displayMode, reconstructionAsset]);

  return (
    <section className="mt-8 overflow-hidden bg-[#101311] text-white">
      <div className="grid min-h-[620px] lg:h-[min(820px,calc(100svh-96px))] lg:grid-cols-[minmax(0,1fr)_340px]">
        <div ref={containerRef} className="relative min-h-[560px] lg:min-h-0">
          <canvas
            aria-label="3D reconstructed human body"
            className="h-full w-full touch-none"
            data-testid="reconstruction-avatar-canvas"
            ref={canvasRef}
          />
          <div className="pointer-events-none absolute left-4 top-4 rounded-[6px] bg-black/48 px-3 py-2 text-xs font-semibold uppercase text-white/74 ring-1 ring-white/12 backdrop-blur">
            {runtimeStatus === "ready"
              ? reconstructionAsset
                ? getAssetSourceLabel(reconstructionAsset)
                : "Measured fallback"
              : runtimeStatus === "error"
                ? "Render unavailable"
                : "Loading reconstruction"}
          </div>
        </div>

        <aside className="border-t border-white/10 bg-[#151816] p-5 lg:overflow-y-auto lg:border-l lg:border-t-0">
          <p className="text-xs font-semibold uppercase text-white/42">Reconstruction workbench</p>
          <h2 className="mt-2 text-2xl font-semibold">Human model inspection</h2>
          <p className="mt-3 text-sm leading-6 text-white/58">
            {reconstructionAsset
              ? `${reconstructionAsset.file} · ${formatBytes(reconstructionAsset.sizeBytes)}`
              : "No generated GLB is available for this session."}
          </p>

          <div className="mt-7">
            <p className="text-xs font-semibold uppercase text-white/42">View</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {displayModes.map((mode) => (
                <button
                  aria-pressed={displayMode === mode.id}
                  className={cn(
                    "grid min-h-16 place-items-center rounded-[6px] px-2 text-xs font-semibold ring-1 transition",
                    displayMode === mode.id
                      ? "bg-white text-[#111312] ring-white"
                      : "bg-white/4 text-white/68 ring-white/10 hover:bg-white/8",
                  )}
                  key={mode.id}
                  onClick={() => setDisplayMode(mode.id)}
                  type="button"
                >
                  <mode.icon size={18} />
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          <button
            aria-pressed={autoRotate}
            className="mt-3 flex min-h-11 w-full items-center justify-between rounded-[6px] bg-white/4 px-3 text-sm font-semibold text-white/72 ring-1 ring-white/10 transition hover:bg-white/8"
            onClick={() => setAutoRotate((current) => !current)}
            type="button"
          >
            <span className="inline-flex items-center gap-2"><RotateCw size={17} />Auto rotate</span>
            <span className={cn("h-5 w-9 rounded-full p-0.5 transition", autoRotate ? "bg-[#55d98a]" : "bg-white/16")}>
              <span className={cn("block h-4 w-4 rounded-full bg-white transition", autoRotate && "translate-x-4")} />
            </span>
          </button>

          <div className="mt-7 grid grid-cols-3 gap-2">
            <ModelStat icon={Box} label="Meshes" value={String(meshStats.meshes)} />
            <ModelStat icon={CircleUserRound} label="Vertices" value={formatNumber(meshStats.vertices)} />
            <ModelStat icon={Grid3X3} label="Faces" value={formatNumber(meshStats.faces)} />
          </div>

          <div className="mt-7">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase text-white/42">
              <Ruler size={15} /> Measurements
            </div>
            <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-[6px] bg-white/8 ring-1 ring-white/8">
              {measurements.map((measurement) => (
                <div className="bg-[#151816] px-3 py-3" key={measurement.key}>
                  <p className="text-[11px] font-semibold uppercase text-white/38">{measurement.label}</p>
                  <p className="mt-1 text-base font-semibold">{measurement.value} cm</p>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

async function loadReconstructedAvatar(
  THREE: ThreeModule,
  asset: AvatarModelAsset,
  targetHeight: number,
) {
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const separator = asset.url.includes("?") ? "&" : "?";
  const version = encodeURIComponent(`${asset.createdAt}-${asset.sizeBytes}`);
  const gltf = await new GLTFLoader().loadAsync(`${asset.url}${separator}v=${version}`);
  const model = gltf.scene;
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());

  if (!Number.isFinite(size.y) || size.y <= 0.001) {
    throw new Error("The reconstruction asset has invalid bounds.");
  }

  model.scale.multiplyScalar(targetHeight / size.y);
  model.updateMatrixWorld(true);
  const normalizedBounds = new THREE.Box3().setFromObject(model);
  const center = normalizedBounds.getCenter(new THREE.Vector3());
  model.position.sub(center);
  model.updateMatrixWorld(true);
  return model;
}

function createMeasuredFallbackAvatar(THREE: ThreeModule, report: BodyAvatarMeshReport) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(report.mesh.vertices.flat(), 3));
  geometry.setIndex(report.mesh.faces.flat());
  geometry.computeVertexNormals();
  geometry.center();
  return new THREE.Mesh(geometry);
}

function applyInspectionMaterial(
  THREE: ThreeModule,
  model: ThreeNamespace.Object3D,
  displayMode: DisplayMode,
) {
  model.traverse((object) => {
    if (!(object as ThreeNamespace.Mesh).isMesh) {
      return;
    }

    const mesh = object as ThreeNamespace.Mesh;
    if (!mesh.geometry.getAttribute("normal")) {
      mesh.geometry.computeVertexNormals();
    }
    disposeMaterial(mesh.material);
    mesh.material = displayMode === "topology"
      ? new THREE.MeshStandardMaterial({
          color: 0xb8d8c8,
          metalness: 0,
          roughness: 0.72,
          wireframe: true,
        })
      : displayMode === "silhouette"
        ? new THREE.MeshStandardMaterial({ color: 0x1d2521, roughness: 1 })
        : new THREE.MeshPhysicalMaterial({
            color: 0xb98269,
            metalness: 0,
            roughness: 0.6,
            sheen: 0.16,
            sheenColor: 0xffd7c3,
          });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
}

function createStudioFloor(THREE: ThreeModule, height: number, floorY: number) {
  const geometry = new THREE.CircleGeometry(height * 0.75, 72);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({ color: 0x222925, roughness: 0.96 });
  const floor = new THREE.Mesh(geometry, material);
  floor.position.y = floorY - height * 0.004;
  floor.receiveShadow = true;
  return floor;
}

function getObjectGeometryStats(model: ThreeNamespace.Object3D) {
  const stats = { faces: 0, meshes: 0, vertices: 0 };

  model.traverse((object) => {
    if (!(object as ThreeNamespace.Mesh).isMesh) {
      return;
    }

    const geometry = (object as ThreeNamespace.Mesh).geometry;
    const positions = geometry.getAttribute("position");
    stats.meshes += 1;
    stats.vertices += positions?.count ?? 0;
    stats.faces += Math.floor((geometry.getIndex()?.count ?? positions?.count ?? 0) / 3);
  });
  return stats;
}

function selectRenderableAvatarAsset(assets: AvatarModelAsset[]) {
  const renderable = assets.filter((asset) => asset.type === "glb" || asset.type === "gltf");
  return renderable.find((asset) => !asset.file.toLowerCase().includes("fallback")) ?? renderable[0] ?? null;
}

function getAssetSourceLabel(asset: AvatarModelAsset) {
  const file = asset.file.toLowerCase();
  if (file.includes("smplx")) return "SMPL-X reconstruction";
  if (file.includes("econ")) return "ECON reconstruction";
  if (file.includes("lhm")) return "LHM reconstruction";
  if (file.includes("fallback")) return "Measured fallback";
  return "Generated reconstruction";
}

function ModelStat({ icon: Icon, label, value }: { icon: typeof Box; label: string; value: string }) {
  return (
    <div className="rounded-[6px] bg-white/4 px-3 py-3 ring-1 ring-white/8">
      <Icon size={15} className="text-[#7fe0a5]" />
      <p className="mt-3 text-[10px] font-semibold uppercase text-white/36">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}

function disposeObject(object: ThreeNamespace.Object3D) {
  object.traverse((child) => {
    if ((child as ThreeNamespace.Mesh).isMesh) {
      const mesh = child as ThreeNamespace.Mesh;
      mesh.geometry.dispose();
      disposeMaterial(mesh.material);
    }
  });
}

function disposeMaterial(material: ThreeNamespace.Material | ThreeNamespace.Material[]) {
  for (const item of Array.isArray(material) ? material : [material]) {
    item.dispose();
  }
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-GB", { notation: value >= 100000 ? "compact" : "standard" }).format(value);
}
