import PropTypes from 'prop-types'
import { confirmLeave } from '../utils/unsavedChanges'

const Navbar = ({setToken}) => {
  return (
    <div className='flex items-center py-2 px-[4%] justify-between'>
        <div className='flex items-center gap-3'>
          <span className='grid h-10 w-10 place-items-center bg-[#35131f] font-serif text-sm tracking-wider text-[#f2ece2]'>PSH</span>
          <div>
            <p className='font-medium text-gray-900'>PSH Sarees & Ethnic Wear</p>
            <p className='text-xs text-gray-500'>Store administration</p>
          </div>
        </div>
        <button onClick={()=>{ if (confirmLeave()) setToken('') }} className='bg-gray-600 text-white px-5 py-2 sm:px-7 sm:py-2 rounded-full text-xs sm:text-sm'>Logout</button>
    </div>
  )
}

export default Navbar

Navbar.propTypes = {
  setToken: PropTypes.func.isRequired
}