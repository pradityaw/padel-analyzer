import multer from "multer";
import path from "path";
import { randomBytes } from "crypto";
import { MAX_UPLOAD_BYTES } from "../../shared/config.js";
import type { AuthedRequest } from "../lib/httpAuth.js";
import { ownedUploadPrefix } from "../lib/uploadAccess.js";

export function createUploadHandler(uploadsDir: string) {
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || ".mp4";
      const userId = (req as AuthedRequest).authUser?.id;
      const prefix = userId != null ? ownedUploadPrefix(userId) : "";
      const name = `${prefix}upload_${Date.now()}_${randomBytes(8).toString("hex")}${ext}`;
      cb(null, name);
    },
  });

  return multer({
    storage,
    limits: { fileSize: MAX_UPLOAD_BYTES },
  });
}
