import { useReducedMotion } from "framer-motion";
import type { Transition, Variants } from "framer-motion";

export const spring: Transition = {
  type: "spring",
  stiffness: 200,
  damping: 20,
};

export const springStiff: Transition = {
  type: "spring",
  stiffness: 400,
  damping: 25,
};

export const snappy: Transition = {
  type: "spring",
  stiffness: 500,
  damping: 30,
  mass: 0.8,
};

export const fadeInUp: Variants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

export const staggerContainer: Variants = {
  animate: {
    transition: { staggerChildren: 0.04 },
  },
};

export const staggerItem: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: spring },
};

export const staggerItemCoaching: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { ...spring, delay: 0.06 } },
};

export function useMotionSafe<T>(value: T, fallback: T | undefined = undefined): T | undefined {
  const prefersReduced = useReducedMotion();
  return prefersReduced ? fallback : value;
}
