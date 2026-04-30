import { cn } from "@/lib/utils";

type Props = {
  color: string;
  children: React.ReactNode;
  className?: string;
};

export default function Badge({ color, children, className }: Props) {
  return (
    <span
      className={cn(
        "inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border",
        className
      )}
      style={{
        backgroundColor: `${color}18`,
        color,
        borderColor: `${color}44`,
      }}
    >
      {children}
    </span>
  );
}
