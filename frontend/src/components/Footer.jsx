import PropTypes from 'prop-types'
import { Link } from 'react-router-dom'
import { campaigns } from '../config/campaigns'
import { useContext } from 'react'
import { ShopContext } from '../context/ShopContext'
import { policyPages } from '../config/policies'
import { getWhatsAppSupportUrl } from '../config/support'
import { catalogueState, storefrontNavigation } from '../config/productCategories'
import MadhubaniArtwork from './MadhubaniArtwork'

const FooterLink = ({ link }) => link.url.startsWith('/')
  ? <Link to={link.url}>{link.label}</Link>
  : <a href={link.url} target='_blank' rel='noreferrer'>{link.label}</a>

const Footer = () => {
  const { products, productsLoading, productsError, siteSettings, siteSettingsError } = useContext(ShopContext)
  const { brand, legal, support, shipping, checkout } = siteSettings
  const activeCampaigns = campaigns.filter(campaign =>
    products.some(product => (product.collections || []).includes(campaign.collectionTag))
  )
  const whatsappUrl = getWhatsAppSupportUrl(support.whatsapp)
  const shopLinks = siteSettings.footerLinks.filter(link => link.group === 'shop')
  const supportLinks = siteSettings.footerLinks.filter(link => link.group === 'support')
  const configuredPolicyLinks = siteSettings.footerLinks.filter(link => link.group === 'policies')
  const configuredPolicyUrls = new Set(configuredPolicyLinks.map(link => link.url))
  const policyLinks = [
    ...policyPages.filter(page => !configuredPolicyUrls.has(page.path))
      .map(page => ({ label: page.label, url: page.path })),
    ...configuredPolicyLinks
  ]
  const categories = storefrontNavigation(products, catalogueState({ productsLoading, productsError }))
  const listedShopUrls = new Set(shopLinks.map(link => link.url))
  const availableCategoryLinks = categories.filter(category =>
    category.status === 'upcoming' || !listedShopUrls.has(`/category/${category.slug}`))
  const hasLegalDetails = Boolean(legal.businessName || legal.gstin || legal.registeredAddress ||
    legal.sellerInformation || legal.grievanceContact)

  return (
  <footer className='site-footer'>
    {brand.footerArtwork === 'madhubani' && <MadhubaniArtwork variant='footer' />}
    <div className={`footer-main ${policyLinks.length ? '' : 'footer-main--no-policies'}`}>
      <div className='footer-brand'>
        <Link to='/' className='footer-brand__lockup'>
          {brand.logoUrl ? <img src={brand.logoUrl} alt='' /> : <span className='brand-lockup__mark'>PSH</span>}
          <span>{brand.publicName}</span>
        </Link>
        {brand.tagline && <p className='footer-brand__tagline'>{brand.tagline}</p>}
        {brand.description && <p className='mt-3'>{brand.description}</p>}
        {support.description && <p className='mt-3'>{support.description}</p>}
        {siteSettings.socialLinks.length > 0 && (
          <ul className='footer-links footer-social-links'>
            {siteSettings.socialLinks.map(link => <li key={`${link.label}-${link.url}`}><FooterLink link={link} /></li>)}
          </ul>
        )}
      </div>
      <div>
        <h2 className='footer-heading'>Shop</h2>
        <ul className='footer-links'>
          {shopLinks.map(link => <li key={`${link.label}-${link.url}`}><FooterLink link={link} /></li>)}
          {availableCategoryLinks.map(category => (
            <li key={category.slug}>
              {category.status === 'upcoming'
                ? <span className='footer-links__upcoming'>{category.label}<span className='sr-only'> – </span><span className='coming-soon-badge'>Coming soon</span></span>
                : <Link to={`/category/${category.slug}`}>{category.label}</Link>}
            </li>
          ))}
          {activeCampaigns.map(campaign => (
            <li key={campaign.slug}><Link to={`/collections/${campaign.slug}`}>{campaign.name} collection</Link></li>
          ))}
        </ul>
      </div>
      <div>
        <h2 className='footer-heading'>Customer support</h2>
        <ul className='footer-links'>
          {supportLinks.map(link => <li key={`${link.label}-${link.url}`}><FooterLink link={link} /></li>)}
          {support.phone && <li><a href={`tel:${support.phone.replace(/[\s()-]/g, '')}`}>Call {support.phone}</a></li>}
          {support.email && <li><a href={`mailto:${support.email}`}>{support.email}</a></li>}
          {whatsappUrl && <li><a href={whatsappUrl} target='_blank' rel='noreferrer'>WhatsApp</a></li>}
          {support.businessHours && <li className='footer-hours'>{support.businessHours}</li>}
        </ul>
      </div>
      {policyLinks.length > 0 && (
        <div>
          <h2 className='footer-heading'>Policies &amp; information</h2>
          <ul className='footer-links'>
            {policyLinks.map(link => <li key={`${link.label}-${link.url}`}><FooterLink link={link} /></li>)}
          </ul>
        </div>
      )}
      <div>
        <h2 className='footer-heading'>Seller information</h2>
        <ul className='footer-links'>
          {hasLegalDetails && (
            <li className='footer-legal'>
              {legal.businessName && <span>Seller: {legal.businessName}</span>}
              {legal.gstin && <span>GSTIN: {legal.gstin}</span>}
              {legal.registeredAddress && <span>{legal.registeredAddress}</span>}
              {legal.sellerInformation && <span>{legal.sellerInformation}</span>}
              {legal.grievanceContact && <span>Grievance contact: {legal.grievanceContact}</span>}
            </li>
          )}
        </ul>
        {shipping.message && <p className='footer-factual-note'>{shipping.message}</p>}
        {checkout.codAvailable && <p className='footer-factual-note'>Cash on delivery is available at checkout.</p>}
        {!checkout.prepaidAvailable && <p className='footer-factual-note'>Online payment is not available yet.</p>}
      </div>
    </div>
    <div className='footer-bottom'>
      <span>© {new Date().getFullYear()} {brand.publicName}</span>
    </div>
    {siteSettingsError && <p role='status' className='footer-settings-notice'>Some store details could not be loaded.</p>}
  </footer>
  )
}

FooterLink.propTypes = {
  link: PropTypes.shape({
    label: PropTypes.string.isRequired,
    url: PropTypes.string.isRequired
  }).isRequired
}

export default Footer
