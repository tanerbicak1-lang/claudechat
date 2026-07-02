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
import {
  PenSquare, Trash2, Send, Loader2, Terminal, Menu,
  Paperclip, X, FileText, Image, Download, Github, Copy, Check
} from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { GeneratedFile } from "@/types";

const ACCEPTED_TYPES = ".js,.mjs,.ts,.tsx,.jsx,.html,.htm,.css,.scss,.php,.py,.rb,.go,.rs,.java,.kt,.swift,.c,.cpp,.cs,.sh,.sql,.json,.yaml,.yml,.xml,.toml,.env,.txt,.md,.csv,.vue,.svelte,image/jpeg,image/png,image/gif,image/webp,application/pdf";
const MAX_TEXT_FILE_SIZE = 200 * 1024; // 200 KB
const MAX_BINARY_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

const TEXT_EXTS = new Set(["js","mjs","cjs","ts","tsx","jsx","html","htm","css","scss","sass","less","php","py","rb","go","rs","java","kt","swift","c","cpp","h","cs","sh","bash","zsh","sql","json","yaml","yml","xml","toml","env","txt","md","markdown","csv","vue","svelte","astro","conf","config","ini"]);

function getExt(name: string) { return name.split(".").pop()?.toLowerCase() ?? ""; }
function isText(file: File) { return TEXT_EXTS.has(getExt(file.name)) || file.type.startsWith("text/"); }
function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded text-xs"
      title="Kopyala"
    >
      {copied ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
      {copied ? "Kopyalandı" : "Kopyala"}
    </button>
  );
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  return (
    <div className="my-3 rounded-lg border border-border overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted border-b border-border">
        <span className="text-xs font-mono text-muted-foreground">{lang || "kod"}</span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed bg-card m-0 border-0 rounded-none">
        <code className="font-mono text-foreground">{code}</code>
      </pre>
    </div>
  );
}

function TextBlock({ text }: { text: string }) {
  const paragraphs = text.split(/\n\n+/);
  const nodes = paragraphs.map((para, j) => {
    if (!para.trim()) return null;
    if (para.startsWith("# ")) return <h1 key={j}>{para.slice(2)}</h1>;
    if (para.startsWith("## ")) return <h2 key={j}>{para.slice(3)}</h2>;
    if (para.startsWith("### ")) return <h3 key={j}>{para.slice(4)}</h3>;
    const lines = para.split("\n");
    const isUl = lines.every(l => l.startsWith("- ") || l.startsWith("* "));
    const isOl = lines.every(l => /^\d+\. /.test(l));
    if (isUl) return <ul key={j}>{lines.map((l, k) => <li key={k}>{renderInline(l.slice(2))}</li>)}</ul>;
    if (isOl) return <ol key={j}>{lines.map((l, k) => <li key={k}>{renderInline(l.replace(/^\d+\. /, ""))}</li>)}</ol>;
    return (
      <p key={j}>
        {lines.map((line, k) => (
          <span key={k}>{renderInline(line)}{k < lines.length - 1 && <br />}</span>
        ))}
      </p>
    );
  });
  return <div className="prose max-w-none">{nodes}</div>;
}

