import DOMPurify from "dompurify";
import { marked } from "marked";

export function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(
    marked.parse(text, { async: false, gfm: true, breaks: true }),
  );
}
