import { useLocation, useParams } from "wouter";
import { useState, useRef, useEffect } from "react";
import { 
  useListAnthropicConversations,
  useGetAnthropicConversation,
  useListAnthropicMessages,
  useDeleteAnthropicConversation,
  getListAnthropicConversationsQueryKey,
  getGetAnthropicConversationQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useChatStream } from "@/hooks/use-chat-stream";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PenSquare, Trash2, Send, MessageSquare, Loader2, Sparkles, Menu } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

// Simple markdown renderer for chat messages
function MarkdownContent({ content }: { content: string }) {
  // A very basic parser for demo purposes.
  // It handles paragraphs, bold, italic, and inline code.
  const paragraphs = content.split(/\n\n+/);
  
  return (
    <div className="prose prose-invert max-w-none">
      {paragraphs.map((para, i) => {
        // Code blocks
        if (para.startsWith("```")) {
          const lines = para.split("\n");
          const lang = lines[0].slice(3).trim();
          const code = lines.slice(1, -1).join("\n");
          return (
            <pre key={i}>
              <code>{code}</code>
            </pre>
          );
        }
        
        // Split by lines for <br/>
        const lines = para.split("\n");
        return (
          <p key={i}>
            {lines.map((line, j) => (
              <span key={j}>
                {line}
                {j < lines.length - 1 && <br />}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

export default function ChatPage() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const conversationId = params.id ? parseInt(params.id, 10) : undefined;

  const { data: conversations, isLoading: isLoadingConversations } = useListAnthropicConversations();
  
  // Use all provided hooks
  const { data: conversation } = useGetAnthropicConversation(
    conversationId!,
    { query: { enabled: !!conversationId, queryKey: getGetAnthropicConversationQueryKey(conversationId!) } }
  );

  const { data: messages, isLoading: isLoadingMessages } = useListAnthropicMessages(
    conversationId!, 
    { query: { enabled: !!conversationId } }
  );

  const deleteConversation = useDeleteAnthropicConversation();
  const { isStreaming, streamingContent, sendMessage } = useChatStream(conversationId);

  const [input, setInput] = useState("");
  const [convToDelete, setConvToDelete] = useState<number | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when messages or streaming content changes
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

  // Focus input on load
  useEffect(() => {
    inputRef.current?.focus();
  }, [conversationId]);

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;
    
    const content = input;
    setInput("");
    
    const newConvId = await sendMessage(content);
    if (newConvId && newConvId !== conversationId) {
      queryClient.invalidateQueries({ queryKey: getListAnthropicConversationsQueryKey() });
      setLocation(`/c/${newConvId}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleDeleteConfirm = async () => {
    if (convToDelete) {
      await deleteConversation.mutateAsync({ id: convToDelete });
      queryClient.invalidateQueries({ queryKey: getListAnthropicConversationsQueryKey() });
      if (conversationId === convToDelete) {
        setLocation("/");
      }
      setConvToDelete(null);
    }
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-sidebar">
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-2 font-serif text-lg tracking-tight">
          <Sparkles className="w-4 h-4 text-primary" />
          <span>Assistant</span>
        </div>
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => {
            setLocation("/");
            setMobileOpen(false);
          }}
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          data-testid="button-new-chat"
        >
          <PenSquare className="w-4 h-4" />
        </Button>
      </div>
      
      <ScrollArea className="flex-1 px-3">
        <div className="space-y-1 pb-4">
          {isLoadingConversations ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : conversations?.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8 font-serif italic">
              No conversations yet
            </div>
          ) : (
            conversations?.map((conv) => (
              <div 
                key={conv.id}
                className={cn(
                  "group flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors text-sm",
                  conversationId === conv.id 
                    ? "bg-accent text-accent-foreground" 
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                )}
                onClick={() => {
                  setLocation(`/c/${conv.id}`);
                  setMobileOpen(false);
                }}
                data-testid={`link-conversation-${conv.id}`}
              >
                <div className="truncate flex-1 pr-2">
                  {conv.title || "Untitled"}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConvToDelete(conv.id);
                  }}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );

  return (
    <div className="flex h-[100dvh] bg-background overflow-hidden text-foreground">
      
      {/* Desktop Sidebar */}
      <div className="hidden md:flex w-64 border-r border-border flex-col">
        <SidebarContent />
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col h-full relative w-full">
        {/* Mobile Header */}
        <div className="md:hidden flex items-center justify-between p-4 border-b border-border bg-background">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden h-8 w-8 text-muted-foreground hover:text-foreground">
                <Menu className="w-5 h-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-64 border-r border-border">
              <SidebarContent />
            </SheetContent>
          </Sheet>
          <div className="font-serif text-lg tracking-tight">
            {conversation?.title || "Assistant"}
          </div>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setLocation("/")}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            <PenSquare className="w-4 h-4" />
          </Button>
        </div>

        <div 
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 md:px-8 py-6 pb-32"
        >
          <div className="max-w-3xl mx-auto space-y-8">
            {!conversationId ? (
              <div className="h-[60vh] flex flex-col items-center justify-center text-center space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-1000">
                <div className="w-12 h-12 rounded-full bg-accent flex items-center justify-center mb-4 border border-border">
                  <Sparkles className="w-6 h-6 text-primary" />
                </div>
                <h1 className="text-3xl font-serif tracking-tight text-foreground">How can I help you today?</h1>
                <p className="text-muted-foreground font-serif italic">A clear, focused space for thinking.</p>
              </div>
            ) : (
              <>
                <div className="hidden md:block text-center mb-8">
                  <h2 className="text-lg font-serif text-muted-foreground">{conversation?.title}</h2>
                </div>
                {messages?.map((msg) => (
                  <div 
                    key={msg.id} 
                    className={cn(
                      "flex flex-col animate-in fade-in duration-500",
                      msg.role === "user" ? "items-end" : "items-start"
                    )}
                  >
                    <div 
                      className={cn(
                        "px-5 py-3.5 max-w-[85%] sm:max-w-[75%]",
                        msg.role === "user" 
                          ? "bg-accent text-accent-foreground rounded-2xl rounded-tr-sm" 
                          : "text-foreground font-serif leading-relaxed text-lg"
                      )}
                    >
                      {msg.role === "assistant" ? (
                        <MarkdownContent content={msg.content} />
                      ) : (
                        <div className="whitespace-pre-wrap">{msg.content}</div>
                      )}
                    </div>
                  </div>
                ))}
                
                {isStreaming && (
                  <div className="flex flex-col items-start animate-in fade-in duration-300">
                    <div className="py-3.5 max-w-[85%] sm:max-w-[75%] text-foreground font-serif leading-relaxed text-lg">
                      {streamingContent ? (
                        <MarkdownContent content={streamingContent} />
                      ) : (
                        <div className="flex items-center gap-1 h-6">
                          <span className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "0ms" }} />
                          <span className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "150ms" }} />
                          <span className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Input Area */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-background via-background to-transparent pt-12 pb-6 px-4 md:px-8 pointer-events-none">
          <div className="max-w-3xl mx-auto relative group pointer-events-auto">
            <div className="relative rounded-2xl bg-card border border-card-border shadow-lg shadow-black/20 focus-within:ring-1 focus-within:ring-primary/30 transition-all duration-300">
              <Textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Message Assistant..."
                className="min-h-[60px] max-h-[200px] w-full resize-none border-0 bg-transparent py-4 pl-4 pr-12 focus-visible:ring-0 text-base placeholder:text-muted-foreground"
                rows={1}
                disabled={isStreaming}
                data-testid="input-message"
              />
              <Button
                size="icon"
                className={cn(
                  "absolute bottom-3 right-3 h-8 w-8 rounded-xl transition-all duration-300",
                  input.trim() && !isStreaming 
                    ? "bg-primary text-primary-foreground opacity-100 hover:bg-primary/90" 
                    : "bg-muted text-muted-foreground opacity-50"
                )}
                disabled={!input.trim() || isStreaming}
                onClick={handleSend}
                data-testid="button-send"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
            <div className="text-center mt-2 text-xs text-muted-foreground font-serif italic">
              Assistant can make mistakes. Consider verifying important information.
            </div>
          </div>
        </div>
      </div>

      <AlertDialog open={!!convToDelete} onOpenChange={(open) => !open && setConvToDelete(null)}>
        <AlertDialogContent className="bg-card border-card-border text-card-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif text-xl">Delete conversation?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              This action cannot be undone. This will permanently delete your conversation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-transparent hover:bg-accent hover:text-accent-foreground border-border">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
