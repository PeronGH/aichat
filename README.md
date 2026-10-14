# copilot-aichat

Minimal AI chat web app for the GitHub Copilot API. Compiles to a single binary (`dist/copilot-aichat`) that serves a Svelte + Tailwind UI and proxies streamed chat completions, so the token never reaches the browser.

## Usage

Requires the GitHub CLI, logged in to an account with Copilot access (`gh auth login`). The server calls `https://api.githubcopilot.com` with the token from `gh auth token`, read once at startup.

Set `PORT` to change the listen port (default `3000`), either in the environment or in a `.env` file (see `.env.example`).

```bash
bun install
bun run dev      # dev server with HMR on http://localhost:3000
bun run build    # standalone binary at dist/copilot-aichat
bun run check && bun run lint && bun run format
```

## Example

```bash
bun run build
PORT=8080 ./dist/copilot-aichat
```
