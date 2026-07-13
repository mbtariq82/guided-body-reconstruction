import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import Link from "next/link";
import { cn } from "@/utils/cn";

type PrimaryVariant = "dark" | "light" | "ghost";

type PrimaryButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: PrimaryVariant;
};

type PrimaryLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  children: ReactNode;
  href: string;
  native?: boolean;
  variant?: PrimaryVariant;
};

function primaryClasses(variant: PrimaryVariant, className?: string) {
  return cn(
    "inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 text-sm font-semibold transition duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
    variant === "dark" &&
      "bg-[#111312] text-white shadow-[0_18px_40px_rgba(0,0,0,0.18)] hover:bg-black focus-visible:outline-[#111312]",
    variant === "light" &&
      "bg-white text-[#111312] shadow-[0_18px_40px_rgba(0,0,0,0.16)] hover:bg-[#f2f2ef] focus-visible:outline-white",
    variant === "ghost" &&
      "bg-white/10 text-white ring-1 ring-white/30 backdrop-blur hover:bg-white/16 focus-visible:outline-white",
    className,
  );
}

export const PrimaryButton = forwardRef<HTMLButtonElement, PrimaryButtonProps>(
  function PrimaryButton(
    { children, className, variant = "dark", ...props },
    ref,
  ) {
    return (
      <button ref={ref} className={primaryClasses(variant, className)} {...props}>
        {children}
      </button>
    );
  },
);

export function PrimaryLink({
  children,
  className,
  href,
  native = false,
  variant = "dark",
  ...props
}: PrimaryLinkProps) {
  if (native) {
    return (
      <a className={primaryClasses(variant, className)} href={href} {...props}>
        {children}
      </a>
    );
  }

  return (
    <Link className={primaryClasses(variant, className)} href={href} {...props}>
      {children}
    </Link>
  );
}
