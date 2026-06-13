import { Fragment } from "react";
import type { ReactNode } from "react";

/**
 * Minimal, dependency-free, XSS-safe markdown renderer for the Wave 12
 * Designer's Guide. Supports the subset a guide blurb needs:
 *   • blank-line-separated paragraphs
 *   • "## " / "### " headings
 *   • "- " or "• " bullet lists
 *   • **bold** inline
 * Anything else renders as plain text. No dangerouslySetInnerHTML — every
 * node is a React element, so operator-entered text can never inject
 * markup. (If richer markdown is ever needed, swap this for
 * react-markdown; the call site only passes a string.)
 */
function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    const bold = /^\*\*([^*]+)\*\*$/.exec(part);
    if (bold) return <strong key={i}>{bold[1]}</strong>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export default function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: string[] = [];

  const flushPara = () => {
    if (para.length) {
      blocks.push(
        <p key={`p${blocks.length}`}>{renderInline(para.join(" "))}</p>,
      );
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      blocks.push(
        <ul key={`u${blocks.length}`} className="list-disc space-y-1 pl-5">
          {list.map((li, j) => (
            <li key={j}>{renderInline(li)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const heading = /^(#{2,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      flushList();
      const text = renderInline(heading[2]);
      blocks.push(
        heading[1].length === 2 ? (
          <h3 key={`h${blocks.length}`} className="text-base font-semibold text-neutral-900">
            {text}
          </h3>
        ) : (
          <h4 key={`h${blocks.length}`} className="text-sm font-semibold text-neutral-900">
            {text}
          </h4>
        ),
      );
      continue;
    }
    const bullet = /^[-•]\s+(.*)$/.exec(line);
    if (bullet) {
      flushPara();
      list.push(bullet[1]);
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();

  return (
    <div className="space-y-3 text-sm leading-relaxed text-neutral-700">
      {blocks}
    </div>
  );
}
