import { Router, type IRouter } from "express";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const router: IRouter = Router();

const EXTRA_IGNORES = [
  "generated-files/",
  ".agents/",
  ".local/",
  "attached_assets/",
];

router.post("/github/push", async (req, res): Promise<void> => {
  const GITHUB_PAT = process.env.GITHUB_PAT;
  const GITHUB_REPO = process.env.GITHUB_REPO;

  if (!GITHUB_PAT || !GITHUB_REPO) {
    res.status(500).json({ error: "GITHUB_PAT veya GITHUB_REPO secret'ı eksik. Replit Secrets panelinden ekleyin." });
    return;
  }

  const { branch = "main", message = "Update from Claude Chat" } = req.body ?? {};

  if (!/^[a-zA-Z0-9_.\-\/]+$/.test(GITHUB_REPO)) {
    res.status(400).json({ error: "Geçersiz GITHUB_REPO formatı. Örnek: kullanici/repo" });
    return;
  }

  const workDir = process.cwd();
  const gitignorePath = path.join(workDir, ".gitignore");

  if (fs.existsSync(gitignorePath)) {
    const current = fs.readFileSync(gitignorePath, "utf8");
    const toAdd = EXTRA_IGNORES.filter((l) => !current.includes(l));
    if (toAdd.length > 0) {
      fs.appendFileSync(gitignorePath, "\n" + toAdd.join("\n") + "\n");
    }
  }

  const remoteUrl = `https://${GITHUB_PAT}@github.com/${GITHUB_REPO}.git`;

  const git = (cmd: string) =>
    execSync(cmd, {
      cwd: workDir,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      stdio: "pipe",
    }).toString().trim();

  try {
    try { git("git config user.email 'claude-chat@replit.app'"); } catch { /* ignore */ }
    try { git("git config user.name 'Claude Chat'"); } catch { /* ignore */ }

    try {
      git(`git remote set-url origin ${remoteUrl}`);
    } catch {
      git(`git remote add origin ${remoteUrl}`);
    }

    git("git add .");

    let hasChanges = true;
    try { git("git diff --cached --quiet"); hasChanges = false; } catch { hasChanges = true; }

    if (!hasChanges) {
      res.json({ success: true, message: "Gönderilecek değişiklik yok — zaten güncel." });
      return;
    }

    git(`git commit -m "${message.replace(/"/g, "'")}"`);

    try {
      git(`git push origin HEAD:${branch}`);
    } catch {
      git(`git push --set-upstream origin HEAD:${branch}`);
    }

    res.json({ success: true, message: `✓ ${GITHUB_REPO}:${branch} dalına başarıyla gönderildi.` });
  } catch (err: unknown) {
    const raw = err instanceof Error ? err.message : String(err);
    const safe = raw.replace(new RegExp(GITHUB_PAT, "g"), "***");
    res.status(500).json({ error: safe.slice(0, 400) });
  }
});

export default router;
