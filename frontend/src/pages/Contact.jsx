import { Link } from 'react-router-dom'
import { useContext } from 'react'
import { ShopContext } from '../context/ShopContext'
import { getWhatsAppSupportUrl } from '../config/support'

const Contact = () => {
  const { siteSettings } = useContext(ShopContext)
  const { support } = siteSettings
  const whatsappUrl = getWhatsAppSupportUrl(support.whatsapp)
  const hasContact = Boolean(whatsappUrl || support.phone || support.email)

  return (
    <main className='editorial-info-page'>
      <header className='editorial-info-page__heading'>
        <p className='eyebrow'>{siteSettings.brand.publicName}</p>
        <h1>How can we help?</h1>
        <p>For product questions or order assistance, use the support details configured here.</p>
      </header>
      <div className='editorial-info-page__body'>
        <section>
          <h2>Contact PSH</h2>
          {whatsappUrl && (
            <a href={whatsappUrl} target='_blank' rel='noreferrer'
              className='button button--wine mt-2'>Message us on WhatsApp</a>
          )}
          {support.phone && <p className='mt-4'><a href={`tel:${support.phone.replace(/[\s()-]/g, '')}`}>{support.phone}</a></p>}
          {support.email && <p className='mt-4'><a href={`mailto:${support.email}`}>{support.email}</a></p>}
          {support.businessHours && <p className='mt-4'>{support.businessHours}</p>}
          {support.description && <p className='mt-4'>{support.description}</p>}
          {!hasContact && (
            <p role='status' className='contact-notice'>
              Customer support contact details are not configured yet.
            </p>
          )}
          <Link to='/orders' className='text-link mt-5'>View your orders <span aria-hidden='true'>↗</span></Link>
        </section>
        <aside className='editorial-info-page__address'>
          <p className='eyebrow'>Explore PSH</p>
          <p>Browse available products and their current options in the live catalogue.</p>
          <Link to='/collection' className='text-link'>Browse the catalogue <span aria-hidden='true'>↗</span></Link>
        </aside>
      </div>
    </main>
  )
}

export default Contact
