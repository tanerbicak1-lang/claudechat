import { Router, type IRouter } from "express";
import { execSync } from "child_process";
import path from "path";
import fs from "fs";

const router: IRouter = Router();

const EXCLUDED_PATTERNS = [
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  "generated-files",
  "node_modules",
  ".git",
  ".cache",
  ".local",
  "pnpm-lock.yaml",
  "attached_assets",
  ".agents",
];

function isExcluded(filePath: string): boolean {
  return EXCLUDED_PATTERNS.some(
    (pat) => filePath.includes(pat) || path.basename(filePath) === pat
  );
}

router.post("/github/push", async (req, res): Promise<void> => {
  const { repo, branch = "main", message = "Update from Claude Chat", pat } = req.body;

  if (!repo || !pat) {
    res.status(400).json({ error: "repo ve pat zorunludur" });
    return;
  }

  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) {
    res.status(400).json({ error: "Geçersiz repo formatı. Örnek: kullanici/repo" });
    return;
  }

  const workDir = process.cwd();
  const gitignorePath = path.join(workDir, ".gitignore");

  let gitignoreContent = "";
  if (fs.existsSync(gitignorePath)) {
    gitignoreContent = fs.readFileSync(gitignorePath, "utf8");
  }

  const extraIgnores = [
    "generated-files/",
    ".agents/",
    ".local/",
    "attached_assets/",
  ];
  const linesToAdd = extraIgnores.filter((l) => !gitignoreContent.includes(l));
  if (linesToAdd.length > 0) {
    fs.appendFileSync(gitignorePath, "\n" + linesToAdd.join("\n") + "\n");
  }

  try {
    const remoteUrl = `https://${pat}@github.com/${repo}.git`;

    const gitCmd = (cmd: string) =>
      execSync(cmd, {
        cwd: workDir,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        stdio: "pipe",
      }).toString().trim();

    try {
      gitCmd("git config user.email 'claude-chat@replit.app'");
      gitCmd("git config user.name 'Claude Chat'");
    } catch {
      // ignore config errors
    }

    try {
      gitCmd(`git remote set-url origin ${remoteUrl}`);
    } catch {
      gitCmd(`git remote add origin ${remoteUrl}`);
    }

    gitCmd("git add .");

    let hasChanges = true;
    try {
      gitCmd("git diff --cached --quiet");
      hasChanges = false;
    } catch {
      hasChanges = true;
    }

    if (!hasChanges) {
      res.json({ success: true, message: "Gönderilecek değişiklik yok (zaten güncel)" });
      return;
    }

    gitCmd(`git commit -m "${message.replace(/"/g, "'")}"`);

    try {
      gitCmd(`git push origin HEAD:${branch}`);
    } catch {
      gitCmd(`git push --set-upstream origin HEAD:${branch}`);
    }

    res.json({ success: true, message: `Başarıyla ${repo}:${branch} dalına gönderildi` });
  } catch (err: unknown) {
    const errStr = err instanceof Error ? err.message : String(err);
    const safeErr = errStr.replace(pat, "***").replace(pat, "***");
    res.status(500).json({ error: safeErr.slice(0, 300) });
  }
});

export default router;
