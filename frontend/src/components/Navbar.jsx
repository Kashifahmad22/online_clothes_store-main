import { useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { assets } from '../assets/assets'
import { campaigns } from '../config/campaigns'
import { getWhatsAppSupportUrl } from '../config/support'
import { useContext } from 'react'
import { ShopContext } from '../context/ShopContext'
import { availableProductCategories } from '../config/productCategories'

const Navbar = () => {
  const [menuOpen, setMenuOpen] = useState(false)
  const { setShowSearch, getCartCount, navigate, token, setToken, setCartItems, products, siteSettings } = useContext(ShopContext)
  const brand = siteSettings.brand
  const whatsappUrl = getWhatsAppSupportUrl(siteSettings.support.whatsapp)
  const announcementUrl = siteSettings.announcement.url
  const isExternalAnnouncement = /^https:\/\//i.test(announcementUrl)
  const availableCategories = availableProductCategories(products)
  const activeCampaigns = campaigns.filter(campaign =>
    products.some(product => (product.collections || []).includes(campaign.collectionTag))
  )

  const logout = () => {
    navigate('/login')
    localStorage.removeItem('token')
    setToken('')
    setCartItems({})
  }

  const closeMenu = () => setMenuOpen(false)
  const navClass = ({ isActive }) =>
    `nav-link whitespace-nowrap py-2 text-sm font-medium ${isActive ? 'nav-link--active' : ''}`

  return (
    <header className='site-header relative z-40'>
      <div className='announcement-bar'>
        {siteSettings.announcement.enabled && announcementUrl ? (
          isExternalAnnouncement
            ? <a href={announcementUrl} className='announcement-bar__link' target='_blank' rel='noreferrer'>{siteSettings.announcement.text}</a>
            : <Link to={announcementUrl} className='announcement-bar__link'>{siteSettings.announcement.text}</Link>
        ) : (
          <span>{siteSettings.announcement.enabled ? siteSettings.announcement.text : brand.tagline}</span>
        )}
      </div>
      <div className='header-main'>
        <Link to='/' onClick={closeMenu} aria-label={`${brand.publicName} home`} className='brand-lockup min-w-0'>
          {brand.logoUrl
            ? <img src={brand.logoUrl} alt='' className='brand-lockup__image' />
            : <span className='brand-lockup__mark' aria-hidden='true'>PSH</span>}
          <span className='brand-lockup__text'>
            <span className='brand-lockup__name'>{brand.publicName}</span>
            <span className='brand-lockup__place'>{brand.tagline}</span>
          </span>
        </Link>

        <nav aria-label='Main navigation' className='hidden items-center gap-5 lg:flex'>
          <NavLink to='/collection' className={navClass}>Shop all</NavLink>
          {availableCategories.slice(0, 3).map(category => (
            <NavLink key={category.slug} to={`/category/${category.slug}`} className={navClass}>{category.label}</NavLink>
          ))}
          {activeCampaigns.map(campaign => (
            <NavLink key={campaign.slug} to={`/collections/${campaign.slug}`} className={navClass}>{campaign.name}</NavLink>
          ))}
          <NavLink to='/about' className={navClass}>About PSH</NavLink>
        </nav>

        <div className='header-actions'>
          {whatsappUrl && (
            <a href={whatsappUrl} target='_blank' rel='noreferrer'
              className='hidden text-xs font-semibold text-emerald-800 xl:inline'>WhatsApp support</a>
          )}
          <button type='button' onClick={() => { setShowSearch(true); navigate('/collection') }}
            aria-label='Search products' className='header-icon-button'>
            <img src={assets.search_icon} className='h-5 w-5' alt='' />
          </button>
          <button type='button' onClick={() => token ? navigate('/orders') : navigate('/login')}
            aria-label={token ? 'My orders' : 'Sign in'} className='header-icon-button'>
            <img src={assets.profile_icon} className='h-5 w-5' alt='' />
          </button>
          {token && <button type='button' onClick={logout} className='hidden text-xs text-stone-600 xl:block'>Sign out</button>}
          <Link to='/cart' className='header-icon-button relative' aria-label={`Cart, ${getCartCount()} items`}>
            <img src={assets.cart_icon} className='h-5 w-5' alt='' />
            <span className='cart-count'>
              {getCartCount()}
            </span>
          </Link>
          <button type='button' onClick={() => setMenuOpen(true)} aria-label='Open menu'
            className='header-icon-button lg:hidden'>
            <img src={assets.menu_icon} className='h-5 w-5' alt='' />
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className='fixed inset-0 z-50 bg-black/40 lg:hidden' role='presentation' onClick={closeMenu}>
          <nav aria-label='Mobile navigation' className='mobile-menu ml-auto flex h-full w-[min(88vw,24rem)] flex-col gap-1 overflow-y-auto p-5 shadow-xl'
            onClick={event => event.stopPropagation()}>
            <button type='button' onClick={closeMenu} className='mb-3 min-h-11 self-end px-3 text-sm text-stone-700'>Close menu</button>
            <NavLink onClick={closeMenu} to='/collection' className='mobile-menu__link'>Shop all products</NavLink>
            {availableCategories.map(category => (
              <NavLink key={category.slug} onClick={closeMenu} to={`/category/${category.slug}`} className='mobile-menu__link'>
                {category.label}
              </NavLink>
            ))}
            {activeCampaigns.map(campaign => (
              <NavLink key={campaign.slug} onClick={closeMenu} to={`/collections/${campaign.slug}`}
                className='mobile-menu__link'>
                {campaign.name} collection
              </NavLink>
            ))}
            <NavLink onClick={closeMenu} to='/about' className='mobile-menu__link'>About PSH</NavLink>
            <NavLink onClick={closeMenu} to='/contact' className='mobile-menu__link'>Contact</NavLink>
            {token && <button type='button' onClick={() => { logout(); closeMenu() }} className='py-3 text-left text-rose-950'>Sign out</button>}
            {whatsappUrl && <a href={whatsappUrl} target='_blank' rel='noreferrer' className='mt-4 bg-emerald-800 px-4 py-3 text-center text-sm font-semibold text-white'>WhatsApp support</a>}
          </nav>
        </div>
      )}
    </header>
  )
}

export default Navbar
