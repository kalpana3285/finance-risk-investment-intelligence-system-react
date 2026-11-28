type MarkdownTableRow = { source: string }

export type MarkdownNormalizationDiagnostics = {
  changed: boolean
  headingsRestored: number
  concatenatedRowsSeparated: number
  escapedDelimitersRestored: number
  tableSeparatorsInserted: number
  unevenRowsPadded: number
  malformedTableBlocksPreserved: number
}

export type MarkdownNormalizationResult = {
  text: string
  diagnostics: MarkdownNormalizationDiagnostics
}

type InlineCodeState = { delimiterLength: number }

function isEscaped(value: string, index: number): boolean {
  let slashes = 0
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) slashes += 1
  return slashes % 2 === 1
}

function pipePositions(value: string, includeEscaped = true): number[] {
  const positions: number[] = []
  let inlineCodeLength = 0

  for (let index = 0; index < value.length;) {
    if (value[index] === '`' && !isEscaped(value, index)) {
      let end = index + 1
      while (value[end] === '`') end += 1
      const runLength = end - index
      if (inlineCodeLength === 0) inlineCodeLength = runLength
      else if (inlineCodeLength === runLength) inlineCodeLength = 0
      index = end
      continue
    }
    if (value[index] === '|' && (includeEscaped || !isEscaped(value, index)) && inlineCodeLength === 0) {
      positions.push(index)
    }
    index += 1
  }

  return positions
}

function splitTableRow(source: string): string[] {
  const line = source.replace(/^(\s*)\\\|/, '$1|').trim()
  const delimiters = pipePositions(line, false)
  let start = line.startsWith('|') ? 1 : 0
  let end = line.length
  const lastDelimiter = delimiters.at(-1)
  if (lastDelimiter === end - 1) end -= 1

  const cells: string[] = []
  for (const delimiter of delimiters) {
    if (delimiter <= start || delimiter >= end) continue
    cells.push(line.slice(start, delimiter).trim())
    start = delimiter + 1
  }
  cells.push(line.slice(start, end).trim())
  return cells
}

function isTableRow(line: string): boolean {
  return pipePositions(line).length > 0
}

