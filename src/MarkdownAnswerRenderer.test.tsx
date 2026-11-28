import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import MarkdownAnswerRenderer from './MarkdownAnswerRenderer'
import ResearchResponse from './ResearchResponse'

afterEach(cleanup)

describe('MarkdownAnswerRenderer', () => {
  it('renders readable GFM structure, nested lists, tables, and citations', () => {
    const answer = [
      '# Portfolio overview',
      '',
      'Equities are **the largest allocation** with *reported* exposure [1].',
      '',
      '- Main finding',
      '  - Supporting detail',
      '1. First action',
      '2. Second action',
      '',
      '| Asset | Weight |',
      '|:--|--:|',
      '| Equities | 68.4% |',
      '',
      '> Source data is limited to the selected report.',
      '',
      '`allocation_percentage`',
      '',
      '```text\nVerified source excerpt\n```',
      '',
      'See [the report](https://example.com/report).',
      '',
      '---',
    ].join('\n')

    render(
      <MarkdownAnswerRenderer
        text={answer}
        renderText={(text) => text.split(/(\[1\])/g).map((part) => (
          part === '[1]' ? <button type="button" key="citation">Evidence 1</button> : part
        ))}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Portfolio overview', level: 2 })).toBeTruthy()
    expect(screen.getByText('the largest allocation').tagName).toBe('STRONG')
    expect(screen.getByText('reported').tagName).toBe('EM')
    expect(screen.getByText('Supporting detail').closest('ul')).toBeTruthy()
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getByRole('cell', { name: '68.4%' })).toBeTruthy()
    expect(screen.getByText('Source data is limited to the selected report.').closest('blockquote')).toBeTruthy()
    expect(screen.getByText('Verified source excerpt').closest('pre')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Evidence 1' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'the report' }).getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.getByRole('separator')).toBeTruthy()
    expect(document.querySelector('[node]')).toBeNull()
  })

  it('does not render raw HTML or activate unsafe links', () => {
    render(
      <MarkdownAnswerRenderer
        text={'<img src=x onerror="alert(1)" />\n\n[unsafe](javascript:alert(1))'}
        renderText={(text) => text}
      />,
    )

    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByText('unsafe').closest('a')).toBeNull()
    expect(screen.getByText('unsafe')).toBeTruthy()
  })

  it('formats overview and full analysis while keeping citations connected to evidence', async () => {
    const longAnswer = [
      '## Summary',
      '',
      'Equities are **68.4%** of the portfolio [1].',
      '',
      '## Allocation detail',
      '',
      '| Asset class | Allocation |',
      '| --- | ---: |',
      '| Equities | 68.4% |',
      '',
      '## Risk notes',
      '',
      '> Based on the supplied portfolio statement.',
      '',
      '## Limitations',
      '',
      'The report does not include historical returns.',
    ].join('\n')
    const citation = {
      source_id: 'source-1',
      source_title: 'Portfolio allocation statement',
      page_number: 8,
      excerpt: 'Equities: 68.4% of total allocation.',
    }
    render(<ResearchResponse answer={longAnswer} citations={[citation]} limitations={[]} />)

    expect(await screen.findByRole('button', { name: 'Open Source 1: Portfolio allocation statement' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Overview' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Full analysis' }))
    expect(await screen.findByRole('table')).toBeTruthy()
    HTMLElement.prototype.scrollIntoView = () => undefined
    fireEvent.click(screen.getByRole('button', { name: 'Open Source 1: Portfolio allocation statement' }))
    expect([...document.querySelectorAll<HTMLDetailsElement>('#citation-evidence-0')].some((details) => details.open)).toBe(true)
    expect(screen.getByText('Equities: 68.4% of total allocation.')).toBeTruthy()
  })

  it('repairs a leading escaped table delimiter and renders overview and risk headings', async () => {
    const response = String.raw`**RESPONSE OVERVIEW**
\| --- | --- | --- | --- |
\| Minimum geographic regions | 3 distinct geographic regions | Portfolios above $50M | Required geographic diversification |
\| Non-base currency exposure cap | 30% percent | — | Limit on non-base currency exposure |
\| Supporting evidence | [1] | Source page | Policy guide |

## Risks and Considerations

- **No per-region exposure caps found (moderate)** — The supplied pages do not state percentage caps [1].`
      + `\n\n## Additional context\n\n${'Additional source context. '.repeat(50)}`
    render(
      <ResearchResponse
        answer={response}
        citations={[{ source_id: 'policy-page-3', source_title: 'Policy guide', page_number: 3 }]}
        limitations={[]}
      />,
    )

    expect(await screen.findByRole('heading', { name: 'RESPONSE OVERVIEW' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Overview' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getByRole('cell', { name: 'Minimum geographic regions' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: '30% percent' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: '[Source 1]' }).querySelector('button.inline-citation')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Risks and Considerations' })).toBeTruthy()
    expect(screen.getByText('No per-region exposure caps found (moderate)').tagName).toBe('STRONG')
    expect((await screen.findAllByRole('button', { name: 'Open Source 1: Policy guide' })).length).toBeGreaterThanOrEqual(2)
  })

  it('keeps plain-text and empty-answer states readable', async () => {
    const { rerender } = render(<ResearchResponse answer="A plain text response." citations={[]} limitations={[]} />)
    expect(await screen.findByText('A plain text response.')).toBeTruthy()

    rerender(<ResearchResponse citations={[]} limitations={[]} />)
    expect(screen.getByText('No written answer or supporting evidence was returned.')).toBeTruthy()
  })

  it('links the displayed response to its matching Langfuse trace securely', async () => {
    const traceId = '0123456789abcdef0123456789abcdef'
    const traceUrl = `https://us.cloud.langfuse.com/project/project-123/traces/${traceId}`
    const answer = `## Response overview\n\nTrace-associated answer.\n\n## Risk details\n\n${'Evidence text. '.repeat(90)}`
    const { rerender } = render(
      <ResearchResponse
        answer={answer}
        traceId={traceId}
        traceUrl={traceUrl}
        requestStatus="completed"
        sessionId="research-session-8"
        citations={[]}
        limitations={[]}
      />,
    )

    const link = await screen.findByRole('link', { name: 'View Trace in Langfuse (opens in a new tab)' })
    expect(link.getAttribute('href')).toBe(traceUrl)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(link.getAttribute('title')).toBe("Open this request's trace in Langfuse")
    expect(screen.getByText('Session research-session-8')).toBeTruthy()
    fireEvent.click(link)
    expect(screen.getByRole('button', { name: 'Overview' }).getAttribute('aria-pressed')).toBe('true')

    const nextTraceId = 'fedcba9876543210fedcba9876543210'
    const selfHostedUrl = `https://langfuse.internal/project/research-prod/traces/${nextTraceId}`
    rerender(
      <ResearchResponse
        answer={answer.replace('Trace-associated', 'Second request')}
        traceId={nextTraceId}
        traceUrl={selfHostedUrl}
        requestStatus="completed"
        sessionId="research-session-9"
        citations={[]}
        limitations={[]}
      />,
    )
    expect((await screen.findByRole('link', { name: 'View Trace in Langfuse (opens in a new tab)' })).getAttribute('href')).toBe(selfHostedUrl)
  })

  it('hides trace navigation for missing, malformed, or failed-response metadata', () => {
    const props = { answer: 'Answer exists.', citations: [], limitations: [] }
    const { rerender } = render(<ResearchResponse {...props} traceUrl="https://cloud.langfuse.com/project/p/traces/0123456789abcdef0123456789abcdef" />)
    expect(screen.queryByRole('link', { name: /View Trace in Langfuse/ })).toBeNull()

    rerender(<ResearchResponse {...props} traceId="invalid-id" traceUrl="https://cloud.langfuse.com/project/p/traces/invalid-id" />)
    expect(screen.queryByRole('link', { name: /View Trace in Langfuse/ })).toBeNull()

    rerender(<ResearchResponse {...props} traceId="" traceUrl="https://cloud.langfuse.com/project/p/traces/0123456789abcdef0123456789abcdef" />)
    expect(screen.queryByRole('link', { name: /View Trace in Langfuse/ })).toBeNull()

    rerender(<ResearchResponse {...props} traceId="0123456789abcdef0123456789abcdef" traceUrl="javascript:alert(1)" />)
    expect(screen.queryByRole('link', { name: /View Trace in Langfuse/ })).toBeNull()

    rerender(<ResearchResponse {...props} answer={null} traceId="0123456789abcdef0123456789abcdef" traceUrl="https://cloud.langfuse.com/project/p/traces/0123456789abcdef0123456789abcdef" />)
    expect(screen.queryByRole('link', { name: /View Trace in Langfuse/ })).toBeNull()

    rerender(<ResearchResponse {...props} requestStatus="failed" traceId="0123456789abcdef0123456789abcdef" traceUrl="https://cloud.langfuse.com/project/p/traces/0123456789abcdef0123456789abcdef" />)
    expect(screen.queryByRole('link', { name: /View Trace in Langfuse/ })).toBeNull()
    rerender(<ResearchResponse {...props} requestStatus="cancelled" traceId="0123456789abcdef0123456789abcdef" traceUrl="https://cloud.langfuse.com/project/p/traces/0123456789abcdef0123456789abcdef" />)
    expect(screen.queryByRole('link', { name: /View Trace in Langfuse/ })).toBeNull()
  })

  it('keeps trace links scoped to each concurrently displayed response', async () => {
    const firstTraceId = '11111111111111111111111111111111'
    const secondTraceId = '22222222222222222222222222222222'
    const longAnswer = `## Overview\n\nAnswer content.\n\n## Findings\n\n${'Evidence. '.repeat(110)}`
    render(
      <>
        <ResearchResponse
          answer={longAnswer.replace('Answer content', 'First answer')}
          traceId={firstTraceId}
          traceUrl={`https://cloud.langfuse.com/project/p-1/traces/${firstTraceId}`}
          requestStatus="completed"
          citations={[]}
          limitations={[]}
        />
        <ResearchResponse
          answer={longAnswer.replace('Answer content', 'Second answer')}
          traceId={secondTraceId}
          traceUrl={`https://selfhosted.example/project/p-2/traces/${secondTraceId}`}
          requestStatus="completed"
          citations={[]}
          limitations={[]}
        />
      </>,
    )

    const links = await screen.findAllByRole('link', { name: 'View Trace in Langfuse (opens in a new tab)' })
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      `https://cloud.langfuse.com/project/p-1/traces/${firstTraceId}`,
      `https://selfhosted.example/project/p-2/traces/${secondTraceId}`,
    ])
  })
})
