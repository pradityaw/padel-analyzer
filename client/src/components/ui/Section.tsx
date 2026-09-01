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
          <header className="mb-10 md:mb-12 max-w-2xl">
            {label ? (
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-2 mb-2">
                {label}
              </p>
            ) : null}
            {title ? (
              <h2 className="font-display-condensed text-3xl sm:text-4xl text-ink mb-3">
                {title}
              </h2>
            ) : null}
            {subtitle ? (
              <p className="text-ink-2 text-base sm:text-lg">{subtitle}</p>
            ) : null}
          </header>
        )}
        {children}
      </div>
    </section>
  );
}
