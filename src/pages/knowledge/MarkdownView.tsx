import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** 只读预览：渲染标准 Markdown/GFM，不引入富文本编辑器。 */
export function MarkdownView({ body }: { body: string }) {
  return (
    <div className="knowledge-md text-[13px] leading-relaxed text-text">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mb-2 mt-4 text-lg font-semibold first:mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-1.5 mt-4 text-[15px] font-semibold first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-1.5 mt-3 text-[13.5px] font-semibold first:mt-0">
              {children}
            </h3>
          ),
          p: ({ children }) => <p className="my-2 text-dim">{children}</p>,
          ul: ({ children }) => (
            <ul className="my-2 list-disc pl-5 text-dim">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 list-decimal pl-5 text-dim">{children}</ol>
          ),
          li: ({ children }) => <li className="my-0.5">{children}</li>,
          code: ({ children }) => (
            <code className="rounded bg-panel2 px-1 py-0.5 font-mono text-[12px] text-text">
              {children}
            </code>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-accent/50 pl-3 text-dim">
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-accent underline"
            >
              {children}
            </a>
          ),
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
