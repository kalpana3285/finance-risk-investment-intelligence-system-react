import { Children, cloneElement, isValidElement, useEffect, useMemo, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { normalizeAnswerMarkdownWithDiagnostics } from './normalizeAnswerMarkdown'

type Props = {
  text: string
  className?: string
  renderText: (text: string) => ReactNode
}

function safeMarkdownHref(href?: string): string | null {
  if (!href) return null
  const trimmed = href.trim()
  if (trimmed.startsWith('#')) return trimmed
  try {
    const url = new URL(trimmed)
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

function withoutMarkdownNode<T extends { node?: unknown }>(props: T): Omit<T, 'node'> {
  const htmlProps = { ...props }
  delete htmlProps.node
  return htmlProps
}

export default function MarkdownAnswerRenderer({ text, className = '', renderText }: Props) {
  const normalization = useMemo(() => normalizeAnswerMarkdownWithDiagnostics(text), [text])
  useEffect(() => {
    const { diagnostics } = normalization
    if (diagnostics.changed || diagnostics.malformedTableBlocksPreserved > 0) {
      console.debug('[FRIIS] Markdown formatting diagnostics', diagnostics)
    }
  }, [normalization])

  const renderChildren = (children: ReactNode): ReactNode => Children.map(children, (child) => {
    if (typeof child === 'string') return renderText(child)
    if (!isValidElement<{ children?: ReactNode }>(child)) return child
    if (child.type === 'code' || child.type === 'pre') return child
    return cloneElement(child, undefined, renderChildren(child.props.children))
  })

  const components: Components = {
    h1: ({ children, ...props }) => <h2 {...withoutMarkdownNode(props)}>{renderChildren(children)}</h2>,
    h2: ({ children, ...props }) => <h3 {...withoutMarkdownNode(props)}>{renderChildren(children)}</h3>,
    h3: ({ children, ...props }) => <h4 {...withoutMarkdownNode(props)}>{renderChildren(children)}</h4>,
    h4: ({ children, ...props }) => <h4 {...withoutMarkdownNode(props)}>{renderChildren(children)}</h4>,
    p: ({ children, ...props }) => <p {...withoutMarkdownNode(props)}>{renderChildren(children)}</p>,
    li: ({ children, ...props }) => <li {...withoutMarkdownNode(props)}>{renderChildren(children)}</li>,
    th: ({ children, ...props }) => <th {...withoutMarkdownNode(props)}>{renderChildren(children)}</th>,
    td: ({ children, ...props }) => <td {...withoutMarkdownNode(props)}>{renderChildren(children)}</td>,
    blockquote: ({ children, ...props }) => <blockquote {...withoutMarkdownNode(props)}>{renderChildren(children)}</blockquote>,
    table: ({ children, ...props }) => (
      <div className="response-table-scroll" role="region" aria-label="Research data table" tabIndex={0}>
        <table className="response-table" {...withoutMarkdownNode(props)}>{children}</table>
      </div>
    ),
    a: ({ href, children, ...props }) => {
      const safeHref = safeMarkdownHref(href)
      if (!safeHref) return <span>{children}</span>
      const external = /^https?:/i.test(safeHref)
      return (
        <a {...withoutMarkdownNode(props)} href={safeHref} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined}>
          {children}
        </a>
      )
    },
  }

  return (
    <div className={`answer-copy markdown-answer ${className}`.trim()}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {normalization.text}
      </ReactMarkdown>
    </div>
  )
}
