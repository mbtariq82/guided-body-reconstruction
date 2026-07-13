import { NextResponse } from "next/server";
import {
  readAvatarReconstructionState,
  requestSelfHostedAvatarReconstruction,
} from "@/scripts/avatar-reconstruction-service.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AvatarReconstructionRouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function GET(_request: Request, context: AvatarReconstructionRouteContext) {
  const { sessionId } = await context.params;

  try {
    return NextResponse.json(await readAvatarReconstructionState(sessionId));
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to read avatar reconstruction status.",
      },
      { status: 404 },
    );
  }
}

export async function POST(request: Request, context: AvatarReconstructionRouteContext) {
  const { sessionId } = await context.params;

  try {
    const body = await request.json().catch(() => null);
    return NextResponse.json(
      await requestSelfHostedAvatarReconstruction(sessionId, {
        force: body?.force === true,
      }),
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to start avatar reconstruction.",
      },
      { status: 500 },
    );
  }
}
