import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { stream } from "hono/streaming";
import OpenAI from "openai";
import { z } from "zod";

const openai = new OpenAI({
  baseURL: "https://api.githubcopilot.com",
  apiKey: (await Bun.$`gh auth token`.text()).trim(),
  defaultHeaders: { "Copilot-Integration-Id": "vscode-chat" },
});

const chatSchema = z.object({
  model: z.string().min(1),
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string(),
      }),
    )
    .min(1),
});

const app = new Hono()
  .basePath("/api")
  .onError((err, c) => {
    const status = err instanceof OpenAI.APIError ? (err.status ?? 502) : 500;
    return c.json({ error: err.message }, status as ContentfulStatusCode);
  })
  .get("/models", async (c) => {
    const ids: string[] = [];
    for await (const model of openai.models.list()) ids.push(model.id);
    ids.sort();
    const defaultModel = process.env["COPILOT_MODEL"] ?? ids[0] ?? null;
    if (defaultModel && !ids.includes(defaultModel)) ids.unshift(defaultModel);
    return c.json({ models: ids, defaultModel });
  })
  .post("/chat", zValidator("json", chatSchema), async (c) => {
    const { model, messages } = c.req.valid("json");
    const controller = new AbortController();
    const completion = await openai.chat.completions.create(
      { model, messages, stream: true },
      { signal: controller.signal },
    );
    return stream(
      c,
      async (s) => {
        s.onAbort(() => controller.abort());
        for await (const chunk of completion) {
          const delta = chunk.choices[0]?.delta.content;
          if (delta) await s.write(delta);
        }
      },
      async (err, s) => {
        await s.write(`\n\n**Error:** ${err.message}`);
      },
    );
  });

export type AppType = typeof app;
export default app;
