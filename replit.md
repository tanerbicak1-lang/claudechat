# Claude Chat

Claude API üzerinden çalışan, Replit tarzı arayüze sahip sohbet uygulaması. Dosya üretimi ve GitHub push desteği içerir.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API sunucusunu çalıştır (port 5000)
- `pnpm run typecheck` — Tüm paketlerde typecheck
- `pnpm run build` — Typecheck + build
- `pnpm --filter @workspace/api-spec run codegen` — OpenAPI spec'ten API hook ve Zod şeması üret
- `pnpm --filter @workspace/db run push` — DB şema değişikliklerini uygula (sadece dev)
- Required env: `DATABASE_URL` — Postgres bağlantı dizisi, `ANTHROPIC_API_KEY` — Claude API anahtarı

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Frontend: React + Vite + Tailwind CSS v4
- AI: Anthropic Claude (claude-sonnet-4-6, streaming)

## Where things live

- `artifacts/claude-chat/src/pages/chat.tsx` — Ana chat UI (Replit tarzı)
- `artifacts/claude-chat/src/hooks/use-chat-stream.ts` — SSE stream hook (dosya desteğiyle)
- `artifacts/claude-chat/src/types.ts` — Paylaşılan tipler (GeneratedFile vb.)
- `artifacts/api-server/src/routes/anthropic/index.ts` — Claude API entegrasyonu + dosya üretimi
- `artifacts/api-server/src/routes/files.ts` — Üretilen dosyaların indirilmesi
- `artifacts/api-server/src/routes/github.ts` — GitHub PAT ile push
- `generated-files/` — Claude'un ürettiği dosyalar (gitignored)

## Architecture decisions

- Claude yanıtlarında `<file name="dosya.ext">içerik</file>` formatı kullanılır; server-side parse edilip `generated-files/` klasörüne kaydedilir
- Konuşmalar ve dosya içerikleri asla GitHub'a push edilmez (.gitignore + github.ts'de kontrol)
- Dosya üretimi için Claude'a system prompt verilir
- GitHub push için PAT geçici olarak kullanılır, saklanmaz
- Streaming sırasında dosyalar SSE event olarak `{ file: {...} }` formatında gönderilir

## Product

- Replit tarzı kompakt karanlık tema (13px Inter fontu, yeşil aksanlar)
- Claude ile konuşma, sohbet geçmişi, dosya ekleme
- Claude'un ürettiği dosyaları indirme (download butonu)
- Değiştirilen kod dosyalarını GitHub'a PAT ile push etme

## User preferences

- Türkçe arayüz tercih ediliyor
- Replit tarzı kompakt UI (küçük font, dar kenar boşlukları)
- Hassas bilgiler (konuşmalar, .env, secrets) asla GitHub'a gitmemeli

## Gotchas

- `generated-files/` klasörü `.gitignore`'da — GitHub'a kesinlikle push edilmez
- GitHub push'ta PAT response'da `***` ile maskelenir
- `types.ts`'deki `GeneratedFile` interface'i kullan; `chat.tsx`'den import etme (circular dependency)
- Claude dosya formatı: `<file name="ad.ext">içerik</file>` — regex ile parse edilir

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
