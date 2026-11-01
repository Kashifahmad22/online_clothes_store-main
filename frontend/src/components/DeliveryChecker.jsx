import { useState } from 'react'
import PropTypes from 'prop-types'
import axios from 'axios'

const PIN_PATTERN = /^[1-9]\d{5}$/
const PIN_STORAGE_KEY = 'psh.deliveryPin'

const readSavedPin = () => {
  try {
    const saved = window.sessionStorage.getItem(PIN_STORAGE_KEY) || ''
    return PIN_PATTERN.test(saved) ? saved : ''
  } catch {
    return ''
  }
}
const savePin = pin => { try { window.sessionStorage.setItem(PIN_STORAGE_KEY, pin) } catch { /* storage unavailable */ } }

const formatDay = iso => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })

// Only the server's answer is shown. An estimate appears solely when the courier provider returned one.
const describeResult = result => {
  if (result.status === 'serviceable') {
    const { from, to } = result.estimate || {}
    return {
      tone: 'ok',
      heading: 'Delivery is available to this PIN code.',
      detail: from && to
        ? `Courier estimate: ${from === to ? formatDay(from) : `${formatDay(from)} – ${formatDay(to)}`}. This is an estimate, not a guaranteed date.`
        : 'The delivery date will be confirmed before dispatch.'
    }
  }
  if (result.status === 'not_serviceable') {
    return { tone: 'bad', heading: 'Delivery is not available to this PIN code.', detail: '' }
  }
  if (result.status === 'manual_confirmation') {
    return {
      tone: 'neutral',
      heading: 'Delivery to this PIN code needs manual confirmation.',
      detail: 'We will confirm availability and the delivery date after you order. No delivery date is promised yet.'
    }
  }
  return { tone: 'neutral', heading: 'We could not check delivery right now.', detail: 'Please try again shortly.' }
}

const DeliveryChecker = ({ backendUrl }) => {
  const [pin, setPin] = useState(readSavedPin)
  const [state, setState] = useState({ phase: 'idle', result: null, error: '' })

  const check = async event => {
    event.preventDefault()
    if (state.phase === 'loading') return
    if (!PIN_PATTERN.test(pin)) {
      setState({ phase: 'invalid', result: null, error: 'Enter a valid 6-digit PIN code.' })
      return
    }
    setState({ phase: 'loading', result: null, error: '' })
    try {
      const response = await axios.get(`${backendUrl}/api/delivery/check`, { params: { pincode: pin } })
      const data = response.data
      if (!data?.success) throw new Error('failed')
      savePin(pin)
      setState({ phase: 'done', result: data, error: '' })
    } catch (error) {
      const data = error?.response?.data
      if (data?.status === 'unavailable') {
        setState({ phase: 'done', result: data, error: '' })
      } else {
        setState({ phase: 'error', result: null, error: 'We could not check delivery right now. Please try again shortly.' })
      }
    }
  }

  const view = state.phase === 'done' ? describeResult(state.result) : null
  const toneClass = { ok: 'text-green-800', bad: 'text-red-800', neutral: 'text-stone-700' }

  return (
    <section className='delivery-checker mt-6 border border-stone-200 p-4' aria-labelledby='delivery-checker-heading'>
      <h2 id='delivery-checker-heading' className='text-sm font-semibold text-stone-900'>Check delivery</h2>
      <form className='mt-2 flex gap-2' onSubmit={check} noValidate>
        <input type='text' inputMode='numeric' maxLength={6} autoComplete='postal-code' aria-label='Delivery PIN code'
          placeholder='6-digit PIN code' value={pin}
          aria-invalid={state.phase === 'invalid'}
          className='h-11 min-w-0 flex-1 border border-stone-300 bg-white px-3 text-sm'
          onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))} />
        <button type='submit' disabled={state.phase === 'loading'}
          className='min-h-11 border border-rose-950 bg-white px-4 text-sm font-semibold text-rose-950 disabled:opacity-50'>
          {state.phase === 'loading' ? 'Checking…' : 'Check'}
        </button>
      </form>
      <div role='status' aria-live='polite' className='mt-2 text-sm'>
        {state.phase === 'loading' && <p>Checking delivery…</p>}
        {(state.phase === 'invalid' || state.phase === 'error') && <p role='alert' className='text-red-800'>{state.error}</p>}
        {view && (
          <p className={toneClass[view.tone]}>
            <strong>{view.heading}</strong>{view.detail ? ` ${view.detail}` : ''}
          </p>
        )}
      </div>
    </section>
  )
}

DeliveryChecker.propTypes = { backendUrl: PropTypes.string.isRequired }

export default DeliveryChecker
