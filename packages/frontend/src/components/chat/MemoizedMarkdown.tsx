import { Children, isValidElement, memo, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

interface MemoizedMarkdownProps {
  content: string;
  className?: string;
  animateWords?: boolean;
}

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];

type MarkdownNodeWithPosition = {
  position?: {
    start?: {
      offset?: number;
      line?: number;
      column?: number;
    };
  };
};

function getNodePositionKey(node: MarkdownNodeWithPosition | undefined, fallback: string): string {
  const start = node?.position?.start;
  if (typeof start?.offset === 'number') return `${fallback}-${start.offset}`;
  if (typeof start?.line === 'number' && typeof start?.column === 'number') {
    return `${fallback}-${start.line}-${start.column}`;
  }
  return fallback;
}

function splitTextForWordFade(text: string, keyPrefix: string): ReactNode[] {
  const tokens = text.match(/\s+|\S+/g) ?? [];
  return tokens.map((token, index) => {
    if (/^\s+$/.test(token)) return token;
    return (
      <span key={`${keyPrefix}-${index}`} className="pl-word-fade">
        {token}
      </span>
    );
  });
}

function animateWordChildren(children: ReactNode, keyPrefix: string): ReactNode {
  return Children.map(children, (child, index) => {
    if (typeof child === 'string') {
      return splitTextForWordFade(child, `${keyPrefix}-${index}`);
    }
    if (typeof child === 'number') {
      return (
        <span key={`${keyPrefix}-${index}`} className="pl-word-fade">
          {child}
        </span>
      );
    }
    if (isValidElement(child)) {
      return child;
    }
    return child;
  });
}

const markdownComponents: Components = {
  table: ({ node: _n, ...props }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-foreground/10">
      <table className="w-full border-collapse text-sm" {...props} />
    </div>
  ),
  thead: ({ node: _n, ...props }) => <thead className="bg-foreground/5" {...props} />,
  th: ({ node: _n, ...props }) => (
    <th className="px-3 py-2 text-left font-semibold border-b border-foreground/10" {...props} />
  ),
  td: ({ node: _n, ...props }) => (
    <td className="px-3 py-1.5 border-b border-foreground/5 align-top" {...props} />
  ),
  tr: ({ node: _n, ...props }) => <tr className="even:bg-foreground/[0.02]" {...props} />,
  img: ({ node: _n, alt, src, ...props }) => (
    <a
      href={src ?? '#'}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-block my-2 max-w-full"
      aria-label={alt || 'generated image'}
    >
      <img
        {...props}
        src={src}
        alt={alt || ''}
        loading="lazy"
        className="max-w-full rounded-lg border border-foreground/10 shadow-sm hover:shadow-md transition-shadow"
      />
    </a>
  ),
};

const animatedMarkdownComponents: Components = {
  ...markdownComponents,
  p: ({ node, children, ...props }) => (
    <p {...props}>
      {animateWordChildren(
        children,
        getNodePositionKey(node as MarkdownNodeWithPosition | undefined, 'p')
      )}
    </p>
  ),
  li: ({ node, children, ...props }) => (
    <li {...props}>
      {animateWordChildren(
        children,
        getNodePositionKey(node as MarkdownNodeWithPosition | undefined, 'li')
      )}
    </li>
  ),
  blockquote: ({ node, children, ...props }) => (
    <blockquote {...props}>
      {animateWordChildren(
        children,
        getNodePositionKey(node as MarkdownNodeWithPosition | undefined, 'blockquote')
      )}
    </blockquote>
  ),
  h1: ({ node, children, ...props }) => (
    <h1 {...props}>
      {animateWordChildren(
        children,
        getNodePositionKey(node as MarkdownNodeWithPosition | undefined, 'h1')
      )}
    </h1>
  ),
  h2: ({ node, children, ...props }) => (
    <h2 {...props}>
      {animateWordChildren(
        children,
        getNodePositionKey(node as MarkdownNodeWithPosition | undefined, 'h2')
      )}
    </h2>
  ),
  h3: ({ node, children, ...props }) => (
    <h3 {...props}>
      {animateWordChildren(
        children,
        getNodePositionKey(node as MarkdownNodeWithPosition | undefined, 'h3')
      )}
    </h3>
  ),
  h4: ({ node, children, ...props }) => (
    <h4 {...props}>
      {animateWordChildren(
        children,
        getNodePositionKey(node as MarkdownNodeWithPosition | undefined, 'h4')
      )}
    </h4>
  ),
  h5: ({ node, children, ...props }) => (
    <h5 {...props}>
      {animateWordChildren(
        children,
        getNodePositionKey(node as MarkdownNodeWithPosition | undefined, 'h5')
      )}
    </h5>
  ),
  h6: ({ node, children, ...props }) => (
    <h6 {...props}>
      {animateWordChildren(
        children,
        getNodePositionKey(node as MarkdownNodeWithPosition | undefined, 'h6')
      )}
    </h6>
  ),
  strong: ({ node, children, ...props }) => (
    <strong {...props}>
      {animateWordChildren(
        children,
        getNodePositionKey(node as MarkdownNodeWithPosition | undefined, 'strong')
      )}
    </strong>
  ),
  em: ({ node, children, ...props }) => (
    <em {...props}>
      {animateWordChildren(
        children,
        getNodePositionKey(node as MarkdownNodeWithPosition | undefined, 'em')
      )}
    </em>
  ),
  a: ({ node, children, ...props }) => (
    <a {...props}>
      {animateWordChildren(
        children,
        getNodePositionKey(node as MarkdownNodeWithPosition | undefined, 'a')
      )}
    </a>
  ),
};

export const MemoizedMarkdown = memo(function MemoizedMarkdown({
  content,
  className,
  animateWords = false,
}: MemoizedMarkdownProps) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={animateWords ? animatedMarkdownComponents : markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
