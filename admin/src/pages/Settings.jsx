import { useCallback, useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { toast } from 'react-toastify'
import PropTypes from 'prop-types'
import { backendUrl } from '../App'

const emptySettings = {
  brand: { publicName: '', tagline: '', description: '', logoUrl: '', footerArtwork: 'madhubani' },
  support: { phone: '', whatsapp: '', email: '', businessHours: '', description: '' },
  legal: { businessName: '', gstin: '', registeredAddress: '', sellerInformation: '', grievanceContact: '' },
  policies: { privacy: '', terms: '', shipping: '', returns: '' },
  footerLinks: [],
  socialLinks: [],
  shipping: { feePaise: 5000, freeShippingThresholdPaise: null, message: '' },
  announcement: { enabled: false, text: '', url: '' },
  upcomingCategories: [],
  checkout: { codAvailable: true, prepaidAvailable: false }
}

const Settings = ({ token }) => {
  const [settings, setSettings] = useState(emptySettings)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [shippingFeeInput, setShippingFeeInput] = useState('50.00')
  const [freeShippingThresholdInput, setFreeShippingThresholdInput] = useState('')
  const savingRef = useRef(false)

  const loadSettings = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const response = await axios.get(`${backendUrl}/api/storefront/admin`, {
        headers: { token }
      })
      if (!response.data.success || !response.data.settings) {
        throw new Error(response.data.message || 'Unable to load storefront settings.')
      }
      setSettings({
        ...emptySettings,
        ...response.data.settings,
        brand: { ...emptySettings.brand, ...response.data.settings.brand },
        support: { ...emptySettings.support, ...response.data.settings.support },
        legal: { ...emptySettings.legal, ...response.data.settings.legal },
        policies: { ...emptySettings.policies, ...response.data.settings.policies },
        shipping: { ...emptySettings.shipping, ...response.data.settings.shipping },
        announcement: { ...emptySettings.announcement, ...response.data.settings.announcement }
      })
      setShippingFeeInput((response.data.settings.shipping.feePaise / 100).toFixed(2))
      setFreeShippingThresholdInput(
        response.data.settings.shipping.freeShippingThresholdPaise == null
          ? ''
          : (response.data.settings.shipping.freeShippingThresholdPaise / 100).toFixed(2)
      )
    } catch (error) {
      const message = error.response?.data?.message || error.message || 'Unable to load storefront settings.'
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  const setNested = (section, field, value) => {
    setSettings(current => ({
      ...current,
      [section]: { ...current[section], [field]: value }
    }))
  }

  const setListItem = (field, index, key, value) => {
    setSettings(current => ({
      ...current,
      [field]: current[field].map((item, itemIndex) =>
        itemIndex === index ? { ...item, [key]: value } : item)
    }))
  }

  const addListItem = (field, item) => {
    setSettings(current => ({ ...current, [field]: [...current[field], item] }))
  }

  const removeListItem = (field, index) => {
    setSettings(current => ({
      ...current,
      [field]: current[field].filter((_, itemIndex) => itemIndex !== index)
    }))
  }

  const onSubmit = async event => {
    event.preventDefault()
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      const toPaise = value => {
        const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(value.trim())
        return match ? Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0')) : null
      }
      const feePaise = toPaise(shippingFeeInput)
      const freeThresholdPaise = freeShippingThresholdInput.trim()
        ? toPaise(freeShippingThresholdInput)
        : null
      if (feePaise === null) throw new Error('Enter a shipping fee with up to two decimal places.')
      if (freeShippingThresholdInput.trim() && (freeThresholdPaise === null || freeThresholdPaise === 0)) {
        throw new Error('Enter a valid positive free-shipping threshold or leave it blank.')
      }
      const payload = {
        ...settings,
        shipping: {
          ...settings.shipping,
          feePaise,
          freeShippingThresholdPaise: freeThresholdPaise
        },
        upcomingCategories: settings.upcomingCategoriesText === undefined
          ? settings.upcomingCategories
          : settings.upcomingCategoriesText.split('\n').map(item => item.trim()).filter(Boolean)
      }
      delete payload.upcomingCategoriesText
      const response = await axios.put(`${backendUrl}/api/storefront/admin`, payload, {
        headers: { token }
      })
      if (!response.data.success || !response.data.settings) {
        throw new Error(response.data.message || 'Unable to save storefront settings.')
      }
      setSettings(response.data.settings)
      setShippingFeeInput((response.data.settings.shipping.feePaise / 100).toFixed(2))
      setFreeShippingThresholdInput(
        response.data.settings.shipping.freeShippingThresholdPaise == null
          ? ''
          : (response.data.settings.shipping.freeShippingThresholdPaise / 100).toFixed(2)
      )
      toast.success('Storefront settings saved.')
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || 'Unable to save storefront settings.')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  if (loading) return <p className='py-10 text-center'>Loading storefront settings…</p>
  if (loadError) {
    return (
      <div role='alert' className='mx-auto grid max-w-3xl gap-4 rounded border border-red-200 bg-red-50 p-5 text-sm text-red-900'>
        <p>Storefront settings were not loaded, so editing is disabled to avoid overwriting saved values.</p>
        <p>{loadError}</p>
        <button type='button' onClick={loadSettings} className='w-fit underline'>Retry</button>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className='store-settings mx-auto grid w-full max-w-5xl gap-6'>
      <header>
        <p className='text-xs uppercase tracking-[.2em] text-amber-800'>PSH Sarees & Ethnic Wear</p>
        <h1 className='mt-2 text-2xl font-semibold text-gray-900'>Storefront & Brand</h1>
        <p className='mt-2 max-w-3xl text-sm text-gray-600'>
          Manage public brand, support, footer and announcement content. Leave unverified details blank;
          blank fields are omitted from the storefront.
        </p>
      </header>

      <section className='grid gap-4 rounded border bg-white p-5'>
        <h2 className='text-lg font-medium text-gray-900'>Public brand</h2>
        <label className='grid gap-1 text-sm'>Brand name
          <input required maxLength='100' value={settings.brand.publicName}
            onChange={event => setNested('brand', 'publicName', event.target.value)} />
        </label>
        <label className='grid gap-1 text-sm'>Tagline
          <input maxLength='160' value={settings.brand.tagline}
            onChange={event => setNested('brand', 'tagline', event.target.value)} />
        </label>
        <label className='grid gap-1 text-sm'>Brand description
          <textarea maxLength='500' rows='3' value={settings.brand.description}
            onChange={event => setNested('brand', 'description', event.target.value)} />
        </label>
        <label className='grid gap-1 text-sm'>Logo image URL (HTTPS)
          <input type='url' value={settings.brand.logoUrl}
            onChange={event => setNested('brand', 'logoUrl', event.target.value)} placeholder='Leave blank to use the PSH typographic logo' />
        </label>
        <label className='grid gap-1 text-sm'>Footer artwork
          <select value={settings.brand.footerArtwork}
            onChange={event => setNested('brand', 'footerArtwork', event.target.value)}>
            <option value='madhubani'>Original Madhubani-inspired artwork</option>
            <option value='none'>No decorative artwork</option>
          </select>
        </label>
      </section>

      <section className='grid gap-4 rounded border bg-white p-5'>
        <h2 className='text-lg font-medium text-gray-900'>Customer support</h2>
        <p className='text-sm text-gray-600'>Contact information is hidden publicly until you configure it.</p>
        <div className='grid gap-4 sm:grid-cols-2'>
          {[
            ['phone', 'Phone number'],
            ['whatsapp', 'WhatsApp mobile number'],
            ['email', 'Support email'],
            ['businessHours', 'Business hours']
          ].map(([field, label]) => (
            <label key={field} className='grid gap-1 text-sm'>{label}
              <input value={settings.support[field]}
                type={field === 'email' ? 'email' : 'text'}
                onChange={event => setNested('support', field, event.target.value)} />
            </label>
          ))}
        </div>
        <label className='grid gap-1 text-sm'>Support description
          <textarea maxLength='240' rows='2' value={settings.support.description}
            onChange={event => setNested('support', 'description', event.target.value)} />
        </label>
      </section>

      <section className='grid gap-4 rounded border bg-white p-5'>
        <h2 className='text-lg font-medium text-gray-900'>Seller and legal details</h2>
        <p className='text-sm text-gray-600'>Enter details exactly as registered. Public brand identity does not replace the legal seller.</p>
        {[
          ['businessName', 'Legal business / seller name'],
          ['gstin', 'GSTIN'],
          ['registeredAddress', 'Registered business address'],
          ['sellerInformation', 'Seller information'],
          ['grievanceContact', 'Grievance contact details']
        ].map(([field, label]) => (
          <label key={field} className='grid gap-1 text-sm'>{label}
            {['registeredAddress', 'sellerInformation', 'grievanceContact'].includes(field)
              ? <textarea maxLength={field === 'grievanceContact' ? 300 : 500} rows='2'
                value={settings.legal[field]} onChange={event => setNested('legal', field, event.target.value)} />
              : <input maxLength={field === 'gstin' ? 15 : 160} value={settings.legal[field]}
                onChange={event => setNested('legal', field, event.target.value)} />}
          </label>
        ))}
      </section>

      <section className='grid gap-4 rounded border bg-white p-5'>
        <h2 className='text-lg font-medium text-gray-900'>Store policies</h2>
        <p className='text-sm text-gray-600'>
          Plain text only; separate paragraphs with a blank line. A blank policy shows a
          &quot;not published yet&quot; notice on the storefront. Have your policies reviewed before publishing.
        </p>
        {[
          ['privacy', 'Privacy Policy'],
          ['terms', 'Terms & Conditions'],
          ['shipping', 'Shipping & Delivery Policy'],
          ['returns', 'Returns, Exchanges & Refund Policy']
        ].map(([field, label]) => (
          <label key={field} className='grid gap-1 text-sm'>{label}
            <textarea maxLength='10000' rows='8' value={settings.policies[field]}
              onChange={event => setNested('policies', field, event.target.value)} />
          </label>
        ))}
      </section>

      <section className='grid gap-4 rounded border bg-white p-5'>
        <h2 className='text-lg font-medium text-gray-900'>Footer links</h2>
        {settings.footerLinks.map((link, index) => (
          <div key={`${index}-${link.label}`} className='grid gap-2 sm:grid-cols-[1fr_2fr_1.2fr_auto]'>
            <select aria-label='Footer link group' value={link.group}
              onChange={event => setListItem('footerLinks', index, 'group', event.target.value)}>
              <option value='shop'>Shop</option><option value='support'>Support</option><option value='policies'>Policies</option>
            </select>
            <input aria-label='Footer link label' value={link.label}
              onChange={event => setListItem('footerLinks', index, 'label', event.target.value)} placeholder='Link label' />
            <input aria-label='Footer link URL' value={link.url}
              onChange={event => setListItem('footerLinks', index, 'url', event.target.value)} placeholder='/internal-page or https://…' />
            <button type='button' className='text-sm text-red-800' onClick={() => removeListItem('footerLinks', index)}>Remove</button>
          </div>
        ))}
        <button type='button' className='w-fit text-sm font-medium underline'
          onClick={() => addListItem('footerLinks', { label: '', url: '', group: 'support' })}>Add footer link</button>
      </section>

      <section className='grid gap-4 rounded border bg-white p-5'>
        <h2 className='text-lg font-medium text-gray-900'>Social media</h2>
        {settings.socialLinks.map((link, index) => (
          <div key={`${index}-${link.label}`} className='grid gap-2 sm:grid-cols-[1fr_2fr_auto]'>
            <input aria-label='Social media label' value={link.label}
              onChange={event => setListItem('socialLinks', index, 'label', event.target.value)} placeholder='Instagram' />
            <input aria-label='Social media URL' value={link.url}
              onChange={event => setListItem('socialLinks', index, 'url', event.target.value)} placeholder='https://…' />
            <button type='button' className='text-sm text-red-800' onClick={() => removeListItem('socialLinks', index)}>Remove</button>
          </div>
        ))}
        <button type='button' className='w-fit text-sm font-medium underline'
          onClick={() => addListItem('socialLinks', { label: '', url: '' })}>Add social link</button>
      </section>

      <section className='grid gap-4 rounded border bg-white p-5'>
        <h2 className='text-lg font-medium text-gray-900'>Shipping and announcements</h2>
        <p className='text-sm text-gray-600'>
          These values are used to preview shipping in the cart and to calculate it again on the server when an order is placed.
        </p>
        <div className='grid gap-4 sm:grid-cols-2'>
          <label className='grid gap-1 text-sm'>Shipping fee (₹)
            <input type='number' min='0' step='0.01' required value={shippingFeeInput}
              onChange={event => setShippingFeeInput(event.target.value)} />
          </label>
          <label className='grid gap-1 text-sm'>Free-shipping threshold (₹, optional)
            <input type='number' min='0.01' step='0.01' value={freeShippingThresholdInput}
              onChange={event => setFreeShippingThresholdInput(event.target.value)} />
          </label>
        </div>
        <label className='grid gap-1 text-sm'>Shipping information
          <textarea maxLength='240' rows='2' value={settings.shipping.message}
            onChange={event => setNested('shipping', 'message', event.target.value)}
            placeholder='Optional, verified customer-facing shipping information' />
        </label>
        <label className='flex items-center gap-2 text-sm'>
          <input type='checkbox' checked={settings.announcement.enabled}
            onChange={event => setNested('announcement', 'enabled', event.target.checked)} />
          Show announcement bar
        </label>
        <label className='grid gap-1 text-sm'>Announcement messages (scrolling banner; separate messages with | , up to 8)
          <input maxLength='180' value={settings.announcement.text}
            placeholder='DIWALI SALE IS LIVE | DISCOVER THE FESTIVE COLLECTION'
            onChange={event => setNested('announcement', 'text', event.target.value)} />
        </label>
        <label className='grid gap-1 text-sm'>Announcement link (internal path or HTTPS URL)
          <input value={settings.announcement.url}
            onChange={event => setNested('announcement', 'url', event.target.value)} />
        </label>
        <label className='grid gap-1 text-sm'>Coming-soon categories (one per line)
          <textarea rows='3' value={settings.upcomingCategories.join('\n')}
            onChange={event => setSettings(current => ({
              ...current,
              upcomingCategoriesText: event.target.value
            }))} />
        </label>
        <div className='rounded bg-amber-50 p-3 text-sm text-gray-700'>
          Checkout capabilities are fixed to the current backend: cash on delivery is available;
          prepaid payment and online PIN-code serviceability checks are not enabled. Changing shipping
          copy or rates does not enable those integrations.
        </div>
      </section>

      <div className='sticky bottom-4 flex justify-end'>
        <button type='submit' disabled={saving}
          className='rounded bg-[#5a1f30] px-6 py-3 font-medium text-white disabled:opacity-60'>
          {saving ? 'Saving…' : 'Save storefront settings'}
        </button>
      </div>
    </form>
  )
}

export default Settings

Settings.propTypes = {
  token: PropTypes.string.isRequired
}
