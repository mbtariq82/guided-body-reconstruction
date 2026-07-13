import { GuidedBodyReconstructionApp } from "@/components/guided-body-reconstruction-app";
import { getAppViewFromStepParam } from "@/lib/scan-routes";

type HomeProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const initialView = getAppViewFromStepParam(params?.step);
  const initialCameraMode = params?.camera === "mock" ? "mock" : "live";

  return (
    <GuidedBodyReconstructionApp
      initialCameraMode={initialCameraMode}
      initialView={initialView}
    />
  );
}
