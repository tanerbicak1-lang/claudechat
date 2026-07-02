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
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

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

İstenirse birden fazla kod bloğu üretebilirsin. Açıklama metnini kod bloklarının dışında yaz.
Belirli bir dosya adı vermek istersen şu formatı kullanabilirsin:

<file name="dosyaadi.uzanti">
içerik
</file>
`;

function buildContentBlocks(text: string, file?: Express.Multer.File): MessageContentBlock[] {
  const blocks: MessageContentBlock[] = [];
  if (file) {
    const base64 = file.buffer.toString("base64");
    const mime = file.mimetype;
    if (mime.startsWith("image/")) {
      const mediaType = mime as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
      blocks.push({ type: "image", source: { type: "base64", media_type: mediaType, data: base64 } });
    } else if (mime === "application/pdf") {
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } });
    }
  }
  if (text) blocks.push({ type: "text", text });
  return blocks;
}

function serializeContent(text: string, file?: Express.Multer.File): string {
  if (!file) return text;
  return JSON.stringify({ text, attachment: { name: file.originalname, type: file.mimetype } });
}

function deserializeContentBlocks(raw: string): MessageContentBlock[] {
  try {
    const parsed = JSON.parse(raw);
    if (parsed.text !== undefined && parsed.attachment) {
      return [{ type: "text", text: parsed.text + `\n[Attached file: ${parsed.attachment.name}]` }];
    }
    if (parsed._files) {
      return [{ type: "text", text: parsed.rawText || "" }];
    }
  } catch {
    // plain text
  }
  return [{ type: "text", text: raw }];
}

interface SavedFile {
  name: string;
  downloadUrl: string;
  size: number;
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

function saveFile(name: string, content: string): SavedFile {
  const safeBase = name.replace(/[^a-zA-Z0-9._\-]/g, "_");
  const timestamp = Date.now();
  const safeFileName = `${timestamp}_${safeBase}`;
  fs.writeFileSync(path.join(FILES_DIR, safeFileName), content, "utf8");
  return {
    name,
    downloadUrl: `/api/files/${safeFileName}`,
    size: Buffer.byteLength(content, "utf8"),
  };
}

function extractAndSaveFiles(response: string): { cleanText: string; savedFiles: SavedFile[] } {
  const savedFiles: SavedFile[] = [];

  // 1. Named <file> tags
  const fileTagPattern = /<file\s+name="([^"]+)">([\s\S]*?)<\/file>/g;
  let match: RegExpExecArray | null;
  const taggedFileNames = new Set<string>();
  while ((match = fileTagPattern.exec(response)) !== null) {
    const fileName = match[1].replace(/[^a-zA-Z0-9._\-]/g, "_");
    const content = match[2].replace(/^\n/, "").replace(/\n$/, "");
    savedFiles.push(saveFile(fileName, content));
    taggedFileNames.add(match[0]);
  }

  // Remove file tags from text
  let cleanText = response.replace(/<file\s+name="[^"]+">[\s\S]*?<\/file>/g, "").trim();

  // 2. Auto-extract code blocks (```lang ... ```)
  const codeBlockPattern = /```(\w*)\n([\s\S]*?)```/g;
  let blockIndex = 0;
  while ((match = codeBlockPattern.exec(cleanText)) !== null) {
    const lang = match[1].trim();
    const code = match[2];
    if (!code.trim()) continue;
    const ext = langToExt(lang || "txt");
    const fileName = `output_${Date.now() + blockIndex}.${ext}`;
    savedFiles.push(saveFile(fileName, code));
    blockIndex++;
  }

  return { cleanText, savedFiles };
}

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
  upload.single("file"),
  async (req, res): Promise<void> => {
    const params = SendAnthropicMessageParams.safeParse(req.params);
    if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

    const text: string = req.body?.content ?? "";
    const file = req.file;

    if (!text && !file) { res.status(400).json({ error: "content or file is required" }); return; }

    const [convo] = await db.select().from(conversations).where(eq(conversations.id, params.data.id));
    if (!convo) { res.status(404).json({ error: "Conversation not found" }); return; }

    await db.insert(messages).values({
      conversationId: params.data.id,
      role: "user",
      content: serializeContent(text, file),
    });

    const history = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, params.data.id))
      .orderBy(messages.createdAt);

    const chatMessages = history.map((m, idx) => {
      const isLast = idx === history.length - 1;
      if (isLast && m.role === "user" && file) {
        return { role: "user" as const, content: buildContentBlocks(text, file) };
      }
      return { role: m.role as "user" | "assistant", content: deserializeContentBlocks(m.content) };
    });

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
