import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListAnthropicMessagesQueryKey,
  getGetAnthropicConversationQueryKey,
  useCreateAnthropicConversation
} from "@workspace/api-client-react";
import type { GeneratedFile } from "@/types";

export function useChatStream(conversationId?: number) {
  const queryClient = useQueryClient();
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingFiles, setStreamingFiles] = useState<GeneratedFile[]>([]);

  const createConversation = useCreateAnthropicConversation();

  const sendMessage = useCallback(async (content: string, files?: File[]) => {
    const hasContent = content.trim().length > 0;
    const hasFiles = files && files.length > 0;
    if ((!hasContent && !hasFiles) || isStreaming) return null;

    let targetConversationId = conversationId;

    if (!targetConversationId) {
      const firstName = files?.[0]?.name ?? "";
      const title =
        content.slice(0, 40) + (content.length > 40 ? "..." : "") ||
        (firstName ? `${firstName} ve diğerleri` : "Yeni sohbet");
      const newConv = await createConversation.mutateAsync({ data: { title } });
      targetConversationId = newConv.id;
    }

    setIsStreaming(true);
    setStreamingContent("");
    setStreamingFiles([]);

    try {
      const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

      const formData = new FormData();
      formData.append("content", content);
      if (files) {
        for (const f of files) {
          formData.append("files", f);
        }
      }

      const response = await fetch(
        `${BASE}/api/anthropic/conversations/${targetConversationId}/messages`,
        { method: "POST", body: formData }
      );

      if (!response.ok) throw new Error("Mesaj gönderilemedi");

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";
      const collectedFiles: GeneratedFile[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const parsed = JSON.parse(line.slice(6));
            if (parsed.content) {
              fullContent += parsed.content;
              setStreamingContent(fullContent);
            }
            if (parsed.file) {
              collectedFiles.push(parsed.file);
              setStreamingFiles([...collectedFiles]);
            }
          } catch {
            // incomplete chunks
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: getListAnthropicMessagesQueryKey(targetConversationId) });
      queryClient.invalidateQueries({ queryKey: getGetAnthropicConversationQueryKey(targetConversationId) });

    } catch (error) {
      console.error("Stream error:", error);
    } finally {
      setIsStreaming(false);
      setStreamingContent("");
    }

    return targetConversationId;
  }, [conversationId, isStreaming, createConversation, queryClient]);

  return { isStreaming, streamingContent, streamingFiles, sendMessage };
}
