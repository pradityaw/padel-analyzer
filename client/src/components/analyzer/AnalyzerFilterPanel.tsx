import * as React from "react";
import { cn } from "@/lib/utils";
import { SHOT_TYPE_COLORS, type ShotType } from "@shared/types";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const STROKE_OPTIONS = [
  { value: "vibora", label: "Víbora" },
  { value: "bandeja", label: "Bandeja" },
  { value: "smash", label: "Smash" },
] as const;

const SPIN_OPTIONS = [
  { value: "flat", label: "Flat" },
  { value: "slice", label: "Slice" },
  { value: "topspin", label: "Topspin" },
] as const;

const filterToggleGroupClass =
  "flex flex-wrap gap-2 w-full data-[orientation=horizontal]:flex-wrap";

const filterToggleItemClass = cn(
  "rounded-full border-rule text-ink-2 text-xs font-medium",
  "hover:border-muted-2 hover:bg-white/5 hover:text-ink",
  "data-pressed:border-accent/60 data-pressed:bg-accent/10 data-pressed:text-accent"
);

const accordionTriggerClass =
  "py-3 text-sm font-medium text-ink hover:text-accent hover:no-underline [&_[data-slot=accordion-trigger-icon]]:text-ink-2";

const accordionItemClass = "border-rule last:border-b-0";

export type AnalyzerFilterPanelProps = {
  playerIds: number[];
  selectedPlayerIds: Set<number>;
  onPlayerIdsChange: (next: Set<number>) => void;
  selectedStrokeTypes: Set<string>;
  onStrokeTypesChange: (next: Set<string>) => void;
  selectedSpinTypes: Set<string>;
  onSpinTypesChange: (next: Set<string>) => void;
  activeShotType: string | null;
  className?: string;
};

function setFromStrings(values: string[]): Set<string> {
  return new Set(values);
}

function setFromNumericStrings(values: string[]): Set<number> {
  return new Set(values.map((v) => Number(v)));
}

export function AnalyzerFilterPanel({
  playerIds,
  selectedPlayerIds,
  onPlayerIdsChange,
  selectedStrokeTypes,
  onStrokeTypesChange,
  selectedSpinTypes,
  onSpinTypesChange,
  activeShotType,
  className,
}: AnalyzerFilterPanelProps) {
  const selectedPlayerValues = React.useMemo(
    () => Array.from(selectedPlayerIds, String),
    [selectedPlayerIds]
  );

  const selectedStrokeValues = React.useMemo(
    () => Array.from(selectedStrokeTypes),
    [selectedStrokeTypes]
  );

  const selectedSpinValues = React.useMemo(
    () => Array.from(selectedSpinTypes),
    [selectedSpinTypes]
  );

  return (
    <aside
      className={cn(
        "flex flex-col rounded-2xl border border-rule bg-surface text-ink",
        "md:max-h-[calc(100vh-8rem)] md:overflow-y-auto",
        className
      )}
    >
      <div className="border-b border-rule px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-2">
          Filters
        </h2>
        {activeShotType && (
          <p className="mt-1 text-xs text-ink-2">
            Active shot:{" "}
            <span className="font-medium text-accent">{activeShotType}</span>
          </p>
        )}
      </div>

      <Accordion
        multiple
        defaultValue={["players", "stroke", "spin"]}
        className="px-4"
      >
        {playerIds.length > 0 ? (
        <AccordionItem value="players" className={accordionItemClass}>
          <AccordionTrigger className={accordionTriggerClass}>
            Players
          </AccordionTrigger>
          <AccordionContent>
            <ToggleGroup
              multiple
              value={selectedPlayerValues}
              onValueChange={(next) =>
                onPlayerIdsChange(setFromNumericStrings(next))
              }
              className={filterToggleGroupClass}
            >
              {playerIds.map((id) => (
                <ToggleGroupItem
                  key={id}
                  value={String(id)}
                  aria-label={`Player ${id}`}
                  className={filterToggleItemClass}
                >
                  Player {id}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </AccordionContent>
        </AccordionItem>
        ) : null}

        <AccordionItem value="stroke" className={accordionItemClass}>
          <AccordionTrigger className={accordionTriggerClass}>
            Stroke type
          </AccordionTrigger>
          <AccordionContent>
            <ToggleGroup
              multiple
              value={selectedStrokeValues}
              onValueChange={(next) => onStrokeTypesChange(setFromStrings(next))}
              className={filterToggleGroupClass}
            >
              {STROKE_OPTIONS.map(({ value, label }) => {
                const color =
                  SHOT_TYPE_COLORS[value as ShotType] ?? "#6b75a3";
                const isActive = activeShotType === value;

                return (
                  <ToggleGroupItem
                    key={value}
                    value={value}
                    aria-label={label}
                    className={cn(
                      filterToggleItemClass,
                      isActive && "ring-1 ring-accent/70"
                    )}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    {label}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="spin" className={accordionItemClass}>
          <AccordionTrigger className={accordionTriggerClass}>
            Spin
          </AccordionTrigger>
          <AccordionContent>
            <p className="mb-2 text-[10px] text-muted-2">
              Spin labels are not in analysis data yet — preview only.
            </p>
            <ToggleGroup
              multiple
              disabled
              value={selectedSpinValues}
              onValueChange={(next) => onSpinTypesChange(setFromStrings(next))}
              className={cn(filterToggleGroupClass, "opacity-50")}
            >
              {SPIN_OPTIONS.map(({ value, label }) => (
                <ToggleGroupItem
                  key={value}
                  value={value}
                  aria-label={label}
                  disabled
                  className={filterToggleItemClass}
                >
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </aside>
  );
}

export default AnalyzerFilterPanel;
