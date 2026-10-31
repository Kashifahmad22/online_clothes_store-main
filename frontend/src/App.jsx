import { Routes, Route, useLocation } from 'react-router-dom'
import { useContext, useEffect } from 'react'
import Home from './pages/Home'
import Collection from './pages/Collection'
import About from './pages/About'
import Contact from './pages/Contact'
import Product from './pages/Product'
import Cart from './pages/Cart'
import Login from './pages/Login'
import PlaceOrder from './pages/PlaceOrder'
import Orders from './pages/Orders'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import SearchBar from './components/SearchBar'
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import Verify from './pages/Verify'
import { ShopContext } from './context/ShopContext'

const PageMetadata = () => {
  const { pathname } = useLocation()
  const { siteSettings } = useContext(ShopContext)
  const brandName = siteSettings.brand.publicName
  const description = siteSettings.brand.description
  useEffect(() => {
    if (pathname.startsWith('/product/')) return
    const titles = {
      '/': brandName,
      '/collection': `Shop Sarees & Ethnic Wear | ${brandName}`,
      '/about': `About | ${brandName}`,
      '/contact': `Contact | ${brandName}`,
      '/cart': `Shopping Bag | ${brandName}`,
      '/place-order': `Cash on Delivery Checkout | ${brandName}`,
      '/orders': `Your Orders | ${brandName}`,
      '/login': `Sign in | ${brandName}`,
      '/verify': `Online Payment Unavailable | ${brandName}`
    }
    const title = pathname.startsWith('/product/')
      ? `${brandName} | Product details`
      : titles[pathname] || (pathname.startsWith('/collections/')
      ? `${pathname.split('/').pop()} Collection | ${brandName}`
      : pathname.startsWith('/category/')
        ? `${pathname.split('/').pop()} | ${brandName}`
        : brandName)
    document.title = title
    document.querySelector('meta[name="description"]')
      ?.setAttribute('content', description)
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', title)
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', description)
    document.querySelector('meta[property="og:site_name"]')?.setAttribute('content', brandName)
    document.querySelector('meta[property="og:type"]')?.setAttribute('content', 'website')
    document.querySelector('meta[property="og:image"]')?.removeAttribute('content')
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'OnlineStore',
      name: brandName,
      description,
      ...(siteSettings.legal.businessName ? { legalName: siteSettings.legal.businessName } : {}),
      ...(siteSettings.support.phone || siteSettings.support.email ? {
        contactPoint: {
          '@type': 'ContactPoint',
          contactType: 'customer support',
          ...(siteSettings.support.phone ? { telephone: siteSettings.support.phone } : {}),
          ...(siteSettings.support.email ? { email: siteSettings.support.email } : {})
        }
      } : {}),
      ...(siteSettings.socialLinks.length > 0
        ? { sameAs: siteSettings.socialLinks.map(link => link.url) }
        : {})
    }
    let structuredData = document.getElementById('psh-store-structured-data')
    if (!structuredData) {
      structuredData = document.createElement('script')
      structuredData.id = 'psh-store-structured-data'
      structuredData.type = 'application/ld+json'
      document.head.appendChild(structuredData)
    }
    structuredData.textContent = JSON.stringify(schema)
  }, [brandName, description, pathname, siteSettings.legal.businessName,
    siteSettings.socialLinks, siteSettings.support.email, siteSettings.support.phone])
  return null
}

const App = () => {
  return (
    <div className='app-shell'>
      <PageMetadata />
      <ToastContainer />
      <div className='site-top'>
        <Navbar />
        <SearchBar />
      </div>
      <div className='site-content'>
        <Routes>
          <Route path='/' element={<Home />} />
          <Route path='/collection' element={<Collection />} />
          <Route path='/collections/:campaignSlug' element={<Collection mode='campaign' />} />
          <Route path='/category/:categorySlug' element={<Collection mode='category' />} />
          <Route path='/about' element={<About />} />
          <Route path='/contact' element={<Contact />} />
          <Route path='/product/:productId' element={<Product />} />
          <Route path='/cart' element={<Cart />} />
          <Route path='/login' element={<Login />} />
          <Route path='/place-order' element={<PlaceOrder />} />
          <Route path='/orders' element={<Orders />} />
          <Route path='/verify' element={<Verify />} />
        </Routes>
      </div>
      <Footer />
    </div>
  )
}

export default App
