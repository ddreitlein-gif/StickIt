// Tiny custom markdown renderer for StickIt Help.
// Supports: H2 (##), H3 (###), H4 (####), paragraphs, ul (-/*), ol (1.), **bold**,
// *italic*, `code`, > blockquote, --- horizontal rule, [text](url) links,
// fenced code blocks (```...```), and simple pipe tables.
// No external dependency.

import { Link } from 'react-router-dom'

function renderInline(text, keyPrefix = '') {
  // Process inline markers: code (highest precedence), bold, italic, links
  const parts = []
  let i = 0
  let key = 0
  while (i < text.length) {
    // Inline code
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1)
      if (end !== -1) {
        parts.push(
          <code key={`${keyPrefix}-c-${key++}`} className="help-inline-code">
            {text.slice(i + 1, end)}
          </code>
        )
        i = end + 1
        continue
      }
    }
    // Link [text](url)
    if (text[i] === '[') {
      const closeBracket = text.indexOf(']', i + 1)
      if (closeBracket !== -1 && text[closeBracket + 1] === '(') {
        const closeParen = text.indexOf(')', closeBracket + 2)
        if (closeParen !== -1) {
          const linkText = text.slice(i + 1, closeBracket)
          const url = text.slice(closeBracket + 2, closeParen)
          const isInternal = url.startsWith('./') || url.startsWith('/help')
          if (isInternal) {
            const to = url.startsWith('./') ? `/help/${url.slice(2)}` : url
            parts.push(
              <Link key={`${keyPrefix}-l-${key++}`} to={to} className="help-link">
                {renderInline(linkText, `${keyPrefix}-li-${key}`)}
              </Link>
            )
          } else {
            parts.push(
              <a key={`${keyPrefix}-a-${key++}`} href={url} target="_blank" rel="noopener noreferrer" className="help-link">
                {renderInline(linkText, `${keyPrefix}-li-${key}`)}
              </a>
            )
          }
          i = closeParen + 1
          continue
        }
      }
    }
    // Bold **text**
    if (text[i] === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2)
      if (end !== -1) {
        parts.push(
          <strong key={`${keyPrefix}-b-${key++}`} className="help-bold">
            {renderInline(text.slice(i + 2, end), `${keyPrefix}-bi-${key}`)}
          </strong>
        )
        i = end + 2
        continue
      }
    }
    // Italic *text*
    if (text[i] === '*') {
      const end = text.indexOf('*', i + 1)
      if (end !== -1 && end !== i + 1) {
        parts.push(
          <em key={`${keyPrefix}-i-${key++}`} className="help-italic">
            {renderInline(text.slice(i + 1, end), `${keyPrefix}-ii-${key}`)}
          </em>
        )
        i = end + 1
        continue
      }
    }
    // Plain character — accumulate into a text node
    let next = i + 1
    while (next < text.length && !['`', '[', '*'].includes(text[next])) next++
    parts.push(text.slice(i, next))
    i = next
  }
  return parts
}

function parseTable(lines, startIdx) {
  // Detect | a | b | header, | --- | --- | separator, then body rows.
  const header = lines[startIdx]
  const sep = lines[startIdx + 1]
  if (!sep || !/^\s*\|?\s*:?-+/.test(sep)) return null
  const cells = (line) => line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim())
  const headers = cells(header)
  const rows = []
  let i = startIdx + 2
  while (i < lines.length && lines[i].trim().startsWith('|')) {
    rows.push(cells(lines[i]))
    i++
  }
  return { headers, rows, consumed: i - startIdx }
}

