import { Router, type IRouter } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { eq } from "drizzle-orm";
import { db, conversations, messages } from "@workspace/db";
import {
  CreateAnthropicConversationBody,
  GetAnthropicConversationParams,
  DeleteAnthropicConversationParams,
  ListAnthropicMessagesParams,
  SendAnthropicMessageParams,
} from "@workspace/api-zod";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import type { ImageBlockParam, TextBlockParam, DocumentBlockParam } from "@anthropic-ai/sdk/resources/messages";

const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB per file
});

const FILES_DIR = path.join(process.cwd(), "generated-files");
if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });

type MessageContentBlock = TextBlockParam | ImageBlockParam | DocumentBlockParam;

const SYSTEM_PROMPT = `Sen yardımcı bir AI asistanısın. Türkçe yanıt ver.

Kod veya dosya üretirken markdown kod bloklarını kullan:

\`\`\`html
<html>...</html>
\`\`\`

\`\`\`python
print("merhaba")
\`\`\`

Birden fazla kod bloğu üretebilirsin. Açıklama metnini kod bloklarının dışında yaz.
Belirli bir dosya adı vermek istersen şu formatı kullanabilirsin:

<file name="dosyaadi.uzanti">
içerik
</file>
`;

// Text-based file extensions that should be injected as text into the message
const TEXT_EXTENSIONS = new Set([
  "js", "mjs", "cjs", "ts", "tsx", "jsx",
  "html", "htm", "css", "scss", "sass", "less",
  "php", "py", "rb", "go", "rs", "java", "kt", "swift",
  "c", "cpp", "h", "cs", "sh", "bash", "zsh",
  "sql", "json", "yaml", "yml", "xml", "toml",
  "env", "txt", "md", "markdown", "csv",
  "vue", "svelte", "astro", "conf", "config", "ini",
]);

const MAX_TEXT_FILE_SIZE = 200 * 1024; // 200 KB per text file

function getExtension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

function isTextFile(file: Express.Multer.File): boolean {
  const ext = getExtension(file.originalname);
  if (TEXT_EXTENSIONS.has(ext)) return true;
  if (file.mimetype.startsWith("text/")) return true;
  return false;
}

function buildMultiFileContent(
  text: string,
  textFiles: Array<{ name: string; content: string }>,
  binaryFiles: Array<Express.Multer.File>
): { messageText: string; contentBlocks: MessageContentBlock[] } {
  // Build the user message text with injected file contents
  let messageText = text;

  if (textFiles.length > 0) {
    messageText += "\n\n";
    textFiles.forEach((f, i) => {
      messageText += `DOSYA ${i + 1} - ${f.name}:\n\`\`\`\n${f.content}\n\`\`\`\n\n`;
    });
  }

  // Build content blocks for Claude API
  const blocks: MessageContentBlock[] = [];

  // Add binary files first (images / PDFs)
  for (const f of binaryFiles) {
    const base64 = f.buffer.toString("base64");
    if (f.mimetype.startsWith("image/")) {
      const mediaType = f.mimetype as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
      blocks.push({ type: "image", source: { type: "base64", media_type: mediaType, data: base64 } });
    } else if (f.mimetype === "application/pdf") {
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } });
    }
  }

  // Text goes last
  if (messageText.trim()) {
    blocks.push({ type: "text", text: messageText });
  }

  return { messageText, contentBlocks: blocks };
}

function serializeUserMessage(text: string, files: Express.Multer.File[]): string {
  if (files.length === 0) return text;
  const fileList = files.map(f => ({ name: f.originalname, type: f.mimetype, isText: isTextFile(f) }));
  return JSON.stringify({ text, attachments: fileList });
}

function deserializeContentBlocks(raw: string): MessageContentBlock[] {
  try {
    const parsed = JSON.parse(raw);
    if (parsed._files) {
      return [{ type: "text", text: parsed.rawText || "" }];
    }
    if (parsed.text !== undefined && parsed.attachment) {
      return [{ type: "text", text: parsed.text + `\n[Attached: ${parsed.attachment.name}]` }];
    }
    if (parsed.text !== undefined && parsed.attachments) {
      const names = parsed.attachments.map((a: { name: string }) => a.name).join(", ");
      return [{ type: "text", text: parsed.text + `\n[Attached files: ${names}]` }];
    }
  } catch {
    // plain text
  }
  return [{ type: "text", text: raw }];
}

const LANG_TO_EXT: Record<string, string> = {
  html: "html", css: "css", javascript: "js", js: "js",
  typescript: "ts", ts: "ts", tsx: "tsx", jsx: "jsx",
  python: "py", py: "py", php: "php", ruby: "rb",
  java: "java", kotlin: "kt", swift: "swift", go: "go",
  rust: "rs", c: "c", cpp: "cpp", "c++": "cpp",
  csharp: "cs", "c#": "cs", shell: "sh", bash: "sh",
  sh: "sh", sql: "sql", json: "json", yaml: "yaml",
  yml: "yml", xml: "xml", markdown: "md", md: "md",
  dockerfile: "Dockerfile", toml: "toml", env: "env",
};

function langToExt(lang: string): string {
  return LANG_TO_EXT[lang.toLowerCase()] || "txt";
}

interface SavedFile { name: string; downloadUrl: string; size: number; }

function saveFile(name: string, content: string): SavedFile {
  const safeBase = name.replace(/[^a-zA-Z0-9._\-]/g, "_");
  const safeFileName = `${Date.now()}_${safeBase}`;
  fs.writeFileSync(path.join(FILES_DIR, safeFileName), content, "utf8");
  return { name, downloadUrl: `/api/files/${safeFileName}`, size: Buffer.byteLength(content, "utf8") };
}

