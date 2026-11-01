import { Link } from 'react-router-dom'
import { useContext } from 'react'
import { ShopContext } from '../context/ShopContext'

const About = () => {
  const { siteSettings } = useContext(ShopContext)
  const { brand, checkout } = siteSettings

  return (
    <main className='editorial-info-page'>
      <header className='editorial-info-page__heading'>
        <p className='eyebrow'>{brand.tagline}</p>
        <h1>{brand.publicName}</h1>
      </header>
      <div className='editorial-info-page__body'>
        <section>
          <h2>Indian style, thoughtfully presented</h2>
          <p>
            PSH is an online store for sarees and ethnic wear. Browse the collection, compare product
            details and choose from the options listed for each item. Photographs, prices, specifications
            and availability on every product page come directly from our live catalogue.
          </p>
          <p>{brand.description}</p>
          {checkout.codAvailable && <p>Cash on delivery is available at checkout.</p>}
          {!checkout.prepaidAvailable && <p>Online payment is not available yet.</p>}
          <Link to='/collection' className='button button--wine mt-5'>Explore the collection</Link>
        </section>
        <aside className='editorial-info-page__address'>
          <p className='eyebrow'>The PSH edit</p>
          <p>Sarees lead our collection today. Suits, suit sets and dresses are planned as the catalogue grows.</p>
          <Link to='/contact' className='text-link'>Contact PSH</Link>
        </aside>
      </div>
    </main>
  )
}

export default About
