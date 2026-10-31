export const policyPages = [
  {
    key: 'privacy',
    path: '/privacy-policy',
    label: 'Privacy Policy',
    description: 'How this store collects, uses and protects customer information.'
  },
  {
    key: 'terms',
    path: '/terms-and-conditions',
    label: 'Terms & Conditions',
    description: 'The terms that apply when you browse and shop at this store.'
  },
  {
    key: 'shipping',
    path: '/shipping-policy',
    label: 'Shipping & Delivery Policy',
    description: 'Shipping and delivery information for orders placed at this store.'
  },
  {
    key: 'returns',
    path: '/returns-policy',
    label: 'Returns, Exchanges & Refund Policy',
    description: 'Return, exchange and refund information for orders placed at this store.'
  }
]

export const policyByPath = Object.fromEntries(policyPages.map(page => [page.path, page]))