function extractAndSaveFiles(response: string): { cleanText: string; savedFiles: SavedFile[] } {
  const savedFiles: SavedFile[] = [];

  // 1. Named <file> tags
  const fileTagPattern = /<file\s+name="([^"]+)">([\s\S]*?)<\/file>/g;
  let match: RegExpExecArray | null;
  while ((match = fileTagPattern.exec(response)) !== null) {
    const fileName = match[1].replace(/[^a-zA-Z0-9._\-]/g, "_");
    const content = match[2].replace(/^\n/, "").replace(/\n$/, "");
    savedFiles.push(saveFile(fileName, content));
  }

  let cleanText = response.replace(/<file\s+name="[^"]+">[\s\S]*?<\/file>/g, "").trim();

  // 2. Auto-extract markdown code blocks
  const codeBlockPattern = /```(\w*)\n([\s\S]*?)```/g;
  let blockIndex = 0;
  while ((match = codeBlockPattern.exec(cleanText)) !== null) {
    const lang = match[1].trim();
    const code = match[2];
    if (!code.trim()) continue;
    const ext = langToExt(lang || "txt");
    savedFiles.push(saveFile(`output_${Date.now() + blockIndex}.${ext}`, code));
    blockIndex++;
  }

  return { cleanText, savedFiles };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

router.get("/anthropic/conversations", async (_req, res): Promise<void> => {
  const convos = await db.select().from(conversations).orderBy(conversations.createdAt);
  res.json(convos);
});

router.post("/anthropic/conversations", async (req, res): Promise<void> => {
  const parsed = CreateAnthropicConversationBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [convo] = await db.insert(conversations).values({ title: parsed.data.title }).returning();
  res.status(201).json(convo);
});

router.get("/anthropic/conversations/:id", async (req, res): Promise<void> => {
  const params = GetAnthropicConversationParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [convo] = await db.select().from(conversations).where(eq(conversations.id, params.data.id));
  if (!convo) { res.status(404).json({ error: "Conversation not found" }); return; }
  const msgs = await db.select().from(messages).where(eq(messages.conversationId, params.data.id)).orderBy(messages.createdAt);
  res.json({ ...convo, messages: msgs });
});

router.delete("/anthropic/conversations/:id", async (req, res): Promise<void> => {
  const params = DeleteAnthropicConversationParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [deleted] = await db.delete(conversations).where(eq(conversations.id, params.data.id)).returning();
  if (!deleted) { res.status(404).json({ error: "Conversation not found" }); return; }
  res.sendStatus(204);
});

router.get("/anthropic/conversations/:id/messages", async (req, res): Promise<void> => {
  const params = ListAnthropicMessagesParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const msgs = await db.select().from(messages).where(eq(messages.conversationId, params.data.id)).orderBy(messages.createdAt);
  res.json(msgs);
});

router.post(
  "/anthropic/conversations/:id/messages",
  upload.array("files", 20),
  async (req, res): Promise<void> => {
    const params = SendAnthropicMessageParams.safeParse(req.params);
    if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

    const text: string = req.body?.content ?? "";
    const uploadedFiles = (req.files as Express.Multer.File[]) ?? [];

    if (!text && uploadedFiles.length === 0) {
      res.status(400).json({ error: "İçerik veya dosya gereklidir" });
      return;
    }

    // Validate file sizes
    for (const f of uploadedFiles) {
      if (isTextFile(f) && f.size > MAX_TEXT_FILE_SIZE) {
        res.status(400).json({ error: `"${f.originalname}" çok büyük (max 200 KB metin dosyası için)` });
        return;
      }
    }

    const [convo] = await db.select().from(conversations).where(eq(conversations.id, params.data.id));
    if (!convo) { res.status(404).json({ error: "Conversation not found" }); return; }

    // Split files into text and binary
    const textFiles: Array<{ name: string; content: string }> = [];
    const binaryFiles: Array<Express.Multer.File> = [];

    for (const f of uploadedFiles) {
      if (isTextFile(f)) {
        textFiles.push({ name: f.originalname, content: f.buffer.toString("utf8") });
      } else {
        binaryFiles.push(f);
      }
    }

    // Save user message
    await db.insert(messages).values({
      conversationId: params.data.id,
      role: "user",
      content: serializeUserMessage(text, uploadedFiles),
    });

    // Build full message history for Claude
    const history = await db
      .select().from(messages)
      .where(eq(messages.conversationId, params.data.id))
      .orderBy(messages.createdAt);

    const chatMessages = history.map((m, idx) => {
      const isLast = idx === history.length - 1;
      if (isLast && m.role === "user") {
        const { contentBlocks } = buildMultiFileContent(text, textFiles, binaryFiles);
        return { role: "user" as const, content: contentBlocks };
      }
      return { role: m.role as "user" | "assistant", content: deserializeContentBlocks(m.content) };
    });

    // Stream response
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let fullResponse = "";

    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: chatMessages,
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        fullResponse += event.delta.text;
        res.write(`data: ${JSON.stringify({ content: event.delta.text })}\n\n`);
      }
    }

    const { cleanText, savedFiles } = extractAndSaveFiles(fullResponse);

    for (const f of savedFiles) {
      res.write(`data: ${JSON.stringify({ file: f })}\n\n`);
    }

    const storedContent = savedFiles.length > 0
      ? JSON.stringify({ rawText: cleanText, _files: savedFiles })
      : fullResponse;

    await db.insert(messages).values({
      conversationId: params.data.id,
      role: "assistant",
      content: storedContent,
    });

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  }
);

export default router;
