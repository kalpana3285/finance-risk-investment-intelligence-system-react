import { describe, expect, it } from 'vitest'
import { normalizeAnswerMarkdown, normalizeAnswerMarkdownWithDiagnostics } from './normalizeAnswerMarkdown'

describe('normalizeAnswerMarkdown', () => {
  it('repairs escaped structural pipes and moves a leading delimiter below a blank header', () => {
    const raw = String.raw`\| --- | --- | --- |
\| One | Two | Three |`
    expect(normalizeAnswerMarkdown(raw)).toBe(
      '|  |  |  |\n| --- | --- | --- |\n| One | Two | Three |',
    )
  })

  it('normalizes fully escaped delimiters only across consistent table rows', () => {
    const raw = String.raw`\| Header A \| Header B \|
\| Value A \| Value B \|`
    expect(normalizeAnswerMarkdown(raw)).toBe(
      '| Header A | Header B |\n| --- | --- |\n| Value A | Value B |',
    )
  })

  it('inserts a missing separator and pads rows to the widest column count', () => {
    const raw = '| Measure | Value |\n| Equity | 68% | Note |\n| Fixed income | 32% |'
    expect(normalizeAnswerMarkdown(raw)).toBe(
      '| Measure | Value |  |\n| --- | --- | --- |\n| Equity | 68% | Note |\n| Fixed income | 32% |  |',
    )
  })

  it('restores concatenated table rows only when a separator row confirms a table', () => {
    const raw = '| Metric | Value | | --- | --- | | Equities | 68.4% | | Fixed income | 31.6% |'
    const result = normalizeAnswerMarkdownWithDiagnostics(raw)
    expect(result.text).toBe(
      '| Metric | Value |\n| --- | --- |\n| Equities | 68.4% |\n| Fixed income | 31.6% |',
    )
    expect(result.diagnostics.concatenatedRowsSeparated).toBeGreaterThan(0)
  })

  it('restores heading boundaries joined to prose and keeps following table and list sections', () => {
    const raw = [
      'Allocation data: equities 68.4% ## Risks and considerations - **Exposure concentration (moderate)** is based on reported allocation.',
      '| Asset | Weight | | --- | --- | | Equities | 68.4% |',
      '- Review portfolio concentration [1].',
    ].join('\n')
    const normalized = normalizeAnswerMarkdown(raw)
    expect(normalized).toContain('## Risks and considerations')
    expect(normalized).toContain('| Asset | Weight |\n| --- | --- |\n| Equities | 68.4% |')
    expect(normalized).toContain('- Review portfolio concentration [1].')
  })

  it('keeps indented multiline cell text and stops before headings and lists', () => {
    const raw = [
      '| Region | Requirement |',
      '| --- | --- |',
      '| Global | At least three',
      '  distinct regions |',
      '',
      '## Risks and Considerations',
      '- Preserve this list',
    ].join('\n')
    const normalized = normalizeAnswerMarkdown(raw)
    expect(normalized).toContain('| Global | At least three distinct regions |')
    expect(normalized).toContain('## Risks and Considerations')
    expect(normalized).toContain('- Preserve this list')
  })

  it('does not unescape ordinary prose, literal cell pipes, or fenced code', () => {
    const raw = [
      String.raw`Use \| as a literal escaped pipe.`,
      '',
      String.raw`| Expression | Note |`,
      String.raw`| --- | --- |`,
      String.raw`| A \| B | [Source 1] |`,
      '',
      '```text',
      String.raw`\| not a table |`,
      '```',
    ].join('\n')
    const normalized = normalizeAnswerMarkdown(raw)
    expect(normalized).toContain(String.raw`Use \| as a literal escaped pipe.`)
    expect(normalized).toContain(String.raw`| A \| B | [Source 1] |`)
    expect(normalized).toContain(String.raw`\| not a table |`)
  })

  it('leaves plain text without Markdown tables unchanged', () => {
    const plain = 'The report says use A | B as a short notation, without a table.'
    expect(normalizeAnswerMarkdown(plain)).toBe(plain)
  })

  it('keeps an incomplete streamed table prefix readable without inventing data rows', () => {
    const partial = '## Allocation overview\n\n| Asset | Weight |\n| --- |'
    const normalized = normalizeAnswerMarkdownWithDiagnostics(partial)
    expect(normalized.text).toContain('## Allocation overview')
    expect(normalized.text).toContain('| Asset | Weight |\n| --- | --- |')
    expect(normalized.text).not.toContain('|  |')
  })
})
