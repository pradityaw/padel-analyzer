import { TRPCError } from "@trpc/server";
import type { AuthMode } from "../_core/context.js";

export function requireOwner(
  authMode: AuthMode,
  userId: number | null | undefined,
  rowUserId: number | null | undefined,
): void {
  if (authMode === "off") return;
  if (userId == null) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Sign in to continue.",
    });
  }
  if (rowUserId == null || rowUserId !== userId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Analysis not found.",
    });
  }
}

export function ownerIdForInsert(
  authMode: AuthMode,
  userId: number | null | undefined,
): number | null {
  if (authMode === "off") return userId ?? null;
  if (userId == null) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Sign in to continue.",
    });
  }
  return userId;
}
