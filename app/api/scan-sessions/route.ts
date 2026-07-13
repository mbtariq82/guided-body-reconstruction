import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { listScanSessions } from "@/scripts/process-scan-jobs.mjs";
import type {
  ScanProcessingJob,
  ScanProcessingJobStatusResponse,
} from "@/types/scan";

export const runtime = "nodejs";

const maxUploadBytes = 150 * 1024 * 1024;
const uploadRoot = ".scan-uploads";

type StoredUpload = {
  archiveFile: string;
  archiveSize: number;
  manifestFile: string;
  processingJob: ScanProcessingJob;
  processingJobFile: string;
  sessionId: string;
  storedAt: string;
} & ScanProcessingJobStatusResponse;

export async function GET() {
  return NextResponse.json({
    sessions: await listScanSessions(),
  });
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const archive = formData.get("archive");
    const sessionIdValue = formData.get("sessionId");
    const metadataValue = formData.get("metadata");

    if (!(archive instanceof File)) {
      return NextResponse.json({ error: "Missing session archive." }, { status: 400 });
    }

    if (archive.size <= 0) {
      return NextResponse.json({ error: "Session archive is empty." }, { status: 400 });
    }

    if (archive.size > maxUploadBytes) {
      return NextResponse.json({ error: "Session archive is too large." }, { status: 413 });
    }

    const sessionId =
      typeof sessionIdValue === "string" && sessionIdValue.length > 0
        ? sanitizePathSegment(sessionIdValue)
        : sanitizePathSegment(path.basename(archive.name, ".zip"));

    const storedAt = new Date().toISOString();
    const sessionDirectory = path.join(process.cwd(), uploadRoot, sessionId);
    const archiveFile = path.join(sessionDirectory, `${sessionId}.zip`);
    const manifestFile = path.join(sessionDirectory, "upload.json");
    const processingJobFile = path.join(sessionDirectory, "processing-job.json");
    const archiveBytes = Buffer.from(await archive.arrayBuffer());
    const metadata =
      typeof metadataValue === "string" && metadataValue.length > 0
        ? safeParseJson(metadataValue)
        : null;

    await mkdir(sessionDirectory, { recursive: true });
    await writeFile(archiveFile, archiveBytes);
    await writeFile(
      manifestFile,
      JSON.stringify(
        {
          archive: {
            contentType: archive.type || "application/zip",
            name: archive.name,
            size: archive.size,
          },
          metadata,
          sessionId,
          storedAt,
        },
        null,
        2,
      ),
    );

    const processingJob = createProcessingJob({
      archiveFile: path.relative(process.cwd(), archiveFile),
      manifestFile: path.relative(process.cwd(), manifestFile),
      sessionId,
      storedAt,
    });

    await writeFile(processingJobFile, JSON.stringify(processingJob, null, 2));

    const response: StoredUpload = {
      archiveFile: path.relative(process.cwd(), archiveFile),
      archiveSize: archive.size,
      avatarMesh: null,
      manifestFile: path.relative(process.cwd(), manifestFile),
      measurementReport: null,
      processingJob,
      processingJobFile: path.relative(process.cwd(), processingJobFile),
      sessionId,
      storedAt,
      validationReport: null,
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to store scan session upload.",
      },
      { status: 500 },
    );
  }
}

function createProcessingJob({
  archiveFile,
  manifestFile,
  sessionId,
  storedAt,
}: {
  archiveFile: string;
  manifestFile: string;
  sessionId: string;
  storedAt: string;
}): ScanProcessingJob {
  return {
    attempts: 0,
    createdAt: storedAt,
    id: `job-${sessionId}`,
    input: {
      archiveFile,
      manifestFile,
    },
    notes: [
      "Queued after scan session upload.",
      "Local measurement extraction will run after dataset validation.",
    ],
    output: null,
    sessionId,
    stage: "awaiting-reconstruction",
    status: "queued",
    updatedAt: storedAt,
  };
}

function sanitizePathSegment(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
  return sanitized.slice(0, 96) || `scan-${Date.now()}`;
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
