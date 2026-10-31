import PropTypes from 'prop-types'
import { Link } from 'react-router-dom'
import { getProductImage } from '../utils/productDisplay'
import MadhubaniArtwork from './MadhubaniArtwork'

const Hero = ({ product, brand }) => {
  const image = product ? getProductImage(product) : null

  return (
    <section className='editorial-hero'>
      <div className='editorial-hero__copy'>
        <p className='eyebrow'>PSH Sarees & Ethnic Wear</p>
        <h1>Indian artistry, styled for the way you celebrate.</h1>
        <p className='editorial-hero__description'>
          Explore sarees and ethnic wear with product details shown as provided.
        </p>
        <Link to='/collection' className='button button--gold'>
          Shop now <span aria-hidden='true'>↗</span>
        </Link>
        <span className='editorial-hero__note'>{brand.tagline}</span>
      </div>
      <div className={`editorial-hero__image ${image ? '' : 'editorial-hero__image--fallback'}`}>
        {image ? (
          <img src={image.url} alt={image.altText || product.name} />
        ) : (
          <div className='editorial-hero__ornament' aria-hidden='true'>
            <span>PSH</span>
          </div>
        )}
        {image && (
          <div className='editorial-hero__image-caption'>
            <span>From our current collection</span>
            <span aria-hidden='true'>✳</span>
          </div>
        )}
        <MadhubaniArtwork variant='hero' />
      </div>
    </section>
  )
}

Hero.propTypes = {
  brand: PropTypes.shape({
    tagline: PropTypes.string.isRequired
  }).isRequired,
  product: PropTypes.shape({
    name: PropTypes.string,
    images: PropTypes.arrayOf(PropTypes.shape({
      url: PropTypes.string,
      role: PropTypes.string,
      altText: PropTypes.string,
      order: PropTypes.number
    }))
  })
}

export default Hero
