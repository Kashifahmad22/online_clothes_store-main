const MAX_MESSAGES = 8
// Each repeated group must be wider than the widest viewport, otherwise the loop shows a gap.
const MIN_GROUP_CHARACTERS = 320
const SEPARATOR_CHARACTERS = 3
const SECONDS_PER_CHARACTER = 0.2

export const parseAnnouncementMessages = text => {
  if (typeof text !== 'string') return []
  return text
    .split('|')
    .map(message => message.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, MAX_MESSAGES)
}

// Returns null when nothing should render (disabled, missing or empty announcement).
export const buildAnnouncement = announcement => {
  if (!announcement || announcement.enabled !== true) return null
  const messages = parseAnnouncementMessages(announcement.text)
  if (messages.length === 0) return null

  const setCharacters = messages.reduce((total, message) => total + message.length + SEPARATOR_CHARACTERS, 0)
  const repeats = Math.max(1, Math.ceil(MIN_GROUP_CHARACTERS / setCharacters))
  const url = typeof announcement.url === 'string' ? announcement.url.trim() : ''
  const isInternal = url.startsWith('/') && !url.startsWith('//')
  const isExternal = /^https:\/\//i.test(url)

  return {
    messages,
    repeats,
    // Duration scales with track length so the scroll speed is the same for any message length.
    durationSeconds: Math.round(setCharacters * repeats * SECONDS_PER_CHARACTER),
    label: messages.join('. '),
    url: isInternal || isExternal ? url : '',
    isExternal
  }
}
