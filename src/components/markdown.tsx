import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

function inline(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={i}
          className="rounded-sm bg-elevated px-1 py-px font-mono text-[0.85em] text-accent"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-medium text-fg">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export function Markdown({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const blocks = text.split(/```[\w-]*\n?|```/);
  const nodes: ReactNode[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const chunk = blocks[i] ?? "";
    if (i % 2 === 1) {
      nodes.push(
        <pre
          key={`c${i}`}
          className="my-2 overflow-x-auto rounded-lg bg-bg p-3 font-mono text-xs text-fg leading-relaxed"
        >
          <code>{chunk.replace(/\n$/, "")}</code>
        </pre>,
      );
      continue;
    }
    const lines = chunk.split("\n");
    let list: string[] = [];
    const flush = (key: string) => {
      if (!list.length) return;
      nodes.push(
        <ul key={key} className="my-2 space-y-1 pl-4 text-sm text-fg/90">
          {list.map((item, idx) => (
            <li key={idx} className="list-disc leading-relaxed">
              {inline(item)}
            </li>
          ))}
        </ul>,
      );
      list = [];
    };
    lines.forEach((line, idx) => {
      const key = `${i}-${idx}`;
      if (/^\s*[-*]\s+/.test(line)) {
        list.push(line.replace(/^\s*[-*]\s+/, ""));
        return;
      }
      flush(key);
      if (!line.trim()) return;
      if (/^#{1,3}\s/.test(line)) {
        nodes.push(
          <p key={key} className="mt-3 mb-1 font-medium text-fg">
            {inline(line.replace(/^#{1,3}\s/, ""))}
          </p>,
        );
        return;
      }
      nodes.push(
        <p key={key} className="my-1.5 leading-relaxed text-fg/90">
          {inline(line)}
        </p>,
      );
    });
    flush(`${i}-end`);
  }
  return <div className={cn("text-sm", className)}>{nodes}</div>;
}
