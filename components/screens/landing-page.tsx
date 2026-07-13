import Image from "next/image";
import type { MouseEventHandler } from "react";
import { ArrowRight, BadgeCheck, Database, LockKeyhole, ScanLine } from "lucide-react";
import { PrimaryLink } from "@/components/ui/primary-button";

type LandingPageProps = {
  onStart: MouseEventHandler<HTMLAnchorElement>;
  startHref: string;
};

export function LandingPage({ onStart, startHref }: LandingPageProps) {
  return (
    <main className="min-h-svh bg-[#f5f5f2] text-[#111312]">
      <section className="relative min-h-[84svh] overflow-hidden">
        <Image
          src="/images/scanner-hero.png"
          alt="A guided body scan setup in a minimal studio"
          fill
          priority
          sizes="100vw"
          className="object-cover object-center"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(245,245,242,0.94)_0%,rgba(245,245,242,0.78)_36%,rgba(245,245,242,0.12)_72%)]" />
        <div className="relative z-10 flex min-h-[84svh] items-center px-6 py-16 sm:px-10 lg:px-16">
          <div className="max-w-2xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-white/72 px-4 py-2 text-xs font-semibold uppercase text-[#4d5450] shadow-sm ring-1 ring-black/5 backdrop-blur">
              <ScanLine size={15} />
              Smartphone human digitisation
            </div>
            <h1 className="max-w-xl text-balance text-5xl font-semibold leading-[0.98] text-[#111312] sm:text-6xl lg:text-7xl">
              Guided Body Reconstruction
            </h1>
            <p className="mt-6 max-w-lg text-pretty text-lg leading-8 text-[#4c5550] sm:text-xl">
              Capture a reconstruction-grade body sequence, recover a metric SMPL-X human model, and inspect the evidence behind every result.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <PrimaryLink href={startHref} onClick={onStart}>
                Start Scan
                <ArrowRight size={18} />
              </PrimaryLink>
              <PrimaryLink href="/sessions" native variant="light">
                Sessions
                <Database size={18} />
              </PrimaryLink>
              <p className="text-sm font-medium text-[#5b625e]">Self-hosted research pipeline</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-px bg-[#d8dad6] sm:grid-cols-3">
        {[
          { icon: BadgeCheck, title: "Geometry coverage", copy: "Angle-balanced 360-degree capture with bilateral side profiles." },
          { icon: LockKeyhole, title: "Local ownership", copy: "Sessions and generated human models remain on the reconstruction host." },
          { icon: ScanLine, title: "SMPL-X foundation", copy: "Metric body shape, expressive joints, hands, face, and model parameters." },
        ].map((item) => (
          <div key={item.title} className="bg-[#f5f5f2] px-6 py-7 sm:px-10">
            <item.icon className="mb-5 h-6 w-6 text-[#1e5cff]" />
            <h2 className="text-base font-semibold text-[#171918]">{item.title}</h2>
            <p className="mt-2 max-w-sm text-sm leading-6 text-[#626963]">{item.copy}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
