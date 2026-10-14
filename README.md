# aichat

Minimal AI chat web app for any OpenAI-compatible Chat Completions API. Compiles to a single binary (`dist/app`) that serves a Svelte + Tailwind UI and proxies streamed completions, so the API key never reaches the browser.

## Usage

Configure via environment variables (or a `.env` file in dev):

- `OPENAI_BASE_URL`: API base URL, e.g. `https://api.openai.com/v1` (default)
- `OPENAI_API_KEY`: API key
- `OPENAI_MODEL`: optional default model; otherwise the first from `/models`
- `PORT`: optional, defaults to `3000`

```bash
bun install
bun run dev      # dev server with HMR on http://localhost:3000
bun run build    # standalone binary at dist/app
bun run check && bun run lint && bun run format
```

## Example

```bash
bun run build
OPENAI_BASE_URL=http://localhost:11434/v1 OPENAI_API_KEY=ollama ./dist/app
```
