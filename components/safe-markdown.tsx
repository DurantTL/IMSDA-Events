import { Fragment, type ReactNode } from "react";
import { parseMarkdown, type MarkdownInline } from "@/modules/events/content-markdown";

/**
 * Renders the constrained Markdown of `modules/events/content-markdown.ts` (headings, paragraphs, bold, italic, http(s) and
 * mailto links, lists) as React elements. There is no HTML path: raw HTML, images and video stay literal text. Shared by the
 * event page's formatted-text block and the registration form's Information block (#284).
 */
export function renderMarkdownInline(nodes: MarkdownInline[]): ReactNode {
  return nodes.map((node, index) => {
    if (node.type === "text") return <Fragment key={index}>{node.text}</Fragment>;
    if (node.type === "strong") return <strong key={index}>{renderMarkdownInline(node.children)}</strong>;
    if (node.type === "em") return <em key={index}>{renderMarkdownInline(node.children)}</em>;
    const isMail = node.href.toLowerCase().startsWith("mailto:");
    return (
      <a
        key={index}
        href={node.href}
        {...(isMail ? {} : { target: "_blank", rel: "noopener noreferrer" })}
      >
        {renderMarkdownInline(node.children)}
      </a>
    );
  });
}

type HeadingTag = "h3" | "h4" | "h5";

/** `headingTags` are the elements a `##` and a `###` become, so they sit under the page's own headings. */
export function SafeMarkdown({ source, className, headingTags = ["h3", "h4"] }: { source: string; className?: string; headingTags?: readonly [HeadingTag, HeadingTag] }) {
  const [levelTwo, levelThree] = headingTags;
  const LevelTwo = levelTwo;
  const LevelThree = levelThree;
  return (
    <div className={className}>
      {parseMarkdown(source).map((block, index) => {
        if (block.type === "heading") {
          return block.level === 2
            ? <LevelTwo key={index}>{renderMarkdownInline(block.children)}</LevelTwo>
            : <LevelThree key={index}>{renderMarkdownInline(block.children)}</LevelThree>;
        }
        if (block.type === "ul") {
          return <ul key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{renderMarkdownInline(item)}</li>)}</ul>;
        }
        if (block.type === "ol") {
          return <ol key={index} start={block.start}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{renderMarkdownInline(item)}</li>)}</ol>;
        }
        return <p key={index}>{renderMarkdownInline(block.children)}</p>;
      })}
    </div>
  );
}
