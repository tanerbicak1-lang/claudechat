import { Router, type IRouter } from "express";
import multer from "multer";
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

type MessageContentBlock = TextBlockParam | ImageBlockParam | DocumentBlockParam;

function buildContentBlocks(text: string, file?: Express.Multer.File): MessageContentBlock[] {
  const blocks: MessageContentBlock[] = [];

  if (file) {
    const base64 = file.buffer.toString("base64");
    const mime = file.mimetype;

    if (mime.startsWith("image/")) {
      const mediaType = mime as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: mediaType, data: base64 },
      });
    } else if (mime === "application/pdf") {
      blocks.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: base64 },
      });
    }
  }

  if (text) {
    blocks.push({ type: "text", text });
  }

  return blocks;
}

function serializeContent(text: string, file?: Express.Multer.File): string {
  if (!file) return text;
  return JSON.stringify({
    text,
    attachment: { name: file.originalname, type: file.mimetype },
  });
}

function deserializeContentBlocks(raw: string): MessageContentBlock[] {
  try {
    const parsed = JSON.parse(raw);
    if (parsed.text !== undefined && parsed.attachment) {
      return [{ type: "text", text: parsed.text + `\n[Attached file: ${parsed.attachment.name}]` }];
    }
  } catch {
    // plain text
  }
  return [{ type: "text", text: raw }];
}

router.get("/anthropic/conversations", async (_req, res): Promise<void> => {
  const convos = await db
    .select()
    .from(conversations)
    .orderBy(conversations.createdAt);
  res.json(convos);
});

router.post("/anthropic/conversations", async (req, res): Promise<void> => {
  const parsed = CreateAnthropicConversationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [convo] = await db
    .insert(conversations)
    .values({ title: parsed.data.title })
    .returning();
  res.status(201).json(convo);
});

router.get("/anthropic/conversations/:id", async (req, res): Promise<void> => {
  const params = GetAnthropicConversationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [convo] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, params.data.id));
  if (!convo) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, params.data.id))
    .orderBy(messages.createdAt);
  res.json({ ...convo, messages: msgs });
});

router.delete("/anthropic/conversations/:id", async (req, res): Promise<void> => {
  const params = DeleteAnthropicConversationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db
    .delete(conversations)
    .where(eq(conversations.id, params.data.id))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/anthropic/conversations/:id/messages", async (req, res): Promise<void> => {
  const params = ListAnthropicMessagesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, params.data.id))
    .orderBy(messages.createdAt);
  res.json(msgs);
});

router.post(
  "/anthropic/conversations/:id/messages",
  upload.single("file"),
  async (req, res): Promise<void> => {
    const params = SendAnthropicMessageParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const text: string = req.body?.content ?? "";
    const file = req.file;

    if (!text && !file) {
      res.status(400).json({ error: "content or file is required" });
      return;
    }

    const [convo] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, params.data.id));
    if (!convo) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

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
        return {
          role: "user" as const,
          content: buildContentBlocks(text, file),
        };
      }
      return {
        role: m.role as "user" | "assistant",
        content: deserializeContentBlocks(m.content),
      };
    });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let fullResponse = "";

    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: chatMessages,
    });

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        fullResponse += event.delta.text;
        res.write(`data: ${JSON.stringify({ content: event.delta.text })}\n\n`);
      }
    }

    await db.insert(messages).values({
      conversationId: params.data.id,
      role: "assistant",
      content: fullResponse,
    });

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  }
);

export default router;
