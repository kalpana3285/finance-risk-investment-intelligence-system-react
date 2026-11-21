import './ResearchResponse.css'

export type Citation = {
  source_id: string
  source_title: string
  source_version?: string | null
  evidence_type: string
  excerpt?: string | null
  page_number?: number | null
  section?: string | null
  record_reference?: string | null
  source_url?: string | null
}

type Props = {
  answer?: string | null
  citations: Citation[]
  limitations: string[]
}

type TableAlignment = 'left' | 'center' | 'right'

type AnswerBlock =
  | { kind: 'heading'; level: number; text: string; id: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; start: number; items: string[] }
  | { kind: 'table'; headers: string[]; rows: string[][]; alignments: TableAlignment[] }
  | { kind: 'quote'; text: string }
  | { kind: 'rule' }

const isHeading = (line: string) => /^#{1,3}\s+/.test(line)
const isUnorderedItem = (line: string) => /^\s*[-*]\s+/.test(line)
const isOrderedItem = (line: string) => /^\s*\d+[.)]\s+/.test(line)

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
}

function isTableStart(lines: string[], index: number): boolean {
  return Boolean(
    lines[index]?.includes('|') &&
    lines[index + 1]?.includes('|') &&
    splitTableRow(lines[index + 1]).every((cell) => /^:?-{3,}:?$/.test(cell)),
  )
}

function parseAnswer(answer: string): AnswerBlock[] {
  const lines = answer.replace(/\r\n/g, '\n').split('\n')
  const blocks: AnswerBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index].trim()
    if (!line) {
      index += 1
      continue
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      const id = `response-heading-${blocks.length}`
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2], id })
      index += 1
      continue
    }

    if (isTableStart(lines, index)) {
      const headers = splitTableRow(lines[index])
      const separators = splitTableRow(lines[index + 1])
      const alignments = separators.map((cell): TableAlignment => {
        if (cell.startsWith(':') && cell.endsWith(':')) return 'center'
        if (cell.endsWith(':')) return 'right'
        return 'left'
      })
      const rows: string[][] = []
      index += 2
      while (index < lines.length && lines[index].trim().includes('|')) {
        rows.push(splitTableRow(lines[index]))
        index += 1
      }
      blocks.push({ kind: 'table', headers, rows, alignments })
      continue
    }

    if (isUnorderedItem(line) || isOrderedItem(line)) {
      const ordered = isOrderedItem(line)
      const firstNumber = ordered ? Number(line.match(/^\d+/)?.[0] ?? 1) : 1
      const items: string[] = []
      while (index < lines.length) {
        const item = lines[index].trim()
        if (ordered ? !isOrderedItem(item) : !isUnorderedItem(item)) break
        items.push(item.replace(ordered ? /^\d+[.)]\s+/ : /^[-*]\s+/, ''))
        index += 1
      }
      blocks.push({ kind: 'list', ordered, start: firstNumber, items })
      continue
    }

    if (line.startsWith('>')) {
      const quote: string[] = []
      while (index < lines.length && lines[index].trim().startsWith('>')) {
        quote.push(lines[index].trim().replace(/^>\s?/, ''))
        index += 1
      }
      blocks.push({ kind: 'quote', text: quote.join(' ') })
      continue
    }

    if (/^(---+|\*\*\*+)$/.test(line)) {
      blocks.push({ kind: 'rule' })
      index += 1
      continue
    }

    const paragraph: string[] = []
    while (
      index < lines.length &&
      lines[index].trim() &&
      !isHeading(lines[index].trim()) &&
      !isUnorderedItem(lines[index]) &&
      !isOrderedItem(lines[index]) &&
      !isTableStart(lines, index) &&
      !lines[index].trim().startsWith('>') &&
      !/^(---+|\*\*\*+)$/.test(lines[index].trim())
    ) {
      paragraph.push(lines[index].trim())
      index += 1
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') })
  }

  return blocks
}

