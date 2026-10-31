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
        <p>The Art of Indian Ethnic Wear.</p>
      </header>
      <div className='editorial-info-page__body'>
        <section>
          <h2>Indian style, thoughtfully presented</h2>
          <p>
            PSH is an online destination for sarees and ethnic wear. Explore the current catalogue,
            compare available product information, and choose from the options listed for each item.
            Product photographs, prices, specifications and availability are shown from the live catalogue.
          </p>
          <p>{brand.description}</p>
          {checkout.codAvailable && <p>Cash on delivery is available at checkout.</p>}
          {!checkout.prepaidAvailable && <p>Online payment is not available yet.</p>}
          <Link to='/collection' className='button button--wine mt-5'>Explore the collection</Link>
        </section>
        <aside className='editorial-info-page__address'>
          <p className='eyebrow'>The PSH edit</p>
          <p>Sarees lead our collection today, with suits, suit sets, dresses and more categories planned as the catalogue grows.</p>
          <Link to='/contact' className='text-link'>Contact PSH <span aria-hidden='true'>↗</span></Link>
        </aside>
      </div>
    </main>
  )
}

export default About
