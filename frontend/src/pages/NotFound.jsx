import { useContext, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ShopContext } from '../context/ShopContext'

// A single-page app cannot send an HTTP 404, so the page tells crawlers not to index the unknown URL.
const NotFound = () => {
  const { siteSettings } = useContext(ShopContext)
  const brandName = siteSettings.brand.publicName

  useEffect(() => {
    const previousTitle = document.title
    document.title = `Page not found | ${brandName}`
    let robots = document.head.querySelector('meta[name="robots"]')
    const created = !robots
    const previousContent = robots?.getAttribute('content')
    if (!robots) {
      robots = document.createElement('meta')
      robots.setAttribute('name', 'robots')
      document.head.appendChild(robots)
    }
    robots.setAttribute('content', 'noindex')
    return () => {
      document.title = previousTitle
      if (created) robots.remove()
      else if (previousContent === null) robots.removeAttribute('content')
      else robots.setAttribute('content', previousContent)
    }
  }, [brandName])

  return (
    <main className='shopping-page' data-testid='not-found'>
      <header className='shopping-heading'>
        <p className='eyebrow'>{brandName}</p>
        <h1>Page not found</h1>
      </header>
      <div className='catalogue-empty'>
        <p>We could not find the page you were looking for. It may have moved, or the link may be incorrect.</p>
        <p className='mt-4 flex flex-wrap justify-center gap-3'>
          <Link to='/' className='button button--wine'>Back to home</Link>
          <Link to='/category/sarees' className='button button--wine'>Shop sarees</Link>
          <Link to='/collection' className='button button--wine'>Browse all products</Link>
        </p>
      </div>
    </main>
  )
}

export default NotFound
