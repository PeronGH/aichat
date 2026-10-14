<script lang="ts">
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import Bot from "@lucide/svelte/icons/bot";
  import SquarePen from "@lucide/svelte/icons/square-pen";
  import Square from "@lucide/svelte/icons/square";
  import { tick } from "svelte";
  import { api } from "./api";
  import { renderMarkdown } from "./markdown";

  type Message = { role: "user" | "assistant"; content: string };

  let models = $state<string[]>([]);
  let model = $state("");
  let messages = $state<Message[]>([]);
  let input = $state("");
  let error = $state("");
  let controller = $state<AbortController | null>(null);
  let scroller: HTMLElement;
  let textarea: HTMLTextAreaElement;
  let stickToBottom = true;

  const busy = $derived(controller !== null);

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
    model = data.defaultModel ?? "";
  }
  loadModels();

  $effect(() => {
    void messages.at(-1)?.content;
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
    messages.push({ role: "assistant", content: "" });
    const reply = messages[messages.length - 1]!;
    stickToBottom = true;

    const ctrl = new AbortController();
    controller = ctrl;
    try {
      const res = await api.chat.$post(
        { json: { model, messages: history } },
        { init: { signal: ctrl.signal } },
      );
      if (!res.ok || !res.body) throw new Error(await errorMessage(res));
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        reply.content += value;
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
      bind:value={model}
      aria-label="Model"
      class="max-w-64 truncate rounded-md bg-transparent px-2 py-1 text-sm font-medium hover:bg-zinc-100 focus:outline-none dark:hover:bg-zinc-900"
    >
      {#each models as m (m)}
        <option value={m}>{m}</option>
      {/each}
    </select>
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
            class="max-w-[85%] self-end rounded-2xl bg-zinc-100 px-4 py-2.5 whitespace-pre-wrap dark:bg-zinc-800"
          >
            {message.content}
          </div>
        {:else}
          <div
            class="prose max-w-none prose-zinc dark:prose-invert prose-pre:bg-zinc-900 prose-pre:text-zinc-100"
          >
            {#if message.content}
              <!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by DOMPurify -->
              {@html renderMarkdown(message.content)}
            {:else}
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
