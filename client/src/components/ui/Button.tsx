import { forwardRef, type ButtonHTMLAttributes } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 font-medium transition-colors focus-ring disabled:opacity-50 disabled:pointer-events-none",
  {
    variants: {
      variant: {
        primary: "bg-padel-green text-black hover:opacity-90",
        ghost: "border border-padel-border text-text-secondary hover:text-text-primary hover:border-slate-500 hover:bg-white/5",
        danger: "border border-red-400/30 text-red-400 hover:bg-red-400/10",
      },
      size: {
        sm: "text-xs px-3 py-1.5 rounded-[var(--radius-button)]",
        md: "text-sm px-4 py-2.5 rounded-[var(--radius-button)]",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asMotion?: boolean;
  };

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asMotion = false, ...props }, ref) => {
    const prefersReduced = useReducedMotion();

    if (asMotion) {
      return (
        <motion.button
          ref={ref}
          whileTap={prefersReduced ? undefined : { scale: 0.97 }}
          className={cn(buttonVariants({ variant, size }), className)}
          {...(props as React.ComponentProps<typeof motion.button>)}
        />
      );
    }

    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";
export { Button, buttonVariants };
