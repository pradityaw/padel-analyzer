import { cn } from "@/lib/utils";

/** Tier-A CSS sport textures for flood cards (design.md — no external assets). */
export type SportPatternVariant = "mesh" | "diagonal" | "dots";

const variantClass: Record<SportPatternVariant, string> = {
  mesh: "sport-pattern-mesh",
  diagonal: "sport-pattern-diagonal",
  dots: "sport-pattern-dots",
};

export default function SportPattern({
  variant = "mesh",
  className,
}: {
  variant?: SportPatternVariant;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 rounded-[inherit] opacity-40",
        variantClass[variant],
        className
      )}
    />
  );
}
