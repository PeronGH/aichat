# copilot-aichat

Minimal AI chat app for the GitHub Copilot API (the only provider). Compiles to
a single Bun binary (`dist/copilot-aichat`). Svelte 5 SPA in `web/`, Hono + Zod
API in `server/`, end-to-end typed via Hono RPC. No Vite, no Node.js.

- `server/index.ts`: `GET /api/models` lists upstream models; `POST /api/chat`
  streams the assistant reply as plain text chunks. Uses the `openai` SDK
  against `https://api.githubcopilot.com`, authenticated with `gh auth token`
  (read once at startup) and sending `Copilot-Integration-Id: vscode-chat`.
  `COPILOT_MODEL` sets the default model. Upstream errors become `{ error }`
  JSON responses.
- `web/App.svelte`: the whole chat UI (in-memory history, no persistence).
  Markdown is rendered with `marked` and sanitized with DOMPurify
  (`web/markdown.ts`), styled with `@tailwindcss/typography`. Icons come from
  `@lucide/svelte` (import per icon: `@lucide/svelte/icons/<name>`).
- Reference for Copilot API behavior: the Copilot extension in the VS Code
  repo (`extensions/copilot/src`).

## Commands

- `bun run dev`: dev server with HMR on http://localhost:3000
- `bun run build`: standalone binary at `dist/copilot-aichat`
- `bun run check`: svelte-check (type-checks `.ts` and `.svelte`)
- `bun run lint` / `bun run format`: ESLint / Prettier

All of check, lint, and format must pass before committing.

## Architecture

The split is fixed: backend code lives in `server/`, frontend code in `web/`.
`server/` must never import from `web/`; `web/` imports only types from
`server/`.

- Entry point: `Bun.serve()` serves the SPA's HTML and delegates `/api/*` to
  the Hono app.
- `server/`: Hono app on `.basePath("/api")`. Validate request bodies with
  `zValidator` from `@hono/zod-validator`. Routes MUST stay in the chained
  style (`new Hono().get(...).post(...)`). The exported `AppType` powers the
  RPC client, and standalone `app.get(...)` calls break type inference. Split
  routes into sub-apps mounted with `.route()` as the API grows.
- `web/`: Svelte 5 with runes (`$state`, `$derived`; `mount` from `svelte`).
  Client-side rendering only, because `bun-plugin-svelte` does not support SSR.
  The frontend calls the API only through the typed `hc<AppType>(...)` client.
- Styling: Tailwind v4 via `@import "tailwindcss"`, no config file.

## Build pipeline

- Dev: `bunfig.toml` registers `bun-plugin-svelte` and `bun-plugin-tailwind`
  under `[serve.static]` so the dev server compiles `.svelte` files and
  Tailwind on the fly.
- Production: `build.ts` uses the `Bun.build()` JS API with
  `compile: { outfile }` and the same plugins. A build script is required
  because the `bun build` CLI does not support plugins.

## Gotchas

- Compiled Bun binaries default `NODE_ENV` to `development`. `build.ts` inlines
  `process.env.NODE_ENV = "production"` via `define`; don't remove it, or the
  binary serves unminified assets with HMR enabled.
- Style with Tailwind utility classes in markup. Tailwind syntax (`@apply`)
  inside Svelte `<style>` blocks is not processed by the plugin.

## Bun conventions

- Use `bun <file>`, `bun test`, `bun install`, `bunx`. Never node/npm/npx/vite/jest.
- Prefer built-ins (`Bun.serve()`, `bun:sqlite`, `Bun.file`, `Bun.$`, built-in
  `WebSocket`) over express/better-sqlite3/node:fs/execa/ws.
- Bun loads `.env` automatically, so don't use dotenv.
- Bun API docs: `node_modules/bun-types/docs/**.mdx`.
- `bunfig.toml` sets a 7-day `minimumReleaseAge` as a supply-chain guard. Don't
  bypass it to grab a fresh release.
