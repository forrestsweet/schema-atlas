type MarkdownNode = {
  children?: MarkdownNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
  };
  type: string;
  value?: string;
};

type TextEntry = {
  node: MarkdownNode & { value: string };
  parent: MarkdownNode & { children: MarkdownNode[] };
  startWordIndex: number;
  wordCount: number;
};

const STREAM_WORD_CLASS = [
  "aui-md-stream-word",
  "fade-in",
  "animate-in",
  "fill-mode-both",
  "duration-500",
  "transition-colors",
  "motion-reduce:animate-none",
  "motion-reduce:transition-none",
];

const countWords = (value: string) => [...value.matchAll(/\S+/gu)].length;

const streamingWord = (value: string, fresh: boolean): MarkdownNode => ({
  children: [{ type: "text", value }],
  data: {
    hName: "span",
    hProperties: {
      className: fresh
        ? [...STREAM_WORD_CLASS, "text-blue-500", "dark:text-blue-400"]
        : STREAM_WORD_CLASS,
    },
  },
  type: "emphasis",
});

const splitTextNode = (
  value: string,
  startWordIndex: number,
  freshWordStart: number,
  streaming: boolean,
) => {
  const result: MarkdownNode[] = [];
  let cursor = 0;
  let wordOffset = 0;

  for (const match of value.matchAll(/\S+/gu)) {
    const start = match.index;
    if (start > cursor) {
      result.push({ type: "text", value: value.slice(cursor, start) });
    }
    result.push(
      streamingWord(
        match[0],
        streaming && startWordIndex + wordOffset >= freshWordStart,
      ),
    );
    cursor = start + match[0].length;
    wordOffset += 1;
  }

  if (cursor < value.length) {
    result.push({ type: "text", value: value.slice(cursor) });
  }
  return result;
};

export const decorateMarkdownStreamingWords = (
  tree: MarkdownNode,
  streaming: boolean,
) => {
  const entries: TextEntry[] = [];
  let wordCount = 0;

  const collect = (node: MarkdownNode) => {
    if (!node.children) return;
    for (const child of node.children) {
      if (child.type === "text" && typeof child.value === "string") {
        const childWordCount = countWords(child.value);
        entries.push({
          node: child as MarkdownNode & { value: string },
          parent: node as MarkdownNode & { children: MarkdownNode[] },
          startWordIndex: wordCount,
          wordCount: childWordCount,
        });
        wordCount += childWordCount;
        continue;
      }
      collect(child);
    }
  };

  collect(tree);
  const freshWordStart = Math.max(0, wordCount - 2);

  for (const entry of [...entries].reverse()) {
    const index = entry.parent.children.indexOf(entry.node);
    if (index < 0 || entry.wordCount === 0) continue;
    entry.parent.children.splice(
      index,
      1,
      ...splitTextNode(
        entry.node.value,
        entry.startWordIndex,
        freshWordStart,
        streaming,
      ),
    );
  }
};

export const remarkStreamingWords = ({
  streaming = false,
}: {
  streaming?: boolean;
} = {}) =>
  (tree: MarkdownNode) => {
    decorateMarkdownStreamingWords(tree, streaming);
  };
