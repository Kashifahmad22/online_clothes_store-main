export const defaultSiteSettings = {
  brand: {
    publicName: 'PSH Sarees & Ethnic Wear',
    tagline: 'The Art of Indian Ethnic Wear.',
    description: 'Discover sarees and ethnic wear with product information shown as supplied.',
    logoUrl: '',
    footerArtwork: 'madhubani'
  },
  support: { phone: '', whatsapp: '', email: '', businessHours: '', description: '' },
  legal: {
    businessName: 'Patna Saree Handloom',
    gstin: '',
    registeredAddress: '',
    sellerInformation: '',
    grievanceContact: ''
  },
  footerLinks: [
    { label: 'Shop all', url: '/collection', group: 'shop' },
    { label: 'Sarees', url: '/category/sarees', group: 'shop' },
    { label: 'About PSH', url: '/about', group: 'support' },
    { label: 'Contact', url: '/contact', group: 'support' },
    { label: 'My orders', url: '/orders', group: 'support' }
  ],
  socialLinks: [],
  shipping: { feePaise: 5000, freeShippingThresholdPaise: null, message: '' },
  announcement: { enabled: false, text: '', url: '' },
  upcomingCategories: ['Lungis', 'Kurtis', "Other women's ethnic wear"],
  checkout: { codAvailable: true, prepaidAvailable: false, serviceabilityCheckAvailable: false }
}
