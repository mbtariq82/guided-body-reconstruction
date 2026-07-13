import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AvatarAssetRouteContext = {
  params: Promise<{
    assetPath: string[];
    sessionId: string;
  }>;
};

export async function GET(_request: Request, context: AvatarAssetRouteContext) {
  const { assetPath, sessionId } = await context.params;
  const assetFile = resolveAvatarAssetPath(sessionId, assetPath);

  if (!assetFile) {
    return NextResponse.json({ error: "Invalid avatar asset path." }, { status: 400 });
  }

  try {
    const fileStats = await stat(/* turbopackIgnore: true */ assetFile);

    if (!fileStats.isFile()) {
      return NextResponse.json({ error: "Avatar asset not found." }, { status: 404 });
    }

    const bytes = await readFile(/* turbopackIgnore: true */ assetFile);
    return new NextResponse(bytes, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Length": String(bytes.byteLength),
        "Content-Type": getContentType(assetFile),
      },
    });
  } catch {
    return NextResponse.json({ error: "Avatar asset not found." }, { status: 404 });
  }
}

function resolveAvatarAssetPath(sessionId: string, assetPath: string[]) {
  if (!Array.isArray(assetPath) || assetPath.length === 0) {
    return null;
  }

  const safeSessionId = sanitizePathSegment(sessionId);
  const safeAssetPath = assetPath.map(sanitizePathSegment).join(path.sep);
  const assetRoot = path.join(
    /*turbopackIgnore: true*/ process.cwd(),
    ".scan-uploads",
    safeSessionId,
    "avatar-reconstruction",
    "assets",
  );
  const resolvedPath = path.resolve(assetRoot, safeAssetPath);

  return resolvedPath.startsWith(`${path.resolve(assetRoot)}${path.sep}`) ||
    resolvedPath === path.resolve(assetRoot)
    ? resolvedPath
    : null;
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 128);
}

function getContentType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".glb") {
    return "model/gltf-binary";
  }

  if (extension === ".gltf") {
    return "model/gltf+json";
  }

  if (extension === ".obj") {
    return "text/plain; charset=utf-8";
  }

  if (extension === ".ply" || extension === ".splat" || extension === ".ksplat") {
    return "application/octet-stream";
  }

  if (extension === ".png") {
    return "image/png";
  }

  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }

  if (extension === ".webp") {
    return "image/webp";
  }

  if (extension === ".json") {
    return "application/json; charset=utf-8";
  }

  return "application/octet-stream";
}
