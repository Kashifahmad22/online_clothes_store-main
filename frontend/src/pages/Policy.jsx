import PropTypes from 'prop-types'
import { Link } from 'react-router-dom'
import { useContext } from 'react'
import { ShopContext } from '../context/ShopContext'
import { policyPages } from '../config/policies'
import { parsePolicyText } from '../utils/policyFormat'

const Policy = ({ policyKey }) => {
  const { siteSettings, siteSettingsError, siteSettingsLoaded } = useContext(ShopContext)
  const page = policyPages.find(item => item.key === policyKey)
  const text = (siteSettings.policies?.[policyKey] || '').trim()
  const contact = siteSettings.support || {}
  const loading = !siteSettingsLoaded && !siteSettingsError

  return (
    <main className='editorial-info-page policy-page'>
      <header className='editorial-info-page__heading'>
        <p className='eyebrow'>{siteSettings.brand.publicName}</p>
        <h1>{page.label}</h1>
        <p>{page.description}</p>
      </header>
      <div className='editorial-info-page__body policy-page__body'>
        <section aria-live='polite'>
          {loading && <p role='status'>Loading…</p>}
          {!loading && text && parsePolicyText(text).map((block, index) => {
            if (block.type === 'heading') return <h2 key={index} className='policy-page__heading'>{block.text}</h2>
            if (block.type === 'list') {
              const List = block.ordered ? 'ol' : 'ul'
              return <List key={index} className='policy-page__list'>{block.items.map((item, i) => <li key={i}>{item}</li>)}</List>
            }
            return <p key={index} className='policy-page__paragraph'>{block.text}</p>
          })}
          {!loading && !text && siteSettingsError && (
            <p role='alert'>
              This policy could not be loaded right now. Please refresh the page or try again shortly.
            </p>
          )}
          {!loading && !text && !siteSettingsError && (
            <p role='status'>
              This policy has not been published yet. Please contact the store for details before placing an order.
            </p>
          )}
        </section>
        <aside className='editorial-info-page__address'>
          <p className='eyebrow'>Other policies</p>
          <ul className='footer-links'>
            {policyPages.filter(item => item.key !== policyKey).map(item => (
              <li key={item.key}><Link to={item.path}>{item.label}</Link></li>
            ))}
          </ul>
          {(contact.email || contact.phone) && <p className='eyebrow'>Questions?</p>}
          {contact.email && <p><a href={`mailto:${contact.email}`}>{contact.email}</a></p>}
          {contact.phone && <p>{contact.phone}</p>}
        </aside>
      </div>
    </main>
  )
}

Policy.propTypes = { policyKey: PropTypes.oneOf(['privacy', 'terms', 'shipping', 'returns']).isRequired }

export default Policy
