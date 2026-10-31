import { useContext, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ShopContext } from '../context/ShopContext';
import axios from 'axios';
import { toast } from 'react-toastify';

const Login = () => {

  const [currentState, setCurrentState] = useState('Login');
  const { token, setToken, navigate, backendUrl } = useContext(ShopContext)
  const location = useLocation()

  const [name,setName] = useState('')
  const [password,setPassword] = useState('')
  const [email,setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const onSubmitHandler = async (event) => {
      event.preventDefault();
      if (submitting) return
      setSubmitting(true)
      try {
        if (currentState === 'Sign Up') {
          
          const response = await axios.post(backendUrl + '/api/user/register',{name,email,password})
          if (response.data.success) {
            setToken(response.data.token)
            localStorage.setItem('token',response.data.token)
          } else {
            throw new Error(response.data.message || 'Unable to create your account.')
          }

        } else {

          const response = await axios.post(backendUrl + '/api/user/login', {email,password})
          if (response.data.success) {
            setToken(response.data.token)
            localStorage.setItem('token',response.data.token)
          } else {
            throw new Error(response.data.message || 'Unable to sign in.')
          }

        }


      } catch (error) {
        toast.error(error.response?.data?.message || error.message || 'Unable to complete sign in.')
      } finally {
        setSubmitting(false)
      }
  }

  useEffect(()=>{
    if (token) {
      navigate(location.state?.from === '/place-order' ? '/place-order' : '/')
    }
  },[token,location.state,navigate])

  return (
    <form onSubmit={onSubmitHandler} className='mx-auto mt-12 flex w-[90%] flex-col items-center gap-4 text-stone-800 sm:mt-16 sm:max-w-96'>
        <div className='mb-2 inline-flex items-center gap-2'>
            <p className='font-serif text-3xl text-rose-950'>{currentState}</p>
            <hr className='h-[1.5px] w-8 border-none bg-amber-500' />
        </div>
        {currentState === 'Login' ? null : <input onChange={event => setName(event.target.value)} value={name}
          type='text' maxLength={120} autoComplete='name'
          className='w-full rounded-sm border border-stone-300 px-3 py-3' placeholder='Name' required />}
        <input onChange={event => setEmail(event.target.value)} value={email} type='email' maxLength={254}
          autoComplete='email' className='w-full rounded-sm border border-stone-300 px-3 py-3' placeholder='Email' required />
        <input onChange={event => setPassword(event.target.value)} value={password} type='password'
          autoComplete={currentState === 'Login' ? 'current-password' : 'new-password'}
          className='w-full rounded-sm border border-stone-300 px-3 py-3' placeholder='Password' required />
        <div className='w-full text-right text-sm'>
          <button type='button' onClick={() => setCurrentState(state => state === 'Login' ? 'Sign Up' : 'Login')}
            className='text-rose-900 underline underline-offset-2'>
            {currentState === 'Login' ? 'Create account' : 'Already have an account? Sign in'}
          </button>
        </div>
        <button disabled={submitting} className='mt-4 min-h-12 bg-rose-950 px-8 py-3 font-semibold text-white hover:bg-rose-900 disabled:opacity-60'>
          {submitting ? 'Please wait…' : currentState === 'Login' ? 'Sign in' : 'Create account'}
        </button>
    </form>
  )
}

export default Login
