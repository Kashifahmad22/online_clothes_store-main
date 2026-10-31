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
import Policy from './pages/Policy'
import { policyPages } from './config/policies'
import { applyPageMeta, buildPageMeta, normaliseSiteUrl } from './utils/seo'
import { ShopContext } from './context/ShopContext'

const PageMetadata = () => {
  const { pathname } = useLocation()
  const { siteSettings } = useContext(ShopContext)
  const brandName = siteSettings.brand.publicName
  const description = siteSettings.brand.description
  const siteUrl = normaliseSiteUrl(siteSettings.siteUrl) || window.location.origin
  useEffect(() => {
    if (pathname.startsWith('/product/')) return
    applyPageMeta(document, buildPageMeta({
      pathname, brandName, description, siteUrl, image: siteSettings.brand.logoUrl || ''
    }), brandName)
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
  }, [brandName, description, pathname, siteUrl, siteSettings.brand.logoUrl, siteSettings.legal.businessName,
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
          {policyPages.map(page => (
            <Route key={page.key} path={page.path} element={<Policy policyKey={page.key} />} />
          ))}
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
