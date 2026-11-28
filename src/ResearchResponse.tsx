import { lazy, Suspense, useEffect, useState } from 'react'
import { normalizeAnswerMarkdown } from './normalizeAnswerMarkdown'
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

export type AnswerContent = {
  status: 'success' | 'partial' | 'insufficient_data' | 'requires_human_review'
  question: string
  executive_summary: string
  answer: string
  key_findings: { title: string; description: string; importance: 'low' | 'medium' | 'high'; citation_indices: number[] }[]
  metrics: { name: string; value: string; unit?: string | null; period?: string | null; description?: string | null; citation_indices: number[] }[]
  risks_and_considerations: { title: string; description: string; severity: string; citation_indices: number[] }[]
  confidence: 'low' | 'medium' | 'high' | 'unknown'
}

type Props = {
  answer?: string | null
  answerContent?: AnswerContent | null
  sessionId?: string | null
  traceId?: string | null
  traceUrl?: string | null
  requestStatus?: string | null
  citations: Citation[]
  limitations: string[]
  onFollowUp?: (prompt: string) => void
}

const MarkdownAnswerRenderer = lazy(() => import('./MarkdownAnswerRenderer'))

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

function resolveTraceHref(traceId?: string | null, traceUrl?: string | null): string | null {
  if (!traceId || !/^[a-f\d]{32}$/i.test(traceId) || !traceUrl) return null
  try {
    const url = new URL(traceUrl)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null
    if (!url.pathname.endsWith(`/traces/${traceId}`)) return null
    return url.href
  } catch {
    return null
  }
}

function TraceLink({ href }: { href: string | null }) {
  if (!href) return null
  return (
    <a
      className="langfuse-trace-link"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title="Open this request's trace in Langfuse"
      aria-label="View Trace in Langfuse (opens in a new tab)"
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false">
        <path d="M6 3H3.75A1.75 1.75 0 0 0 2 4.75v7.5A1.75 1.75 0 0 0 3.75 14h7.5A1.75 1.75 0 0 0 13 12.25V10M8 2h6v6m-.5-5.5L7 9" />
      </svg>
      View Trace in Langfuse
    </a>
  )
}

