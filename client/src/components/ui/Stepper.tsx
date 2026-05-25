import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

export type StepperStep = {
  id: string;
  title: string;
  description?: string;
};

type StepperProps = {
  steps: StepperStep[];
  activeIndex: number;
  orientation?: "horizontal" | "vertical";
  className?: string;
};

export function Stepper({
  steps,
  activeIndex,
  orientation = "horizontal",
  className,
}: StepperProps) {
  const vertical = orientation === "vertical";

  return (
    <ol
      className={cn(
        vertical
          ? "flex flex-col gap-4"
          : "grid grid-cols-1 sm:grid-cols-3 gap-6",
        className
      )}
      aria-label="Progress steps"
    >
      {steps.map((step, i) => {
        const completed = i < activeIndex;
        const active = i === activeIndex;
        return (
          <li
            key={step.id}
            className={cn(
              "flex gap-3",
              vertical ? "items-start" : "flex-col items-center text-center"
            )}
            aria-current={active ? "step" : undefined}
          >
            <div
              className={cn(
                "shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors",
                completed
                  ? "bg-padel-green border-padel-green text-black"
                  : active
                    ? "border-padel-green text-padel-green bg-padel-green/10"
                    : "border-slate-600 text-slate-500"
              )}
            >
              {completed ? <Check className="w-4 h-4" aria-hidden /> : i + 1}
            </div>
            <div className={vertical ? "pt-0.5" : ""}>
              <p
                className={cn(
                  "font-semibold text-sm",
                  active || completed ? "text-slate-200" : "text-slate-500"
                )}
              >
                {step.title}
              </p>
              {step.description ? (
                <p className="text-xs text-slate-500 mt-0.5">{step.description}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}