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

type CopilotModel = OpenAI.Models.Model & {
  model_picker_enabled?: boolean;
  capabilities?: {
    type?: string;
    family?: string;
    supports?: { reasoning_effort?: string[] };
  };
  supported_endpoints?: string[];
};

// Copilot streams reasoning in these non-standard delta fields.
type CopilotDelta = OpenAI.Chat.ChatCompletionChunk.Choice.Delta & {
  reasoning_text?: string | null;
  reasoning_opaque?: string | null;
};

// Copilot reports reasoning_tokens at the top level of usage.
type CopilotUsage = OpenAI.CompletionUsage & { reasoning_tokens?: number };

export type Usage = {
  input: number;
  cached: number;
  output: number;
  reasoning?: number;
};

export type ChatEvent =
  | { type: "usage"; usage: Usage }
  | { type: "content"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "opaque"; value: string }
  | { type: "error"; message: string };

// Mirrors pickDefaultReasoningEffort in the VS Code Copilot extension.
function defaultEffort(levels: string[], family: string): string | undefined {
  const f = family.toLowerCase();
  const medium = /^claude-(?:opus|haiku)-5[.-]5(?![.\d])/.test(f);
  const preferred = !medium && f.startsWith("claude") ? "high" : "medium";
  return levels.includes(preferred) ? preferred : levels[0];
}

const chatSchema = z.object({
  model: z.string().min(1),
  reasoningEffort: z.string().optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
        model: z.string().optional(),
        reasoning: z.string().optional(),
        opaque: z.string().optional(),
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
    const models: { id: string; efforts: string[]; defaultEffort?: string }[] =
      [];
    for await (const model of openai.models.list() as AsyncIterable<CopilotModel>) {
      if (
        model.model_picker_enabled &&
        model.capabilities?.type === "chat" &&
        model.supported_endpoints?.includes("/chat/completions")
      ) {
        const efforts = model.capabilities.supports?.reasoning_effort ?? [];
        models.push({
          id: model.id,
          efforts,
          defaultEffort: defaultEffort(
            efforts,
            model.capabilities.family ?? model.id,
          ),
        });
      }
    }
    return c.json({ models });
  })
  .post("/chat", zValidator("json", chatSchema), async (c) => {
    const { model, reasoningEffort, messages } = c.req.valid("json");
    // Encrypted reasoning only validates on the model that produced it;
    // Claude rejects another model's with "Invalid `signature`". Gemini binds
    // it to the exact content and silently drops it if either differs by a
    // byte, so both must round-trip untouched.
    const upstreamMessages = messages.map((m) =>
      m.role === "assistant" && m.opaque && m.model === model
        ? {
            role: m.role,
            content: m.content,
            reasoning_text: m.reasoning ?? "",
            reasoning_opaque: m.opaque,
          }
        : { role: m.role, content: m.content },
    ) as OpenAI.Chat.ChatCompletionMessageParam[];

    const controller = new AbortController();
    const completion = await openai.chat.completions.create(
      {
        model,
        messages: upstreamMessages,
        stream: true,
        ...(reasoningEffort && {
          reasoning_effort: reasoningEffort as OpenAI.ReasoningEffort,
        }),
      },
      { signal: controller.signal },
    );

    c.header("Content-Type", "application/x-ndjson");
    return stream(
      c,
      async (s) => {
        s.onAbort(() => controller.abort());
        const send = (event: ChatEvent) =>
          s.write(JSON.stringify(event) + "\n");
        let usage: CopilotUsage | undefined;
        for await (const chunk of completion) {
          // Gemini sends zeroed usage on earlier chunks; the last one is final.
          if (chunk.usage) usage = chunk.usage;
          const delta = chunk.choices[0]?.delta as CopilotDelta | undefined;
          if (!delta) continue;
          if (delta.reasoning_text) {
            await send({ type: "reasoning", text: delta.reasoning_text });
          }
          if (delta.reasoning_opaque) {
            await send({ type: "opaque", value: delta.reasoning_opaque });
          }
          if (delta.content) {
            await send({ type: "content", text: delta.content });
          }
        }
        if (usage) {
          await send({
            type: "usage",
            usage: {
              input: usage.prompt_tokens,
              cached: usage.prompt_tokens_details?.cached_tokens ?? 0,
              // completion_tokens excludes reasoning for Gemini but includes it
              // for GPT; the total is consistent across models.
              output: usage.total_tokens - usage.prompt_tokens,
              reasoning:
                usage.reasoning_tokens ??
                usage.completion_tokens_details?.reasoning_tokens,
            },
          });
        }
      },
      async (err, s) => {
        await s.write(
          JSON.stringify({
            type: "error",
            message: err.message,
          } satisfies ChatEvent) + "\n",
        );
      },
    );
  });

export type AppType = typeof app;
export default app;
