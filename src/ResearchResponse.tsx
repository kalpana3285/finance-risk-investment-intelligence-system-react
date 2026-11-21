import { useEffect, useState } from 'react'
import './ResearchResponse.css'

export type Citation = {
  source_id?: string | null
  source_title?: string | null
  source_version?: string | null
  evidence_type?: string | null
  excerpt?: string | null
  page_number?: number | null
  section?: string | null
  record_reference?: string | null
}

type Props = {
  answer?: string | null
  citations: Citation[]
  limitations: string[]
  onFollowUp?: (prompt: string) => void
}

type TableAlignment = 'left' | 'center' | 'right'

type AnswerBlock =
  | { kind: 'heading'; level: number; text: string; id: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; start: number; items: string[] }
  | { kind: 'table'; headers: string[]; rows: string[][]; alignments: TableAlignment[] }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; content: string }
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
  const trimmedAnswer = answer.trim()
  if (trimmedAnswer.startsWith('{') || trimmedAnswer.startsWith('[')) {
    try {
      JSON.parse(trimmedAnswer)
      return [{ kind: 'code', content: answer }]
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
    }
  }

  const lines = answer.replace(/\r\n/g, '\n').split('\n')
  const blocks: AnswerBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index].trim()
    if (!line) {
      index += 1
      continue
    }

    if (line.startsWith('```')) {
      const code: string[] = []
      index += 1
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        code.push(lines[index])
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push({ kind: 'code', content: code.join('\n') })
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

function humanizeIdentifiers(text: string): string {
  return text.replace(/\b[a-z][a-z\d]*(?:_[a-z\d]+)+\b/gi, (identifier) =>
    identifier.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' '),
  )
}

function citationReferenceIndex(reference: string, citations: Citation[]): number {
  const normalized = reference.toLowerCase()
  const identifierMatches = citations.flatMap((citation, index) => {
    const identifiers = [citation.source_id, citation.record_reference]
      .filter((value): value is string => Boolean(value))
    return identifiers.some((identifier) => normalized.includes(identifier.toLowerCase())) ? [index] : []
  })
  if (identifierMatches.length > 0) {
    return identifierMatches.length === 1 ? identifierMatches[0] : -1
  }
  if (/\b(?:chunk|document|source|record|citation|id)[_-]?[a-z\d]+/i.test(reference)) return -1

  const pageMatches = citations.flatMap((citation, index) =>
    citation.page_number != null && new RegExp(`\\bpage[_ -]*${citation.page_number}\\b`, 'i').test(reference)
      ? [index]
      : [],
  )
  return pageMatches.length === 1 ? pageMatches[0] : -1
}

function openCitationDetails(sourceIndex: number) {
  const details = document.getElementById(`citation-evidence-${sourceIndex}`)
  if (details instanceof HTMLDetailsElement) {
    details.open = true
    details.scrollIntoView({ behavior: 'smooth', block: 'center' })
    details.querySelector('summary')?.focus()
  }
}

function renderCitationButton(
  sourceIndex: number,
  citations: Citation[],
  key: string,
  onOpenCitation: (index: number) => void,
) {
  const label = `Source ${sourceIndex + 1}`
  const sourceTitle = citations[sourceIndex].source_title || 'Supporting source'
  return (
    <button
      className="inline-citation"
      type="button"
      key={key}
      aria-label={`Open ${label}: ${sourceTitle}`}
      aria-controls={`citation-evidence-${sourceIndex}`}
      onClick={() => onOpenCitation(sourceIndex)}
    >
      [{label}]
    </button>
  )
}

function renderInline(text: string, citations: Citation[], onOpenCitation: (index: number) => void) {
  const tokens = text.split(/(\[[^\]\n]+\]|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).filter(Boolean)

  return tokens.map((token, index) => {
    const citationMatch = token.match(/^\[([^\]]+)\]$/)
    if (citationMatch) {
      const reference = citationMatch[1].trim()
      if (/^\d+$/.test(reference)) {
        const sourceIndex = Number(reference) - 1
        if (sourceIndex >= 0 && sourceIndex < citations.length) {
          return renderCitationButton(sourceIndex, citations, `citation-${sourceIndex}-${index}`, onOpenCitation)
        }
        return <span className="unresolved-citation" key={`citation-missing-${index}`}>[Source unavailable]</span>
      }
      if (/\b(?:chunk|document|page|source|record|citation|id)[_-]?[a-z\d]+/i.test(reference)) {
        const sourceIndex = citationReferenceIndex(reference, citations)
        if (sourceIndex >= 0) {
          return renderCitationButton(sourceIndex, citations, `citation-${sourceIndex}-${index}`, onOpenCitation)
        }
        return <span className="unresolved-citation" key={`citation-unmatched-${index}`}>[Evidence reference unavailable]</span>
      }
    }
    if (token.startsWith('**') && token.endsWith('**')) {
      return <strong key={`bold-${index}`}>{humanizeIdentifiers(token.slice(2, -2))}</strong>
    }
    if (token.startsWith('*') && token.endsWith('*')) {
      return <em key={`italic-${index}`}>{humanizeIdentifiers(token.slice(1, -1))}</em>
    }
    if (token.startsWith('`') && token.endsWith('`')) {
      return <span className="humanized-inline-code" key={`inline-code-${index}`}>{humanizeIdentifiers(token.slice(1, -1))}</span>
    }
    return humanizeIdentifiers(token)
  })
}

