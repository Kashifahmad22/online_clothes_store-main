import { useEffect, useLayoutEffect, useState } from 'react'
import Navbar from './components/Navbar'
import Sidebar from './components/Sidebar'
import { Routes, Route } from 'react-router-dom'
import Add from './pages/Add'
import List from './pages/List'
import Orders from './pages/Orders'
import PaymentExceptions from './pages/PaymentExceptions'
import Settings from './pages/Settings'
import Login from './components/Login'
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import axios from 'axios'
import { readAdminToken, shouldEndSession, writeAdminToken } from './utils/adminSession'

export const backendUrl = import.meta.env.VITE_BACKEND_URL
export const currency = '₹'

const App = () => {

  const [token, setToken] = useState(readAdminToken);

  useEffect(()=>{
    writeAdminToken(token)
  },[token])

  // An expired or rejected admin token on any API call returns the user to the sign-in screen.
  // Layout effects run before child pages' fetch effects, so the very first request is covered.
  useLayoutEffect(() => {
    const id = axios.interceptors.response.use(response => response, error => {
      if (shouldEndSession(error)) {
        setToken('')
        toast.error('Your admin session has ended. Please sign in again.', { toastId: 'session-ended' })
      }
      return Promise.reject(error)
    })
    return () => axios.interceptors.response.eject(id)
  }, [])

  return (
    <div className='bg-gray-50 min-h-screen'>
      <ToastContainer />
      {token === ""
        ? <Login setToken={setToken} />
        : <>
          <Navbar setToken={setToken} />
          <hr />
          <div className='flex w-full'>
            <Sidebar />
            <div className='w-[70%] min-w-0 mx-auto ml-[max(5vw,25px)] my-8 text-gray-600 text-base'>
              <Routes>
                <Route path='/add' element={<Add token={token} />} />
                <Route path='/list' element={<List token={token} />} />
                <Route path='/orders' element={<Orders token={token} />} />
                <Route path='/payment-exceptions' element={<PaymentExceptions token={token} />} />
                <Route path='/settings' element={<Settings token={token} />} />
              </Routes>
            </div>
          </div>
        </>
      }
    </div>
  )
}

export default App