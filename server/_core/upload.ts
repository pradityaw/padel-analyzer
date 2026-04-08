import multer from "multer";
import path from "path";
import { randomBytes } from "crypto";

export function createUploadHandler(uploadsDir: string) {
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ".mp4";
      const name = `upload_${Date.now()}_${randomBytes(8).toString("hex")}${ext}`;
      cb(null, name);
    },
  });

  return multer({
    storage,
    limits: { fileSize: 500 * 1024 * 1024 },
  });
}
