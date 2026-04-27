import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

interface MemoizedMarkdownProps {
  content: string;
  className?: string;
}

export const MemoizedMarkdown = memo(function MemoizedMarkdown({ content, className }: MemoizedMarkdownProps) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          table: ({ node: _n, ...props }) => (
            <div className="my-3 overflow-x-auto rounded-lg border border-foreground/10">
              <table className="w-full border-collapse text-sm" {...props} />
            </div>
          ),
          thead: ({ node: _n, ...props }) => (
            <thead className="bg-foreground/5" {...props} />
          ),
          th: ({ node: _n, ...props }) => (
            <th className="px-3 py-2 text-left font-semibold border-b border-foreground/10" {...props} />
          ),
          td: ({ node: _n, ...props }) => (
            <td className="px-3 py-1.5 border-b border-foreground/5 align-top" {...props} />
          ),
          tr: ({ node: _n, ...props }) => (
            <tr className="even:bg-foreground/[0.02]" {...props} />
          ),
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
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
