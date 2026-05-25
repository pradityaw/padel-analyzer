import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../_core/trpc.js";
import {
  completeUploadInputSchema,
  completeUploadResponseSchema,
  initiateUploadInputSchema,
  initiateUploadResponseSchema,
  uploadCapabilitiesSchema,
} from "../../shared/schema.js";
import {
  assertObjectExists,
  completeMultipartUpload,
  createPresignedUploadPlan,
  isObjectStorageConfigured,
} from "../lib/objectStorage.js";

export const objectStorageRouter = router({
  getCapabilities: publicProcedure.query(() => {
    return uploadCapabilitiesSchema.parse({
      mode: isObjectStorageConfigured() ? "cloud" : "local",
    });
  }),

  initiateUpload: publicProcedure
    .input(initiateUploadInputSchema)
    .mutation(async ({ input }) => {
      if (!isObjectStorageConfigured()) {
        return initiateUploadResponseSchema.parse({
          mode: "local",
          uploadUrl: "/api/upload",
        });
      }

      try {
        const plan = await createPresignedUploadPlan(input);
        return initiateUploadResponseSchema.parse(plan);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Could not prepare cloud upload.",
        });
      }
    }),

  completeUpload: publicProcedure
    .input(completeUploadInputSchema)
    .mutation(async ({ input }) => {
      if (!isObjectStorageConfigured()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cloud storage is not configured on this server.",
        });
      }

      try {
        if (input.uploadId) {
          if (!input.parts?.length) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Multipart completion requires part ETags.",
            });
          }
          await completeMultipartUpload({
            storageKey: input.storageKey,
            uploadId: input.uploadId,
            parts: input.parts,
          });
        }

        await assertObjectExists(input.storageKey, input.contentLength);
        return completeUploadResponseSchema.parse({
          storageKey: input.storageKey,
        });
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Uploaded object could not be verified.",
        });
      }
    }),
});
