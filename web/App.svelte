<script lang="ts">
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import Bot from "@lucide/svelte/icons/bot";
  import Brain from "@lucide/svelte/icons/brain";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import SquarePen from "@lucide/svelte/icons/square-pen";
  import Square from "@lucide/svelte/icons/square";
  import { tick } from "svelte";
  import type { ChatEvent } from "../server";
  import { api } from "./api";
  import { renderMarkdown } from "./markdown";

  type ModelInfo = { id: string; efforts: string[]; defaultEffort?: string };
  type Message = {
    role: "user" | "assistant";
    content: string;
    model?: string;
    reasoning?: string;
    opaque?: string;
  };

  const MODEL_KEY = "model";
  const effortKey = (id: string) => `effort:${id}`;
  const effortLabels: Record<string, string> = {
    none: "No thinking",
    xhigh: "Extra high",
  };
  const effortLabel = (level: string) =>
    effortLabels[level] ?? level.charAt(0).toUpperCase() + level.slice(1);

  let models = $state<ModelInfo[]>([]);
  let model = $state("");
  let effort = $state("");
  let messages = $state<Message[]>([]);
  let input = $state("");
  let error = $state("");
  let controller = $state<AbortController | null>(null);
  let scroller: HTMLElement;
  let textarea: HTMLTextAreaElement;
  let stickToBottom = true;

  const busy = $derived(controller !== null);
  const efforts = $derived(models.find((m) => m.id === model)?.efforts ?? []);

  async function errorMessage(
    res: Pick<Response, "text" | "statusText">,
  ): Promise<string> {
    const body = await res.text();
    try {
      const { error } = JSON.parse(body) as { error?: unknown };
      return typeof error === "string" ? error : body;
    } catch {
      return body || res.statusText;
    }
  }

  async function loadModels() {
    const res = await api.models.$get();
    if (!res.ok) {
      error = `Failed to load models: ${await errorMessage(res)}`;
      return;
    }
    const data = await res.json();
    models = data.models;
    const saved = localStorage.getItem(MODEL_KEY);
    const initial = models.find((m) => m.id === saved) ?? models[0];
    if (initial) selectModel(initial.id);
  }
  loadModels();

  function selectModel(id: string) {
    model = id;
    localStorage.setItem(MODEL_KEY, id);
    const info = models.find((m) => m.id === id);
    const saved = localStorage.getItem(effortKey(id));
    effort =
      saved && info?.efforts.includes(saved)
        ? saved
        : (info?.defaultEffort ?? "");
  }

  function selectEffort(level: string) {
    effort = level;
    localStorage.setItem(effortKey(model), level);
  }

  $effect(() => {
    const last = messages.at(-1);
    void last?.content;
    void last?.reasoning;
    if (stickToBottom) scroller.scrollTop = scroller.scrollHeight;
  });

  function onScroll() {
    stickToBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 64;
  }

  function resizeInput() {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 240)}px`;
  }

  async function send() {
    const text = input.trim();
    if (!text || busy || !model) return;
    error = "";
    input = "";
    await tick();
    resizeInput();

    messages.push({ role: "user", content: text });
    const history = $state.snapshot(messages);
    messages.push({ role: "assistant", content: "", model, reasoning: "" });
    const reply = messages[messages.length - 1]!;
    stickToBottom = true;

    const ctrl = new AbortController();
    controller = ctrl;
    try {
      const res = await api.chat.$post(
        {
          json: {
            model,
            reasoningEffort: effort || undefined,
            messages: history,
          },
        },
        { init: { signal: ctrl.signal } },
      );
      if (!res.ok || !res.body) throw new Error(await errorMessage(res));
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop()!;
        for (const line of lines) {
          const event = JSON.parse(line) as ChatEvent;
          if (event.type === "content") reply.content += event.text;
          else if (event.type === "reasoning") reply.reasoning += event.text;
          else if (event.type === "opaque") reply.opaque = event.value;
          else throw new Error(event.message);
        }
      }
    } catch (err) {
      if (!ctrl.signal.aborted) {
        error = err instanceof Error ? err.message : String(err);
      }
    } finally {
      controller = null;
      if (!reply.content) messages.pop();
    }
  }

  function stop() {
    controller?.abort();
  }

  function newChat() {
    stop();
    messages = [];
    error = "";
    textarea.focus();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send();
    }
  }
</script>

<div class="flex h-dvh flex-col font-sans">
  <header
    class="flex items-center gap-3 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800"
  >
    <Bot class="size-5 text-zinc-500" />
    <select
      value={model}
      onchange={(e) => selectModel(e.currentTarget.value)}
      aria-label="Model"
      class="max-w-64 truncate rounded-md bg-transparent px-2 py-1 text-sm font-medium hover:bg-zinc-100 focus:outline-none dark:hover:bg-zinc-900"
    >
      {#each models as m (m.id)}
        <option value={m.id}>{m.id}</option>
      {/each}
    </select>
    {#if efforts.length}
      <label
        class="flex items-center gap-1 rounded-md pl-2 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
        title="Thinking effort"
      >
        <Brain class="size-4" />
        <select
          value={effort}
          onchange={(e) => selectEffort(e.currentTarget.value)}
          aria-label="Thinking effort"
          class="bg-transparent py-1 pr-2 focus:outline-none"
        >
          {#each efforts as level (level)}
            <option value={level}>{effortLabel(level)}</option>
          {/each}
        </select>
      </label>
    {/if}
    <button
      onclick={newChat}
      title="New chat"
      aria-label="New chat"
      class="ml-auto rounded-md p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
    >
      <SquarePen class="size-5" />
    </button>
  </header>

  <main bind:this={scroller} onscroll={onScroll} class="flex-1 overflow-y-auto">
    <div class="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
      {#if messages.length === 0}
        <div
          class="mt-[20vh] flex flex-col items-center gap-3 text-zinc-400 dark:text-zinc-500"
        >
          <Bot class="size-10" />
          <p class="text-lg">How can I help you today?</p>
        </div>
      {/if}

      {#each messages as message, i (i)}
        {#if message.role === "user"}
          <div
            class="max-w-[85%] self-end rounded-2xl bg-zinc-100 px-4 py-2.5 dark:bg-zinc-800"
          >
            <span class="whitespace-pre-wrap">{message.content}</span>
          </div>
        {:else}
          {@const streaming = busy && i === messages.length - 1}
          <div class="flex flex-col gap-3">
            {#if message.reasoning}
              <details class="group" open={streaming && !message.content}>
                <summary
                  class="flex cursor-pointer list-none items-center gap-1.5 text-sm text-zinc-500 select-none hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                  <Brain class="size-4" />
                  {streaming && !message.content ? "Thinking…" : "Thought"}
                  <ChevronRight
                    class="size-4 transition-transform group-open:rotate-90"
                  />
                </summary>
                <div
                  class="prose mt-2 max-w-none border-l-2 border-zinc-200 pl-4 text-sm prose-zinc dark:border-zinc-800 dark:prose-invert"
                >
                  <!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by DOMPurify -->
                  {@html renderMarkdown(message.reasoning)}
                </div>
              </details>
            {/if}
            {#if message.content}
              <div
                class="prose max-w-none prose-zinc dark:prose-invert prose-pre:bg-zinc-900 prose-pre:text-zinc-100"
              >
                <!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by DOMPurify -->
                {@html renderMarkdown(message.content)}
              </div>
            {:else if !message.reasoning}
              <span
                class="inline-block size-2.5 animate-pulse rounded-full bg-zinc-400"
              ></span>
            {/if}
          </div>
        {/if}
      {/each}

      {#if error}
        <div
          class="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </div>
      {/if}
    </div>
  </main>

  <footer class="px-4 pb-4">
    <form
      onsubmit={(e) => {
        e.preventDefault();
        send();
      }}
      class="mx-auto flex max-w-3xl items-end gap-2 rounded-3xl border border-zinc-300 bg-white p-2 pl-4 shadow-sm focus-within:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:focus-within:border-zinc-500"
    >
      <textarea
        bind:this={textarea}
        bind:value={input}
        oninput={resizeInput}
        onkeydown={onKeydown}
        rows="1"
        placeholder="Message"
        class="max-h-60 flex-1 resize-none self-center bg-transparent py-1.5 placeholder:text-zinc-400 focus:outline-none"
      ></textarea>
      {#if busy}
        <button
          type="button"
          onclick={stop}
          title="Stop"
          aria-label="Stop"
          class="rounded-full bg-zinc-900 p-2 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          <Square class="size-4 fill-current" />
        </button>
      {:else}
        <button
          type="submit"
          disabled={!input.trim() || !model}
          title="Send"
          aria-label="Send"
          class="rounded-full bg-zinc-900 p-2 text-white hover:bg-zinc-700 disabled:opacity-30 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          <ArrowUp class="size-4" />
        </button>
      {/if}
    </form>
  </footer>
</div>
