import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedAssets = new Set([
  "pose_landmark_full.tflite",
  "pose_landmark_heavy.tflite",
  "pose_landmark_lite.tflite",
  "pose_solution_packed_assets.data",
  "pose_solution_packed_assets_loader.js",
  "pose_solution_simd_wasm_bin.data",
  "pose_solution_simd_wasm_bin.js",
  "pose_solution_simd_wasm_bin.wasm",
  "pose_solution_wasm_bin.js",
  "pose_solution_wasm_bin.wasm",
  "pose_web.binarypb",
]);

type PoseAssetRouteContext = {
  params: Promise<{ asset: string }>;
};

export async function GET(_request: Request, context: PoseAssetRouteContext) {
  const { asset } = await context.params;

  if (!allowedAssets.has(asset)) {
    return NextResponse.json({ error: "Pose asset not found." }, { status: 404 });
  }

  try {
    const assetPath = path.join(
      /* turbopackIgnore: true */ process.cwd(),
      "node_modules",
      "@mediapipe",
      "pose",
      asset,
    );
    const bytes = await readFile(/* turbopackIgnore: true */ assetPath);

    return new NextResponse(bytes, {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": String(bytes.byteLength),
        "Content-Type": getContentType(asset),
      },
    });
  } catch {
    return NextResponse.json({ error: "Pose asset not found." }, { status: 404 });
  }
}

function getContentType(asset: string) {
  if (asset.endsWith(".js")) {
    return "application/javascript; charset=utf-8";
  }

  if (asset.endsWith(".wasm")) {
    return "application/wasm";
  }

  return "application/octet-stream";
}
