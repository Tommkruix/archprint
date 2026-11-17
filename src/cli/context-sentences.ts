import type { Nodes, Root } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table';
import { gfmTable } from 'micromark-extension-gfm-table';
import { IMPERATIVE_VERBS } from '../data/imperative-verbs.js';
import { normalize } from './source-quote.js';

export interface ContextSentence {
  /** Normalized the way `locateQuote` compares a quote: no emphasis, plain quotes and dashes, single spaces. */
  text: string;
  line: number;
}

const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;
const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });

interface Block {
  source: string;
  line: number;
}

const parse = (body: string): Root =>
  fromMarkdown(body, { extensions: [gfmTable()], mdastExtensions: [gfmTableFromMarkdown()] });

/** The prose blocks of a context file: paragraphs, in lists and quotes too, and table rows below the header. */
function proseBlocks(markdown: string): Block[] {
  const body = markdown.replace(FRONT_MATTER, (block) => block.replace(/[^\n]/g, ''));
  const slice = (node: Nodes): string =>
    body.slice(node.position!.start.offset, node.position!.end.offset);
  const blocks: Block[] = [];
  const visit = (node: Nodes): void => {
    if (node.type === 'paragraph') {
      blocks.push({ source: slice(node), line: node.position!.start.line });
    } else if (node.type === 'table') {
      for (const row of node.children.slice(1)) {
        const cells = row.children.map((cell) =>
          cell.children.length === 0
            ? ''
            : body.slice(
                cell.children[0]!.position!.start.offset,
                cell.children.at(-1)!.position!.end.offset,
              ),
        );
        blocks.push({ source: cells.join(' '), line: row.position!.start.line });
      }
    } else if (
      node.type === 'root' ||
      node.type === 'list' ||
      node.type === 'listItem' ||
      node.type === 'blockquote'
    ) {
      for (const child of node.children) visit(child);
    }
  };
  visit(parse(body));
  return blocks;
}

/** Each sentence of a context file's prose, with the line it starts on. Headings, code, HTML and front matter are not prose. */
export function contextSentences(markdown: string): ContextSentence[] {
  const sentences: ContextSentence[] = [];
  for (const block of proseBlocks(markdown)) {
    const { text, lines } = normalize(block.source);
    for (const { segment, index } of segmenter.segment(text)) {
      const sentence = segment.trim();
      if (sentence === '') continue;
      const start = index + segment.indexOf(sentence);
      sentences.push({ text: sentence, line: block.line + lines[start]! - 1 });
    }
  }
  return sentences;
}

const OBLIGATION =
  /\b(?:must|should|shall|never|always|do not|don't|avoid|required?|prefer|instead of|make sure|ensure|recommended|mandatory)\b/i;
const OPENING_WORD =
  /^(?:(?:if|when|for|before|after|while|once|unless|in)\b[^,:]{0,80}[,:]\s*)?(?:please\s+)?([a-z-]+)/i;

/** Whether a sentence reads like an instruction: an obligation word, or an opening imperative verb. */
export function readsLikeRule(sentence: string): boolean {
  if (OBLIGATION.test(sentence)) return true;
  const opening = OPENING_WORD.exec(sentence)?.[1];
  return opening !== undefined && IMPERATIVE_VERBS.has(opening.toLowerCase());
}
