import type { Nodes, Root, RootContent } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

const parser = unified().use(remarkParse).use(remarkGfm);

/**
 * Converts an Outline Markdown document into plain prompter text.
 *
 * Formatting is dropped; only the structure a reader needs is kept:
 * - block elements (paragraphs, headings, list items, quotes, table rows)
 *   become paragraphs separated by a blank line;
 * - hard line breaks inside a block become single newlines;
 * - links keep their text, images and code blocks are removed.
 *
 * The output is fed to `parseScript`, which turns a blank line into a
 * paragraph break and a single newline into a line break.
 */
export function markdownToScript(markdown: string): string {
  const tree = parser.parse(normalizeOutline(markdown)) as Root;
  const blocks: string[] = [];
  for (const node of tree.children) collectBlocks(node, blocks);
  return blocks
    .map((block) => block.replace(/[ \t]+\n/g, '\n').trim())
    .filter((block) => block.length > 0)
    .join('\n\n');
}

/**
 * Outline writes a few non-standard constructs:
 * - `\` alone on a line for an empty paragraph;
 * - `:::info` / `:::warning` / `:::tip` notice fences around a block.
 */
function normalizeOutline(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, '\n')
    .replace(/^\\$/gm, '')
    .replace(/^:::[a-z]*\s*$/gm, '');
}

function collectBlocks(node: RootContent, out: string[]): void {
  switch (node.type) {
    case 'paragraph':
    case 'heading':
      out.push(inline(node));
      return;
    case 'blockquote':
    case 'listItem':
      for (const child of node.children) collectBlocks(child, out);
      return;
    case 'list':
      for (const item of node.children) collectBlocks(item, out);
      return;
    case 'table':
      for (const row of node.children) {
        out.push(
          row.children
            .map((cell) => inline(cell))
            .filter(Boolean)
            .join(' '),
        );
      }
      return;
    case 'html':
      out.push(stripTags(node.value));
      return;
    // Code, math, rules, definitions and footnote bodies are not read aloud.
    default:
      return;
  }
}

/** Plain text of a phrasing container, keeping hard breaks as newlines. */
function inline(node: Nodes): string {
  switch (node.type) {
    case 'text':
      return node.value;
    case 'inlineCode':
      return node.value;
    case 'break':
      return '\n';
    case 'image':
    case 'imageReference':
    case 'footnoteReference':
      return '';
    case 'html':
      return stripTags(node.value);
    default:
      return 'children' in node ? node.children.map((child) => inline(child)).join('') : '';
  }
}

function stripTags(html: string): string {
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '');
}
