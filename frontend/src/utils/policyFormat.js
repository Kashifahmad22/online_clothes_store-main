const BULLET = /^\s*(?:[-*•–]|\d{1,2}[.)])\s+/
const ORDERED = /^\s*\d{1,2}[.)]\s+/

const isHeading = (lines, isLast) => {
  if (lines.length !== 1 || isLast) return false
  const line = lines[0].trim()
  if (line.length > 70 || BULLET.test(line)) return false
  if (line.endsWith(':')) return true
  const letters = line.replace(/[^A-Za-z]/g, '')
  if (letters.length >= 3 && line === line.toUpperCase()) return true
  return !/[.,;!?]$/.test(line) && line.length <= 60
}

// Turns stored plain text into typed blocks. Output is data only and is rendered as React text, never as HTML.
export const parsePolicyText = text => {
  const blocks = String(text || '').split(/\n\s*\n/).map(block => block.split('\n').map(line => line.trimEnd()).filter(line => line.trim())).filter(lines => lines.length)
  return blocks.map((lines, index) => {
    if (lines.every(line => BULLET.test(line))) {
      return {
        type: 'list',
        ordered: lines.every(line => ORDERED.test(line)),
        items: lines.map(line => line.replace(BULLET, '').trim())
      }
    }
    if (isHeading(lines, index === blocks.length - 1)) {
      return { type: 'heading', text: lines[0].trim().replace(/:$/, '') }
    }
    return { type: 'paragraph', text: lines.join('\n') }
  })
}