export default function MarkdownRenderer({ source }) {
  if (!source) return null
  const lines = source.split('\n')
  const blocks = []
  let i = 0
  let blockKey = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // Skip blank lines
    if (!trimmed) {
      i++
      continue
    }

    // Fenced code block ```...```
    if (trimmed.startsWith('```')) {
      const codeLines = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      blocks.push(
        <pre key={`b-${blockKey++}`} className="help-code-block">
          <code>{codeLines.join('\n')}</code>
        </pre>
      )
      i++ // skip closing ```
      continue
    }

    // Horizontal rule
    if (/^-{3,}$|^\*{3,}$/.test(trimmed)) {
      blocks.push(<hr key={`b-${blockKey++}`} className="help-hr" />)
      i++
      continue
    }

    // Headings
    if (trimmed.startsWith('#### ')) {
      blocks.push(
        <h4 key={`b-${blockKey++}`} className="help-h4">
          {renderInline(trimmed.slice(5), `b-${blockKey}`)}
        </h4>
      )
      i++
      continue
    }
    if (trimmed.startsWith('### ')) {
      blocks.push(
        <h3 key={`b-${blockKey++}`} className="help-h3">
          {renderInline(trimmed.slice(4), `b-${blockKey}`)}
        </h3>
      )
      i++
      continue
    }
    if (trimmed.startsWith('## ')) {
      blocks.push(
        <h2 key={`b-${blockKey++}`} className="help-h2">
          {renderInline(trimmed.slice(3), `b-${blockKey}`)}
        </h2>
      )
      i++
      continue
    }
    if (trimmed.startsWith('# ')) {
      blocks.push(
        <h1 key={`b-${blockKey++}`} className="help-h1">
          {renderInline(trimmed.slice(2), `b-${blockKey}`)}
        </h1>
      )
      i++
      continue
    }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      const quoteLines = []
      while (i < lines.length && lines[i].trim().startsWith('> ')) {
        quoteLines.push(lines[i].trim().slice(2))
        i++
      }
      blocks.push(
        <blockquote key={`b-${blockKey++}`} className="help-blockquote">
          {renderInline(quoteLines.join(' '), `b-${blockKey}`)}
        </blockquote>
      )
      continue
    }

    // Pipe table
    if (trimmed.startsWith('|')) {
      const table = parseTable(lines, i)
      if (table) {
        blocks.push(
          <div key={`b-${blockKey++}`} className="help-table-wrap">
            <table className="help-table">
              <thead>
                <tr>
                  {table.headers.map((h, hi) => (
                    <th key={hi}>{renderInline(h, `b-${blockKey}-h-${hi}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td key={ci}>{renderInline(cell, `b-${blockKey}-r-${ri}-${ci}`)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
        i += table.consumed
        continue
      }
    }

    // Ordered list 1. item
    if (/^\d+\.\s/.test(trimmed)) {
      const items = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        const itemText = lines[i].trim().replace(/^\d+\.\s+/, '')
        const itemLines = [itemText]
        i++
        // continuation lines (indented)
        while (i < lines.length && lines[i].startsWith('   ') && !/^\d+\.\s/.test(lines[i].trim())) {
          itemLines.push(lines[i].trim())
          i++
        }
        items.push(itemLines.join(' '))
      }
      blocks.push(
        <ol key={`b-${blockKey++}`} className="help-ol">
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it, `b-${blockKey}-li-${idx}`)}</li>
          ))}
        </ol>
      )
      continue
    }

    // Unordered list -/* item
    if (/^[-*]\s/.test(trimmed)) {
      const items = []
      while (i < lines.length && /^[-*]\s/.test(lines[i].trim())) {
        const itemText = lines[i].trim().replace(/^[-*]\s+/, '')
        const itemLines = [itemText]
        i++
        while (i < lines.length && lines[i].startsWith('  ') && !/^[-*]\s/.test(lines[i].trim())) {
          itemLines.push(lines[i].trim())
          i++
        }
        items.push(itemLines.join(' '))
      }
      blocks.push(
        <ul key={`b-${blockKey++}`} className="help-ul">
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it, `b-${blockKey}-li-${idx}`)}</li>
          ))}
        </ul>
      )
      continue
    }

    // Default: paragraph (gather consecutive non-blank, non-special lines)
    const paraLines = [line]
    i++
    while (i < lines.length) {
      const l = lines[i]
      const t = l.trim()
      if (!t) break
      if (t.startsWith('#') || t.startsWith('> ') || t.startsWith('|') ||
          t.startsWith('```') || /^[-*]\s/.test(t) || /^\d+\.\s/.test(t) ||
          /^-{3,}$|^\*{3,}$/.test(t)) break
      paraLines.push(l)
      i++
    }
    blocks.push(
      <p key={`b-${blockKey++}`} className="help-p">
        {renderInline(paraLines.join(' '), `b-${blockKey}`)}
      </p>
    )
  }

  return <>{blocks}</>
}