function renderInline(text: string, citations: Citation[]) {
  const tokens = text.split(/(\[\d+\]|\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean)

  return tokens.map((token, index) => {
    const citationMatch = token.match(/^\[(\d+)\]$/)
    if (citationMatch) {
      const sourceIndex = Number(citationMatch[1]) - 1
      if (sourceIndex < 0 || sourceIndex >= citations.length) return token
      const label = `Source ${sourceIndex + 1}`
      return (
        <button
          className="inline-citation"
          type="button"
          key={`citation-${sourceIndex}-${index}`}
          aria-label={`Open ${label}: ${citations[sourceIndex].source_title}`}
          aria-controls={`citation-evidence-${sourceIndex}`}
          onClick={() => {
            const details = document.getElementById(`citation-evidence-${sourceIndex}`)
            if (details instanceof HTMLDetailsElement) {
              details.open = true
              details.scrollIntoView({ behavior: 'smooth', block: 'center' })
              details.querySelector('summary')?.focus()
            }
          }}
        >
          [{label}]
        </button>
      )
    }
    if (token.startsWith('**') && token.endsWith('**')) {
      return <strong key={`bold-${index}`}>{token.slice(2, -2)}</strong>
    }
    if (token.startsWith('*') && token.endsWith('*')) {
      return <em key={`italic-${index}`}>{token.slice(1, -1)}</em>
    }
    return token
  })
}

function safeSourceUrl(value?: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

export default function ResearchResponse({ answer, citations, limitations }: Props) {
  const blocks = answer ? parseAnswer(answer) : []
  const headings = blocks.filter((block) => block.kind === 'heading')
  const isLong = (answer?.length ?? 0) > 900 || headings.length >= 4
  const summary = isLong
    ? blocks.find((block) => block.kind === 'paragraph')
    : undefined

  return (
    <>
      {summary?.kind === 'paragraph' && (
        <section className="executive-summary" aria-label="Executive summary">
          <span className="summary-mark" aria-hidden="true">✦</span>
          <div>
            <span className="eyebrow">EXECUTIVE SUMMARY</span>
            <p>{renderInline(summary.text, citations)}</p>
          </div>
        </section>
      )}

      {isLong && headings.length >= 4 && (
        <details className="response-toc">
          <summary>On this page <span>{headings.length} sections</span></summary>
          <nav aria-label="Response sections">
            {headings.map((heading) => (
              <a href={`#${heading.id}`} key={heading.id}>
                {renderInline(heading.text, citations)}
              </a>
            ))}
          </nav>
        </details>
      )}

      {answer && (
        <div className="answer-copy">
          {blocks.map((block, index) => {
            if (block.kind === 'heading') {
              const content = renderInline(block.text, citations)
              if (block.level === 1) return <h2 id={block.id} key={block.id}>{content}</h2>
              if (block.level === 2) return <h3 id={block.id} key={block.id}>{content}</h3>
              return <h4 id={block.id} key={block.id}>{content}</h4>
            }
            if (block.kind === 'paragraph') {
              return <p key={`paragraph-${index}`}>{renderInline(block.text, citations)}</p>
            }
            if (block.kind === 'list') {
              const List = block.ordered ? 'ol' : 'ul'
              return (
                <List key={`list-${index}`} start={block.ordered ? block.start : undefined}>
                  {block.items.map((item, itemIndex) => (
                    <li key={`list-item-${index}-${itemIndex}`}>{renderInline(item, citations)}</li>
                  ))}
                </List>
              )
            }
            if (block.kind === 'table') {
              return (
                <div className="response-table-scroll" key={`table-${index}`} role="region" aria-label="Research data table" tabIndex={0}>
                  <table className="response-table">
                    <thead>
                      <tr>{block.headers.map((header, cellIndex) => <th key={cellIndex} scope="col" style={{ textAlign: block.alignments[cellIndex] }}>{renderInline(header, citations)}</th>)}</tr>
                    </thead>
                    <tbody>
                      {block.rows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {block.headers.map((_, cellIndex) => (
                            <td key={cellIndex} style={{ textAlign: block.alignments[cellIndex] }}>
                              {renderInline(row[cellIndex] ?? '', citations)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }
            if (block.kind === 'quote') return <blockquote key={`quote-${index}`}>{renderInline(block.text, citations)}</blockquote>
            return <hr className="answer-rule" key={`rule-${index}`} />
          })}
        </div>
      )}

      {citations.length > 0 && (
        <section className="evidence-section" aria-labelledby="supporting-evidence-title">
          <div className="evidence-heading">
            <h3 id="supporting-evidence-title">Supporting evidence</h3>
            <span>{citations.length} {citations.length === 1 ? 'source' : 'sources'}</span>
          </div>
          <div className="citation-list">
            {citations.map((citation, index) => {
              const sourceUrl = safeSourceUrl(citation.source_url)
              return (
                <details
                  className="citation-details"
                  id={`citation-evidence-${index}`}
                  key={`${citation.source_id}-${index}`}
                >
                  <summary>
                    <span className="source-label">Source {index + 1}</span>
                    <strong>{citation.source_title}</strong>
                    <span className="citation-chevron" aria-hidden="true">⌄</span>
                  </summary>
                  <div className="citation-detail-body">
                    <div className="citation-meta">
                      {citation.evidence_type.replaceAll('_', ' ')}
                      {citation.source_version ? ` · Version ${citation.source_version}` : ''}
                      {citation.page_number ? ` · Page ${citation.page_number}` : ''}
                      {citation.section ? ` · ${citation.section}` : ''}
                    </div>
                    {citation.excerpt && <blockquote>{citation.excerpt}</blockquote>}
                    {sourceUrl && <a className="source-link" href={sourceUrl} target="_blank" rel="noreferrer">Open source ↗</a>}
                  </div>
                </details>
              )
            })}
          </div>
        </section>
      )}

      {limitations.length > 0 && (
        <details className="response-limitations">
          <summary>
            <span>Limitations &amp; data gaps</span>
            <span className="limitation-count">{limitations.length}</span>
          </summary>
          <ul>{limitations.map((item, index) => <li key={index}>{item}</li>)}</ul>
        </details>
      )}
    </>
  )
}