const evidenceTypeLabels: Record<string, string> = {
  account_scope: 'Account access information',
  document: 'Research document',
  policy_document: 'Policy document',
  portfolio_record: 'Portfolio record',
  structured_data: 'Portfolio or market data',
}

function humanizeEvidenceType(value?: string | null): string | null {
  if (!value) return null
  return evidenceTypeLabels[value] ?? humanizeIdentifiers(value).replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export default function ResearchResponse({ answer, citations, limitations, onFollowUp }: Props) {
  const blocks = answer ? parseAnswer(answer) : []
  const headings = blocks.filter((block) => block.kind === 'heading')
  const isLong = (answer?.length ?? 0) > 900 || headings.length >= 4
  const hasTabs = isLong && Boolean(answer)
  const overviewIndex = isLong ? blocks.findIndex((block) => block.kind === 'paragraph') : -1
  const overview = overviewIndex >= 0 ? blocks[overviewIndex] : undefined
  const headingText = headings.map((block) => block.text.toLowerCase()).join(' ')
  const followUps = [
    ...(headingText.includes('risk') ? ['Explain the risk findings discussed.'] : []),
    ...(headingText.includes('market') ? ['Explain the market indicators discussed.'] : []),
    ...(/\b(allocation|exposure)\b/.test(headingText) ? ['Compare the allocations or exposures discussed.'] : []),
    ...(citations.length > 0 ? ['What evidence supports these findings?'] : []),
    ...(limitations.length > 0 ? ['What information is still missing?'] : []),
  ]
  if (answer && followUps.length === 0) followUps.push('Summarize the key findings.')
  const [activeTab, setActiveTab] = useState<'overview' | 'analysis' | 'evidence'>('overview')
  const [pendingCitationIndex, setPendingCitationIndex] = useState<number | null>(null)

  useEffect(() => {
    if (activeTab === 'evidence' && pendingCitationIndex !== null) {
      openCitationDetails(pendingCitationIndex)
    }
  }, [activeTab, pendingCitationIndex])

  const onOpenCitation = (sourceIndex: number) => {
    if (hasTabs) {
      setPendingCitationIndex(sourceIndex)
      setActiveTab('evidence')
    } else {
      openCitationDetails(sourceIndex)
    }
  }

  const answerContent = answer ? (
    <div className="answer-copy">
      {blocks.map((block, index) => {
        if (block.kind === 'heading') {
          const content = renderInline(block.text, citations, onOpenCitation)
          if (block.level === 1) return <h2 id={block.id} key={block.id}>{content}</h2>
          if (block.level === 2) return <h3 id={block.id} key={block.id}>{content}</h3>
          return <h4 id={block.id} key={block.id}>{content}</h4>
        }
        if (block.kind === 'paragraph') {
          return <p key={`paragraph-${index}`}>{renderInline(block.text, citations, onOpenCitation)}</p>
        }
        if (block.kind === 'list') {
          const List = block.ordered ? 'ol' : 'ul'
          return (
            <List key={`list-${index}`} start={block.ordered ? block.start : undefined}>
              {block.items.map((item, itemIndex) => (
                <li key={`list-item-${index}-${itemIndex}`}>{renderInline(item, citations, onOpenCitation)}</li>
              ))}
            </List>
          )
        }
        if (block.kind === 'table') {
          return (
            <div className="response-table-scroll" key={`table-${index}`} role="region" aria-label="Research data table" tabIndex={0}>
              <table className="response-table">
                <thead>
                  <tr>{block.headers.map((header, cellIndex) => <th key={cellIndex} scope="col" style={{ textAlign: block.alignments[cellIndex] }}>{renderInline(header, citations, onOpenCitation)}</th>)}</tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {block.headers.map((_, cellIndex) => (
                        <td key={cellIndex} style={{ textAlign: block.alignments[cellIndex] }}>
                          {renderInline(row[cellIndex] ?? '', citations, onOpenCitation)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
        if (block.kind === 'quote') return <blockquote key={`quote-${index}`}>{renderInline(block.text, citations, onOpenCitation)}</blockquote>
        if (block.kind === 'code') {
          return (
            <details className="technical-details" key={`code-${index}`}>
              <summary>View technical details</summary>
              <pre><code>{block.content}</code></pre>
            </details>
          )
        }
        return <hr className="answer-rule" key={`rule-${index}`} />
      })}
    </div>
  ) : null

  const evidenceContent = citations.length > 0 ? (
    <section className="evidence-section" aria-labelledby="supporting-evidence-title">
      <div className="evidence-heading">
        <h3 id="supporting-evidence-title">Supporting evidence</h3>
        <span>{citations.length} {citations.length === 1 ? 'source' : 'sources'}</span>
      </div>
      <div className="citation-list">
        {citations.map((citation, index) => {
          const citationContext = [
            citation.page_number ? `Page ${citation.page_number}` : null,
            citation.section,
          ].filter(Boolean).join(' · ')
          return (
            <details
              className="citation-details"
              id={`citation-evidence-${index}`}
              key={`${citation.source_id ?? 'source'}-${index}`}
            >
              <summary>
                <span className="source-label">Source {index + 1}</span>
                <strong>{citation.source_title || 'Source title unavailable'}</strong>
                {citationContext && <span className="citation-summary-meta">{citationContext}</span>}
                <span className="citation-chevron" aria-hidden="true">⌄</span>
              </summary>
              <div className="citation-detail-body">
                {humanizeEvidenceType(citation.evidence_type) && (
                  <div className="citation-meta">
                    {humanizeEvidenceType(citation.evidence_type)}
                    {citation.source_version ? ` · Version ${citation.source_version}` : ''}
                    {citation.page_number ? ` · Page ${citation.page_number}` : ''}
                    {citation.section ? ` · ${citation.section}` : ''}
                  </div>
                )}
                {citation.excerpt && (
                  <>
                    <div className="evidence-excerpt-label">Supporting excerpt</div>
                    <blockquote>{citation.excerpt}</blockquote>
                  </>
                )}
              </div>
            </details>
          )
        })}
      </div>
    </section>
  ) : null

  return (
    <>
      {!answer && citations.length === 0 && limitations.length === 0 && (
        <p className="response-empty">No written answer or supporting evidence was returned.</p>
      )}
      {hasTabs ? (
        <section className="research-briefing">
          <div className="response-tabs" role="group" aria-label="Research response views">
            <button type="button" aria-pressed={activeTab === 'overview'} onClick={() => setActiveTab('overview')}>Overview</button>
            <button type="button" aria-pressed={activeTab === 'analysis'} onClick={() => setActiveTab('analysis')}>Full analysis</button>
            {citations.length > 0 && (
              <button type="button" aria-pressed={activeTab === 'evidence'} onClick={() => setActiveTab('evidence')}>
                Evidence <span>{citations.length}</span>
              </button>
            )}
          </div>
          <div className="response-tab-panel" aria-live="polite">
            {activeTab === 'overview' && (
              overview?.kind === 'paragraph' ? (
                <section className="executive-summary" aria-label="Response overview">
                  <span className="summary-mark" aria-hidden="true">✦</span>
                  <div>
                    <span className="eyebrow">RESPONSE OVERVIEW</span>
                    <p>{renderInline(overview.text, citations, onOpenCitation)}</p>
                  </div>
                </section>
              ) : (
                <div className="overview-unavailable">
                  <p>No separate overview was included. The full response is available in the analysis tab.</p>
                  <button type="button" className="text-button" onClick={() => setActiveTab('analysis')}>View full analysis →</button>
                </div>
              )
            )}
            {activeTab === 'analysis' && (
              <>
                {headings.length >= 4 && (
                  <details className="response-toc">
                    <summary>On this page <span>{headings.length} sections</span></summary>
                    <nav aria-label="Response sections">
                      {headings.map((heading) => (
                        <a href={`#${heading.id}`} key={heading.id}>
                          {renderInline(heading.text, citations, onOpenCitation)}
                        </a>
                      ))}
                    </nav>
                  </details>
                )}
                {answerContent}
              </>
            )}
            {activeTab === 'evidence'
              ? evidenceContent
              : evidenceContent && <div hidden>{evidenceContent}</div>}
          </div>
        </section>
      ) : (
        <>
          {answerContent}
          {evidenceContent}
        </>
      )}

      {limitations.length > 0 && (
        <section className="response-limitations" aria-labelledby="response-limitations-title">
          <div className="response-limitations-heading">
            <h3 id="response-limitations-title">Data limitations</h3>
            <span className="limitation-count">{limitations.length}</span>
          </div>
          <ul>{limitations.map((item, index) => <li key={index}>{renderInline(item, citations, onOpenCitation)}</li>)}</ul>
        </section>
      )}
      {answer && onFollowUp && followUps.length > 0 && (
        <section className="follow-up-suggestions" aria-label="Suggested follow-up questions">
          <span>Continue your research</span>
          <div>
            {followUps.map((prompt) => (
              <button type="button" key={prompt} onClick={() => onFollowUp(prompt)}>{prompt}</button>
            ))}
          </div>
        </section>
      )}
    </>
  )
}