function isMultilineCellContinuation(line: string): boolean {
  if (!/^\s+\S/.test(line) || /^\s*\\?\|/.test(line)) return false
  return pipePositions(line).length <= 1
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function plainTextTableRow(line: string): string {
  const cells = splitTableRow(line).filter((cell) => !/^:?-{3,}:?$/.test(cell))
  return cells.join(' · ')
}

function splitConcatenatedTableLine(
  line: string,
  diagnostics: MarkdownNormalizationDiagnostics,
): string[] | null {
  const pipes = pipePositions(line)
  const boundaries: Array<[number, number]> = []
  for (let index = 0; index < pipes.length - 1; index += 1) {
    const left = pipes[index]
    const right = pipes[index + 1]
    if (right > left + 1 && /^[ \t]+$/.test(line.slice(left + 1, right))) {
      boundaries.push([left, right])
    }
  }
  if (boundaries.length < 2) return null

  const segments: string[] = []
  let start = 0
  for (const [left, right] of boundaries) {
    segments.push(line.slice(start, left + 1).trim())
    start = right
  }
  segments.push(line.slice(start).trim())

  const separatorIndex = segments.findIndex((segment) => isSeparatorRow(splitTableRow(segment)))
  if (segments.length < 3 || separatorIndex < 0) return null

  const separatorWidth = splitTableRow(segments[separatorIndex]).length
  const hasHeaderOrData = segments.some((segment, index) => (
    index !== separatorIndex && splitTableRow(segment).length >= 2
  ))
  if (!hasHeaderOrData || separatorWidth < 2) return null

  diagnostics.concatenatedRowsSeparated += segments.length - 1
  return segments
}

function splitHeadingBeforeFollowingBlock(
  text: string,
  diagnostics: MarkdownNormalizationDiagnostics,
): string {
  const headingWithBlock = /^([ \t]*#{1,4}[ \t]+.+?)([ \t]+)(?=(?:\\?\||[-*+][ \t]+|\d+[.)][ \t]+|>[ \t]+))/
  const match = text.match(headingWithBlock)
  if (!match) return text
  diagnostics.headingsRestored += 1
  return `${match[1]}\n\n${text.slice(match[0].length)}`
}

function normalizePlainMarkdownSegment(
  text: string,
  diagnostics: MarkdownNormalizationDiagnostics,
): string {
  let result = text.replace(/([ \t]+)(#{1,4}[ \t]+(?=[A-Z]))/g, (_match, _space, heading: string) => {
    diagnostics.headingsRestored += 1
    return `\n\n${heading}`
  })

  const boldLabel = result.match(/^([ \t]*)\*\*([^*\n]{2,80})\*\*([ \t]*)(.*)$/)
  if (
    boldLabel
    && /[A-Z]/.test(boldLabel[2])
    && boldLabel[2] === boldLabel[2].toUpperCase()
  ) {
    result = `${boldLabel[1]}## ${boldLabel[2]}${boldLabel[4] ? `\n\n${boldLabel[4]}` : ''}`
    diagnostics.headingsRestored += 1
  }
  return splitHeadingBeforeFollowingBlock(result, diagnostics)
}

function transformOutsideInlineCode(
  line: string,
  codeState: InlineCodeState,
  diagnostics: MarkdownNormalizationDiagnostics,
): string {
  let output = ''
  let segmentStart = 0
  let index = 0

  while (index < line.length) {
    if (line[index] !== '`' || isEscaped(line, index)) {
      index += 1
      continue
    }

    let end = index + 1
    while (line[end] === '`') end += 1
    const runLength = end - index
    if (codeState.delimiterLength === 0) {
      output += normalizePlainMarkdownSegment(line.slice(segmentStart, index), diagnostics)
      output += line.slice(index, end)
      codeState.delimiterLength = runLength
      segmentStart = end
    } else if (codeState.delimiterLength === runLength) {
      output += line.slice(segmentStart, end)
      codeState.delimiterLength = 0
      segmentStart = end
    }
    index = end
  }

  output += codeState.delimiterLength === 0
    ? normalizePlainMarkdownSegment(line.slice(segmentStart), diagnostics)
    : line.slice(segmentStart)
  return output
}

function preprocessMarkdown(
  markdown: string,
  diagnostics: MarkdownNormalizationDiagnostics,
): string {
  const lines = markdown.match(/[^\n]*\n|[^\n]+$/g) ?? []
  let output = ''
  let fence: { character: string; length: number } | null = null
  const inlineCodeState: InlineCodeState = { delimiterLength: 0 }

  for (const line of lines) {
    const hasNewline = line.endsWith('\n')
    const body = hasNewline ? line.slice(0, -1) : line
    const trimmed = body.trim()
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/)

    if (fence) {
      output += line
      if (
        fenceMatch
        && fenceMatch[1][0] === fence.character
        && fenceMatch[1].length >= fence.length
      ) fence = null
      continue
    }
    if (fenceMatch && inlineCodeState.delimiterLength === 0) {
      fence = { character: fenceMatch[1][0], length: fenceMatch[1].length }
      output += line
      continue
    }

    const normalized = transformOutsideInlineCode(
      body,
      inlineCodeState,
      diagnostics,
    )
    const pieces = normalized.split('\n')
    const outputLines = pieces.flatMap((piece) => splitConcatenatedTableLine(piece, diagnostics) ?? [piece])
    output += outputLines.join('\n')
    if (hasNewline) output += '\n'
  }

  return output
}

function normalizeTable(
  rows: MarkdownTableRow[],
  diagnostics: MarkdownNormalizationDiagnostics,
): string[] {
  const escapedDelimiterCounts = rows.map((row) => {
    const positions = pipePositions(row.source)
    return positions.filter((position) => isEscaped(row.source, position)).length
  })
  const allDelimitersEscaped = rows.every((row) => {
    const trimmed = row.source.trim()
    return trimmed.startsWith('\\|') && trimmed.endsWith('\\|')
  }) && escapedDelimiterCounts[0] >= 3
    && rows.every((row, index) => pipePositions(row.source).length === escapedDelimiterCounts[index])
    && escapedDelimiterCounts.every((count) => count === escapedDelimiterCounts[0])

  if (allDelimitersEscaped) {
    diagnostics.escapedDelimitersRestored += escapedDelimiterCounts.reduce((sum, count) => sum + count, 0)
  } else {
    diagnostics.escapedDelimitersRestored += rows.reduce(
      (sum, row) => sum + (row.source.match(/^\s*\\\|/) ? 1 : 0),
      0,
    )
  }

  const parsed = rows.map((row) => splitTableRow(
    allDelimitersEscaped ? row.source.replace(/\\\|/g, '|') : row.source,
  ))
  const separatorIndex = parsed.findIndex(isSeparatorRow)
  const width = Math.max(...parsed.map((row) => row.length))
  let header: string[]
  let separator: string[]
  let body: string[][]

  if (separatorIndex === 0) {
    header = Array.from({ length: width }, () => '')
    separator = parsed[0]
    body = parsed.slice(1)
  } else {
    header = parsed[0]
    separator = separatorIndex === 1
      ? parsed[1]
      : Array.from({ length: width }, () => '---')
    body = parsed.slice(1).filter((_, index) => index + 1 !== separatorIndex)
    if (separatorIndex !== 1) diagnostics.tableSeparatorsInserted += 1
  }

  if (parsed.some((row) => row.length !== width)) diagnostics.unevenRowsPadded += 1
  header = [...header, ...Array.from({ length: width - header.length }, () => '')]
  separator = [...separator, ...Array.from({ length: width - separator.length }, () => '---')]
  body = body.map((row) => [...row, ...Array.from({ length: width - row.length }, () => '')])

  const format = (cells: string[]) => `| ${cells.join(' | ')} |`
  return [format(header), format(separator), ...body.map(format)]
}

function isBlockBoundary(line: string): boolean {
  const trimmed = line.trim()
  return !trimmed || /^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|```|~~~)/.test(trimmed)
}

export function normalizeAnswerMarkdownWithDiagnostics(
  markdown: string,
): MarkdownNormalizationResult {
  const diagnostics: MarkdownNormalizationDiagnostics = {
    changed: false,
    headingsRestored: 0,
    concatenatedRowsSeparated: 0,
    escapedDelimitersRestored: 0,
    tableSeparatorsInserted: 0,
    unevenRowsPadded: 0,
    malformedTableBlocksPreserved: 0,
  }
  const preprocessed = preprocessMarkdown(markdown, diagnostics)
  const lines = preprocessed.split('\n')
  const normalized: string[] = []
  let index = 0
  let fence: { character: string; length: number } | null = null

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/)
    if (fence) {
      normalized.push(line)
      if (
        fenceMatch
        && fenceMatch[1][0] === fence.character
        && fenceMatch[1].length >= fence.length
      ) fence = null
      index += 1
      continue
    }
    if (fenceMatch) {
      fence = { character: fenceMatch[1][0], length: fenceMatch[1].length }
      normalized.push(line)
      index += 1
      continue
    }

    if (!isTableRow(line)) {
      normalized.push(line)
      index += 1
      continue
    }

    const candidateRows: MarkdownTableRow[] = []
    let cursor = index
    while (cursor < lines.length && isTableRow(lines[cursor])) {
      candidateRows.push({ source: lines[cursor] })
      cursor += 1

      while (
        cursor < lines.length
        && /^\s+\S/.test(lines[cursor])
        && !isBlockBoundary(lines[cursor])
        && (!isTableRow(lines[cursor]) || isMultilineCellContinuation(lines[cursor]))
      ) {
        const previous = candidateRows[candidateRows.length - 1]
        const cells = splitTableRow(previous.source)
        cells[cells.length - 1] = `${cells.at(-1) ?? ''} ${lines[cursor].trim()}`.trim()
        previous.source = `| ${cells.join(' | ')} |`
        cursor += 1
      }
    }

    const hasSeparator = candidateRows.some((row) => isSeparatorRow(splitTableRow(row.source)))
    const rowsUseOuterDelimiters = candidateRows.every((row) => /^\s*\\?\|/.test(row.source))
    if (candidateRows.length >= 2 && (hasSeparator || rowsUseOuterDelimiters)) {
      normalized.push(...normalizeTable(candidateRows, diagnostics))
      index = cursor
    } else {
      if (/^\s*\\?\|/.test(lines[index])) {
        diagnostics.malformedTableBlocksPreserved += 1
        normalized.push(plainTextTableRow(lines[index]))
      } else {
        normalized.push(lines[index])
      }
      index += 1
    }
  }

  const text = normalized.join('\n')
  diagnostics.changed = text !== markdown
  return { text, diagnostics }
}

/** Safely recover common LLM Markdown damage while preserving untouched content. */
export function normalizeAnswerMarkdown(markdown: string): string {
  return normalizeAnswerMarkdownWithDiagnostics(markdown).text
}