export default function ResearchResponse({ answer, answerContent, sessionId, traceId, traceUrl, requestStatus, citations, limitations, onFollowUp }: Props) {
  const structured = answerContent ?? null
  const traceHref = requestStatus && requestStatus !== 'completed'
    ? null
    : resolveTraceHref(traceId, traceUrl)
  const normalizedAnswer = answer ? normalizeAnswerMarkdown(answer) : ''
  const blocks = !structured && answer ? parseAnswer(normalizedAnswer) : []
  const headings = blocks.filter((block) => block.kind === 'heading')
  const isLong = structured ? false : (answer?.length ?? 0) > 900 || headings.length >= 4
  const hasTabs = isLong && Boolean(answer)
  const firstContentIndex = blocks.findIndex((block) => block.kind !== 'heading')
  const overview = firstContentIndex >= 0 ? blocks[firstContentIndex] : undefined
  const overviewMarkdown = overview?.kind === 'paragraph' ? overview.text : normalizedAnswer
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

  const markdownAnswer = (text: string, className = '') => (
    <Suspense fallback={<div className="answer-copy" role="status">Preparing formatted answer…</div>}>
    <MarkdownAnswerRenderer
        text={text}
        className={className}
        renderText={(value) => renderInline(value, citations, onOpenCitation)}
      />
    </Suspense>
  )

  const legacyAnswerContent = answer && !structured ? (
    markdownAnswer(answer)
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
      {traceHref && (
        <div className="response-trace-meta">
          {sessionId && <span className="trace-session-meta">Session {sessionId}</span>}
          <TraceLink href={traceHref} />
        </div>
      )}
      {!answer && !structured && citations.length === 0 && limitations.length === 0 && (
        <p className="response-empty">No written answer or supporting evidence was returned.</p>
      )}
      {structured && (
        <div className="structured-answer">
          <h2 className="structured-question">{structured.question}</h2>
          <div className={`answer-status status-${structured.status}`}>
            <span aria-hidden="true">●</span>
            {structured.status === 'success' ? 'Research complete' : structured.status.replaceAll('_', ' ')}
            <span className="confidence-label">Confidence: {structured.confidence}</span>
          </div>
          <section className="executive-summary" aria-labelledby="structured-summary-title">
            <span className="summary-mark" aria-hidden="true">✦</span>
            <div className="executive-summary-content">
              <span className="eyebrow" id="structured-summary-title">EXECUTIVE SUMMARY</span>
              {markdownAnswer(structured.executive_summary)}
            </div>
          </section>
          {structured.metrics.length > 0 && (
            <section className="structured-section" aria-labelledby="structured-metrics-title">
              <h3 id="structured-metrics-title">Key metrics</h3>
              <div className="structured-metric-grid">
                {structured.metrics.map((metric, index) => (
                  <article className="structured-metric-card" key={`${metric.name}-${index}`}>
                    <span>{metric.name}</span>
                    <strong>{metric.value}{metric.unit ? ` ${metric.unit}` : ''}</strong>
                    {(metric.period || metric.description) && <small>{[metric.period, metric.description].filter(Boolean).join(' · ')}</small>}
                    {metric.citation_indices.map((citationIndex) => citations[citationIndex] && (
                      <button className="inline-evidence-link" type="button" key={citationIndex} onClick={() => onOpenCitation(citationIndex)}>
                        View supporting citation · {citations[citationIndex].source_title || `Source ${citationIndex + 1}`}
                      </button>
                    ))}
                  </article>
                ))}
              </div>
            </section>
          )}
          {structured.answer && <section className="structured-section"><h3>Detailed answer</h3>{markdownAnswer(structured.answer)}</section>}
          {structured.key_findings.length > 0 && (
            <section className="structured-section" aria-labelledby="structured-findings-title">
              <h3 id="structured-findings-title">Key findings</h3>
              <div className="finding-list">
                {structured.key_findings.map((finding, index) => (
                  <article className="finding-card" key={`${finding.title}-${index}`}>
                    <span className={`importance importance-${finding.importance}`}>{finding.importance}</span>
                    <h4>{finding.title}</h4><p>{finding.description}</p>
                    {finding.citation_indices.filter((citationIndex) => citations[citationIndex]).map((citationIndex) => {
                      const citation = citations[citationIndex]
                      return <details className="finding-evidence" key={citationIndex}>
                        <summary>View supporting citation</summary>
                        <strong>{citation.source_title || `Source ${citationIndex + 1}`}{citation.page_number ? ` · Page ${citation.page_number}` : ''}</strong>
                        {citation.excerpt && <blockquote>{citation.excerpt}</blockquote>}
                      </details>
                    })}
                  </article>
                ))}
              </div>
            </section>
          )}
          {structured.risks_and_considerations.length > 0 && <section className="structured-section"><h3>Risks and considerations</h3><div className="finding-list">{structured.risks_and_considerations.map((risk, index) => <article className="finding-card" key={`${risk.title}-${index}`}><span className={`importance importance-${risk.severity}`}>{risk.severity}</span><h4>{risk.title}</h4><p>{risk.description}</p>{risk.citation_indices.filter((citationIndex) => citations[citationIndex]).map((citationIndex) => <button className="inline-evidence-link" type="button" key={citationIndex} onClick={() => onOpenCitation(citationIndex)}>View supporting citation · {citations[citationIndex].source_title || `Source ${citationIndex + 1}`}</button>)}</article>)}</div></section>}
        </div>
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
              overview ? (
                <section className="executive-summary" aria-label="Response overview">
                  <span className="summary-mark" aria-hidden="true">✦</span>
                  <div>
                    <div className="overview-header">
                      <span className="eyebrow">RESPONSE OVERVIEW</span>
                    </div>
                    {markdownAnswer(overviewMarkdown)}
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
                {legacyAnswerContent}
              </>
            )}
            {activeTab === 'evidence'
              ? evidenceContent
              : evidenceContent && <div hidden>{evidenceContent}</div>}
          </div>
        </section>
      ) : (
        <>
          {legacyAnswerContent}
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
