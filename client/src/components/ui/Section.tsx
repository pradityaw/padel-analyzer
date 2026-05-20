import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type SectionProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  /** Optional eyebrow label above the title */
  label?: string;
  title?: string;
  subtitle?: string;
  narrow?: boolean;
};

export function Section({
  children,
  className,
  label,
  title,
  subtitle,
  narrow = false,
  ...props
}: SectionProps) {
  return (
    <section
      className={cn("py-16 md:py-24", className)}
      {...props}
    >
      <div
        className={cn(
          "mx-auto px-4",
          narrow ? "max-w-3xl" : "max-w-6xl"
        )}
      >
        {(label || title || subtitle) && (
          <header className="mb-10 md:mb-12 text-center max-w-2xl mx-auto">
            {label ? (
              <p className="text-xs font-semibold uppercase tracking-widest text-padel-green mb-2">
                {label}
              </p>
            ) : null}
            {title ? (
              <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">
                {title}
              </h2>
            ) : null}
            {subtitle ? (
              <p className="text-slate-400 text-base sm:text-lg">{subtitle}</p>
            ) : null}
          </header>
        )}
        {children}
      </div>
    </section>
  );
}
