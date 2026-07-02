import { useState, useRef, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { 
  getListAnthropicMessagesQueryKey,
  getGetAnthropicConversationQueryKey,
  useCreateAnthropicConversation
} from "@workspace/api-client-react";

export function useChatStream(conversationId?: number) {
  const queryClient = useQueryClient();
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  
  const createConversation = useCreateAnthropicConversation();

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isStreaming) return null;

    let targetConversationId = conversationId;

    if (!targetConversationId) {
      // Create new conversation
      const newConv = await createConversation.mutateAsync({
        data: { title: content.slice(0, 40) + (content.length > 40 ? "..." : "") }
      });
      targetConversationId = newConv.id;
    }

    setIsStreaming(true);
    setStreamingContent("");

    try {
      const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
      const response = await fetch(`${BASE}/api/anthropic/conversations/${targetConversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      if (!response.ok) {
        throw new Error("Failed to send message");
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";

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
            if (parsed.done) {
              // Finish
            }
          } catch (e) {
            // Ignore parse errors for incomplete chunks
          }
        }
      }
      
      // Complete stream
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
    sendMessage
  };
}