function MarkdownContent({ content }: { content: string }) {
  const parts = content.split(/(```[\s\S]*?```)/g);
  return (
    <div>
      {parts.map((part, i) => {
        if (part.startsWith("```")) {
          const lines = part.split("\n");
          const lang = lines[0].replace("```", "").trim();
          const code = lines.slice(1, lines[lines.length - 1].trim() === "```" ? -1 : undefined).join("\n");
          return <CodeBlock key={i} lang={lang} code={code} />;
        }
        return part.trim() ? <TextBlock key={i} text={part} /> : null;
      })}
    </div>
  );
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={i}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

function parseMessageContent(raw: string): { text: string; attachment?: { name: string; type: string } } {
  try {
    const parsed = JSON.parse(raw);
    if (parsed.text !== undefined && parsed.attachment) {
      return { text: parsed.text, attachment: parsed.attachment };
    }
  } catch {
    // plain text
  }
  return { text: raw };
}

function AttachmentBadge({ name, type }: { name: string; type: string }) {
  const isImage = type.startsWith("image/");
  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground bg-accent/50 rounded px-2 py-1 mb-1 w-fit">
      {isImage ? <Image className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
      <span className="truncate max-w-[200px]">{name}</span>
    </div>
  );
}

function FileDownloadCard({ file }: { file: GeneratedFile }) {
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
  return (
    <a
      href={`${BASE}${file.downloadUrl}`}
      download={file.name}
      className="flex items-center gap-2 bg-accent/40 hover:bg-accent/70 border border-border rounded px-3 py-2 text-xs transition-colors cursor-pointer no-underline"
    >
      <FileText className="w-3.5 h-3.5 text-primary shrink-0" />
      <span className="font-mono text-foreground flex-1 truncate">{file.name}</span>
      <Download className="w-3 h-3 text-muted-foreground shrink-0" />
    </a>
  );
}

function GitHubPushDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [branch, setBranch] = useState("main");
  const [message, setMessage] = useState("Update from Claude Chat");
  const [status, setStatus] = useState<"idle" | "pushing" | "done" | "error">("idle");
  const [resultMsg, setResultMsg] = useState("");

  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

  const handlePush = async () => {
    setStatus("pushing");
    setResultMsg("");
    try {
      const res = await fetch(`${BASE}/api/github/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch, message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Push başarısız");
      setStatus("done");
      setResultMsg(data.message || "Başarıyla gönderildi!");
    } catch (e: unknown) {
      setStatus("error");
      setResultMsg(e instanceof Error ? e.message : "Bilinmeyen hata");
    }
  };

  const handleClose = () => {
    setStatus("idle");
    setResultMsg("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="bg-card border-card-border text-foreground max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <Github className="w-4 h-4" /> GitHub'a Gönder
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Kod dosyaları push edilir. Konuşmalar, <code className="font-mono">.env</code> ve secrets asla gönderilmez.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Branch</label>
            <input
              className="w-full bg-muted border border-border rounded px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="main"
              value={branch}
              onChange={e => setBranch(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Commit mesajı</label>
            <input
              className="w-full bg-muted border border-border rounded px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              value={message}
              onChange={e => setMessage(e.target.value)}
            />
          </div>
          {status === "done" && (
            <div className="text-xs text-primary bg-primary/10 border border-primary/20 rounded px-2.5 py-2">
              {resultMsg}
            </div>
          )}
          {status === "error" && (
            <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded px-2.5 py-2 font-mono break-all">
              Hata: {resultMsg}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={handleClose} className="text-xs h-7">
            İptal
          </Button>
          <Button
            size="sm"
            onClick={handlePush}
            disabled={status === "pushing"}
            className="text-xs h-7 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {status === "pushing" ? (
              <><Loader2 className="w-3 h-3 animate-spin mr-1" />Gönderiliyor...</>
            ) : (
              <><Github className="w-3 h-3 mr-1" />Push Et</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ChatPage() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const conversationId = params.id ? parseInt(params.id, 10) : undefined;

  const { data: conversations, isLoading: isLoadingConversations } = useListAnthropicConversations();
  const { data: conversation } = useGetAnthropicConversation(
    conversationId!,
    { query: { enabled: !!conversationId, queryKey: getGetAnthropicConversationQueryKey(conversationId!) } }
  );
  const { data: messages, isLoading: isLoadingMessages } = useListAnthropicMessages(
    conversationId!,
    { query: { enabled: !!conversationId } }
  );

  const deleteConversation = useDeleteAnthropicConversation();
  const { isStreaming, streamingContent, streamingFiles, sendMessage } = useChatStream(conversationId);

  const [input, setInput] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [convToDelete, setConvToDelete] = useState<number | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [conversationId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    if (!selected.length) return;
    const errors: string[] = [];
    const valid: File[] = [];
    for (const f of selected) {
      const maxSize = isText(f) ? MAX_TEXT_FILE_SIZE : MAX_BINARY_FILE_SIZE;
      if (f.size > maxSize) {
        errors.push(`"${f.name}" çok büyük (max ${isText(f) ? "200 KB" : "20 MB"})`);
      } else {
        valid.push(f);
      }
    }
    setFileErrors(errors);
    setAttachedFiles(prev => {
      const names = new Set(prev.map(f => f.name));
      return [...prev, ...valid.filter(f => !names.has(f.name))];
    });
    e.target.value = "";
  };

  const removeFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSend = async () => {
    if ((!input.trim() && attachedFiles.length === 0) || isStreaming) return;
    const content = input;
    const files = attachedFiles;
    setInput("");
    setAttachedFiles([]);
    setFileErrors([]);
    const newConvId = await sendMessage(content, files.length > 0 ? files : undefined);
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
      if (conversationId === convToDelete) setLocation("/");
      setConvToDelete(null);
    }
  };

  const canSend = (input.trim().length > 0 || attachedFiles.length > 0) && !isStreaming;

  const SidebarContent = () => (
    <div className="flex flex-col h-full" style={{ background: "hsl(var(--sidebar))" }}>
      <div className="px-3 py-2.5 flex items-center justify-between border-b border-sidebar-border">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-sidebar-foreground">
          <Terminal className="w-3.5 h-3.5 text-primary" />
          <span>Claude Chat</span>
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setGithubOpen(true)}
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            title="GitHub'a gönder"
          >
            <Github className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => { setLocation("/"); setMobileOpen(false); }}
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            data-testid="button-new-chat"
            title="Yeni sohbet"
          >
            <PenSquare className="w-3 h-3" />
          </Button>
        </div>
      </div>
      <div className="px-2 py-1.5">
        <div className="text-xs text-muted-foreground px-1 py-0.5 uppercase tracking-wider" style={{ fontSize: "10px" }}>
          Sohbetler
        </div>
      </div>
      <ScrollArea className="flex-1 px-2">
        <div className="space-y-0.5 pb-4">
          {isLoadingConversations ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
            </div>
          ) : conversations?.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-6 italic">
              Henüz sohbet yok
            </div>
          ) : (
            conversations?.map((conv) => (
              <div
                key={conv.id}
                className={cn(
                  "group flex items-center justify-between px-2 py-1 rounded cursor-pointer transition-colors",
                  conversationId === conv.id
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                )}
                style={{ fontSize: "12px" }}
                onClick={() => { setLocation(`/c/${conv.id}`); setMobileOpen(false); }}
                data-testid={`link-conversation-${conv.id}`}
              >
                <div className="truncate flex-1 pr-1">{conv.title || "Adsız"}</div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                  onClick={(e) => { e.stopPropagation(); setConvToDelete(conv.id); }}
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
      <div className="hidden md:flex w-56 border-r border-border flex-col shrink-0">
        <SidebarContent />
      </div>

      <div className="flex-1 flex flex-col h-full relative w-full min-w-0">
        <div className="md:hidden flex items-center justify-between px-3 py-2 border-b border-border bg-background">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
                <Menu className="w-4 h-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-56 border-r border-border">
              <SidebarContent />
            </SheetContent>
          </Sheet>
          <div className="text-xs font-medium">{conversation?.title || "Claude Chat"}</div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation("/")}
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
          >
            <PenSquare className="w-3.5 h-3.5" />
          </Button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 md:px-6 py-4 pb-36">
          <div className="max-w-4xl mx-auto space-y-4">
            {!conversationId ? (
              <div className="h-[60vh] flex flex-col items-center justify-center text-center space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-700">
                <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center border border-border">
                  <Terminal className="w-5 h-5 text-primary" />
                </div>
                <h1 className="text-base font-semibold text-foreground">Size nasıl yardımcı olabilirim?</h1>
                <p className="text-xs text-muted-foreground">Dosya üretebilir, kod yazabilir, sorularınızı yanıtlayabilirim.</p>
              </div>
            ) : (
              <>
                {isLoadingMessages ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <>
                    {conversation?.title && (
                      <div className="hidden md:block text-center mb-4">
                        <h2 className="text-xs text-muted-foreground font-medium">{conversation.title}</h2>
                      </div>
                    )}
                    {messages?.map((msg) => {
                      const { text, attachment } = parseMessageContent(msg.content);
                      let msgFiles: GeneratedFile[] = [];
                      let displayText = text;
                      try {
                        const meta = JSON.parse(msg.content);
                        if (meta._files) {
                          msgFiles = meta._files;
                          displayText = meta.rawText || "";
                        }
                      } catch { /* plain text */ }

                      return (
                        <div
                          key={msg.id}
                          className={cn(
                            "flex flex-col animate-in fade-in duration-300",
                            msg.role === "user" ? "items-end" : "items-start"
                          )}
                        >
                          {attachment && msg.role === "user" && (
                            <AttachmentBadge name={attachment.name} type={attachment.type} />
                          )}
                          <div
                            className={cn(
                              "max-w-[88%] sm:max-w-[80%]",
                              msg.role === "user"
                                ? "bg-accent text-accent-foreground rounded-lg rounded-tr-sm px-3 py-2 text-xs"
                                : "text-foreground"
                            )}
                          >
                            {msg.role === "assistant" ? (
                              <MarkdownContent content={displayText || msg.content} />
                            ) : (
                              <div className="whitespace-pre-wrap">{text || <span className="text-muted-foreground italic">(sadece dosya)</span>}</div>
                            )}
                          </div>
                          {msgFiles.length > 0 && (
                            <div className="mt-2 space-y-1 w-full max-w-[88%] sm:max-w-[80%]">
                              <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                                <Download className="w-3 h-3" /> Üretilen dosyalar
                              </div>
                              {msgFiles.map((f, i) => (
                                <FileDownloadCard key={i} file={f} />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}

                {isStreaming && (
                  <div className="flex flex-col items-start animate-in fade-in duration-300">
                    <div className="max-w-[88%] sm:max-w-[80%] text-foreground">
                      {streamingContent ? (
                        <MarkdownContent content={streamingContent} />
                      ) : (
                        <div className="flex items-center gap-1 h-5">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "0ms" }} />
                          <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "150ms" }} />
                          <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                      )}
                    </div>
                    {streamingFiles.length > 0 && (
                      <div className="mt-2 space-y-1 w-full max-w-[88%] sm:max-w-[80%]">
                        <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                          <Download className="w-3 h-3" /> Üretilen dosyalar
                        </div>
                        {streamingFiles.map((f, i) => (
                          <FileDownloadCard key={i} file={f} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-background via-background to-transparent pt-8 pb-4 px-4 md:px-6 pointer-events-none">
          <div className="max-w-4xl mx-auto pointer-events-auto">

            {/* Multi-file list */}
            {attachedFiles.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {attachedFiles.map((f, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 bg-card border border-border rounded px-2 py-1 text-xs max-w-[200px]"
                  >
                    {isText(f) ? (
                      <FileText className="w-3 h-3 text-primary shrink-0" />
                    ) : (
                      <Image className="w-3 h-3 text-primary shrink-0" />
                    )}
                    <span className="truncate text-foreground">{f.name}</span>
                    <span className="text-muted-foreground shrink-0">({fmtSize(f.size)})</span>
                    <button
                      onClick={() => removeFile(i)}
                      className="text-muted-foreground hover:text-destructive transition-colors ml-0.5 shrink-0"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* File errors */}
            {fileErrors.length > 0 && (
              <div className="mb-2 space-y-0.5">
                {fileErrors.map((err, i) => (
                  <div key={i} className="text-xs text-destructive">{err}</div>
                ))}
              </div>
            )}

            <div className="relative rounded-lg bg-card border border-card-border shadow-lg focus-within:border-primary/50 transition-all duration-200">
              <Textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Mesajınızı yazın... (Shift+Enter: yeni satır)"
                className="min-h-[52px] max-h-[180px] w-full resize-none border-0 bg-transparent py-3 pl-3 pr-20 focus-visible:ring-0 text-xs placeholder:text-muted-foreground"
                rows={1}
                disabled={isStreaming}
                data-testid="input-message"
              />
              <div className="absolute bottom-2 right-2 flex items-center gap-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_TYPES}
                  onChange={handleFileChange}
                  className="hidden"
                  multiple
                  data-testid="input-file"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className={cn(
                    "h-7 w-7 rounded transition-all",
                    attachedFiles.length > 0
                      ? "text-primary bg-primary/10"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  )}
                  disabled={isStreaming}
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="button-attach"
                  title={`Dosya ekle (JS, HTML, CSS, PY, PHP, JSON, TXT...)\n${attachedFiles.length > 0 ? `${attachedFiles.length} dosya seçili` : ""}`}
                >
                  <Paperclip className="w-3.5 h-3.5" />
                </Button>
                <Button
                  size="icon"
                  className={cn(
                    "h-7 w-7 rounded transition-all",
                    canSend
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : "bg-muted text-muted-foreground opacity-40"
                  )}
                  disabled={!canSend}
                  onClick={handleSend}
                  data-testid="button-send"
                >
                  <Send className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
            <div className="text-center mt-1.5 text-muted-foreground" style={{ fontSize: "10px" }}>
              Claude hata yapabilir. Önemli bilgileri doğrulayın.
            </div>
          </div>
        </div>
      </div>

      <AlertDialog open={!!convToDelete} onOpenChange={(open) => !open && setConvToDelete(null)}>
        <AlertDialogContent className="bg-card border-card-border text-card-foreground max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm font-semibold">Sohbeti sil?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-muted-foreground">
              Bu işlem geri alınamaz. Sohbet kalıcı olarak silinecek.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs h-7 bg-transparent hover:bg-accent border-border">İptal</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="text-xs h-7 bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Sil
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <GitHubPushDialog open={githubOpen} onClose={() => setGithubOpen(false)} />
    </div>
  );
}
