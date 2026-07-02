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

  const sendMessage = useCallback(async (content: string, file?: File) => {
    if ((!content.trim() && !file) || isStreaming) return null;

    let targetConversationId = conversationId;

    if (!targetConversationId) {
      const title = content.slice(0, 40) + (content.length > 40 ? "..." : "") || (file ? file.name : "Yeni sohbet");
      const newConv = await createConversation.mutateAsync({
        data: { title }
      });
      targetConversationId = newConv.id;
    }

    setIsStreaming(true);
    setStreamingContent("");
    setStreamingFiles([]);

    try {
      const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

      let body: FormData | string;
      let headers: Record<string, string> = {};

      if (file) {
        const formData = new FormData();
        formData.append("content", content);
        formData.append("file", file);
        body = formData;
      } else {
        body = JSON.stringify({ content });
        headers["Content-Type"] = "application/json";
      }

      const response = await fetch(
        `${BASE}/api/anthropic/conversations/${targetConversationId}/messages`,
        { method: "POST", headers, body }
      );

      if (!response.ok) {
        throw new Error("Mesaj gönderilemedi");
      }

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

  return {
    isStreaming,
    streamingContent,
    streamingFiles,
    sendMessage
  };
}
