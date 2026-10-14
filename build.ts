import tailwind from "bun-plugin-tailwind";
import { SveltePlugin } from "bun-plugin-svelte";

await Bun.build({
  entrypoints: ["./index.ts"],
  compile: { outfile: "./dist/copilot-aichat" },
  plugins: [SveltePlugin(), tailwind],
  minify: true,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
});

console.log("Built dist/copilot-aichat");
