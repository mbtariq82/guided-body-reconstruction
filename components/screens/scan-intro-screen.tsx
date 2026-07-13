import type { MouseEventHandler } from "react";
import { ArrowRight, Clock3, Lightbulb, Ruler, Shirt, UserRoundCheck } from "lucide-react";
import { PrimaryLink } from "@/components/ui/primary-button";

type ScanIntroScreenProps = {
  beginHref: string;
  onBegin: MouseEventHandler<HTMLAnchorElement>;
};

const preparationItems = [
  {
    icon: Clock3,
    title: "One controlled sequence",
    copy: "You will rotate slowly, hold both profiles, move your arms, then capture identity detail.",
  },
  {
    icon: Shirt,
    title: "Wear fitted clothing",
    copy: "Avoid bulky jackets, loose layers, and large accessories.",
  },
  {
    icon: Lightbulb,
    title: "Use good lighting",
    copy: "Face a soft light source and avoid strong backlight.",
  },
  {
    icon: Ruler,
    title: "Stand around 2 metres away",
    copy: "Your full body should fit inside the camera frame.",
  },
];

export function ScanIntroScreen({ beginHref, onBegin }: ScanIntroScreenProps) {
  return (
    <main className="flex min-h-svh items-center bg-[#f5f5f2] px-5 py-8 text-[#111312] sm:px-8 lg:px-14">
      <div className="mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
        <section>
          <div className="mb-8 inline-flex h-14 w-14 items-center justify-center rounded-full bg-[#111312] text-white">
            <UserRoundCheck size={24} />
          </div>
          <p className="text-sm font-semibold uppercase text-[#68706a]">Before you begin</p>
          <h1 className="mt-4 max-w-lg text-balance text-4xl font-semibold leading-tight sm:text-5xl">
            A clean scan starts with a clear setup.
          </h1>
          <p className="mt-5 max-w-xl text-pretty text-lg leading-8 text-[#59615b]">
            The session records a fixed-camera geometry pass, temporal motion, and a separate identity view for metric SMPL-X reconstruction.
          </p>
          <PrimaryLink className="mt-9" href={beginHref} onClick={onBegin}>
            Begin Scan
            <ArrowRight size={18} />
          </PrimaryLink>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          {preparationItems.map((item) => (
            <article
              key={item.title}
              className="rounded-[8px] border border-black/8 bg-white/78 p-6 shadow-[0_18px_60px_rgba(20,24,22,0.08)]"
            >
              <item.icon className="h-6 w-6 text-[#1e5cff]" />
              <h2 className="mt-8 text-lg font-semibold text-[#171918]">{item.title}</h2>
              <p className="mt-3 text-sm leading-6 text-[#646b66]">{item.copy}</p>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
