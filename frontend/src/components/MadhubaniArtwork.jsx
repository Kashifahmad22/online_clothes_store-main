import PropTypes from 'prop-types'

const MadhubaniArtwork = ({ variant }) => (
  <svg
    className={`madhubani-art madhubani-art--${variant}`}
    viewBox='0 0 760 220'
    preserveAspectRatio='xMidYMid meet'
    aria-hidden='true'
    focusable='false'
  >
    <g className='madhubani-art__draw' fill='none' stroke='currentColor' strokeWidth='2'>
      <path d='M18 202C70 170 86 122 68 67c34 20 57 53 60 91 19-43 50-67 88-73-20 27-29 54-25 82 20-30 47-46 83-47-19 20-27 44-23 74' />
      <path d='M112 144c-26-18-43-44-48-77 33 16 53 39 61 69 14-30 37-49 70-56-14 26-19 48-15 69' />
      <path d='M48 193c13-23 29-34 47-34 1 17-5 32-19 45m125-41c10-23 25-35 45-36 2 17-3 32-16 46m470 29c-52-32-68-80-50-135-34 20-57 53-60 91-19-43-50-67-88-73 20 27 29 54 25 82-20-30-47-46-83-47 19 20 27 44 23 74' />
      <path d='M648 144c26-18 43-44 48-77-33 16-53 39-61 69-14-30-37-49-70-56 14 26 19 48 15 69' />
      <path d='M712 193c-13-23-29-34-47-34-1 17 5 32 19 45m-125-41c-10-23-25-35-45-36-2 17 3 32 16 46' />
      <path d='M345 195c3-37 15-65 35-84 20 19 32 47 35 84m-58-54c9 5 17 11 23 19 6-8 14-14 23-19m-39-21c6 3 12 7 16 12 4-5 10-9 16-12' />
      <path d='M380 111c-24-21-26-44-5-69 1 19 8 31 19 36 11-5 18-17 19-36 21 25 19 48-5 69m-66 89h76' />
      <path d='M0 216h760M0 8h760' strokeDasharray='2 8' />
    </g>
    <g className='madhubani-art__dots' fill='currentColor'>
      <circle cx='380' cy='14' r='3' />
      <circle cx='380' cy='206' r='3' />
      <circle cx='18' cy='202' r='3' />
      <circle cx='742' cy='202' r='3' />
    </g>
  </svg>
)

MadhubaniArtwork.propTypes = {
  variant: PropTypes.oneOf(['hero', 'footer']).isRequired
}

export default MadhubaniArtwork
