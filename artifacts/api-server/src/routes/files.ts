import { Router, type IRouter } from "express";
import path from "path";
import fs from "fs";

const router: IRouter = Router();

const FILES_DIR = path.join(process.cwd(), "generated-files");

router.get("/files/:filename", (req, res): void => {
  const filename = req.params.filename;
  const safeFilename = path.basename(filename);
  const filePath = path.join(FILES_DIR, safeFilename);

  if (!filePath.startsWith(FILES_DIR) || !fs.existsSync(filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const originalName = safeFilename.replace(/^\d+_/, "");
  res.setHeader("Content-Disposition", `attachment; filename="${originalName}"`);
  res.setHeader("Content-Type", "application/octet-stream");
  res.sendFile(filePath);
});

export default router;
