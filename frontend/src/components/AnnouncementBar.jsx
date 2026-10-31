import PropTypes from 'prop-types'
import { Link } from 'react-router-dom'
import { buildAnnouncement } from '../utils/announcement'

const Separator = () => (
  <svg className='announcement-bar__separator' viewBox='0 0 16 16' aria-hidden='true' focusable='false'>
    <path d='M8 0.5 9.6 6.4 15.5 8 9.6 9.6 8 15.5 6.4 9.6 0.5 8 6.4 6.4Z' fill='currentColor' />
    <circle cx='8' cy='8' r='1.5' fill='#35131f' />
  </svg>
)

const Group = ({ messages, repeats }) => (
  <span className='announcement-bar__group'>
    {Array.from({ length: repeats }, (_, repeat) => messages.map((message, index) => (
      <span key={`${repeat}-${index}`} className={`announcement-bar__item${repeat > 0 ? ' announcement-bar__item--repeat' : ''}`}>
        <span>{message}</span>
        <Separator />
      </span>
    )))}
  </span>
)

const AnnouncementBar = ({ announcement, pending = false }) => {
  // Reserve the compact bar height (invisible, no skeleton) until settings settle, so the page does not jump.
  if (pending) return <div className='announcement-bar-placeholder' data-testid='announcement-placeholder' aria-hidden='true' />

  const model = buildAnnouncement(announcement)
  if (!model) return null

  // Only the screen-reader text is exposed; both visual groups are decorative duplicates.
  const content = (
    <>
      <span className='sr-only'>{model.label}{model.isExternal ? ' (opens in a new tab)' : ''}</span>
      <span className='announcement-bar__track' aria-hidden='true' style={{ '--marquee-duration': `${model.durationSeconds}s` }}>
        <Group messages={model.messages} repeats={model.repeats} />
        <Group messages={model.messages} repeats={model.repeats} />
      </span>
    </>
  )

  return (
    <div className='announcement-bar' data-testid='announcement-bar'>
      {model.url ? (
        model.isExternal
          ? <a href={model.url} className='announcement-bar__viewport' target='_blank' rel='noopener noreferrer'>{content}</a>
          : <Link to={model.url} className='announcement-bar__viewport'>{content}</Link>
      ) : (
        <div className='announcement-bar__viewport'>{content}</div>
      )}
    </div>
  )
}

Group.propTypes = {
  messages: PropTypes.arrayOf(PropTypes.string).isRequired,
  repeats: PropTypes.number.isRequired
}

AnnouncementBar.propTypes = {
  pending: PropTypes.bool,
  announcement: PropTypes.shape({
    enabled: PropTypes.bool,
    text: PropTypes.string,
    url: PropTypes.string
  })
}

export default AnnouncementBar
