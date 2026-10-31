export const campaigns = [
  {
    slug: 'dhanteras',
    collectionTag: 'Dhanteras',
    name: 'Dhanteras',
    eyebrow: 'Festive collection',
    description: 'Explore sarees selected for Dhanteras.',
    actionLabel: 'Shop Dhanteras collection'
  },
  {
    slug: 'diwali',
    collectionTag: 'Diwali',
    name: 'Diwali',
    eyebrow: 'Festive collection',
    description: 'Discover festive styles from the PSH catalogue.',
    actionLabel: 'Shop Diwali collection'
  },
  {
    slug: 'chhath',
    collectionTag: 'Chhath',
    name: 'Chhath',
    eyebrow: 'Festive collection',
    description: 'Explore occasion-ready styles from the PSH catalogue.',
    actionLabel: 'Shop Chhath collection'
  }
]

export const campaignBySlug = slug => campaigns.find(campaign => campaign.slug === slug)

export const categorySlug = category => category.trim().toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')

export const categoryFromSlug = slug => slug.split('-')
  .filter(Boolean)
  .map(word => word[0].toUpperCase() + word.slice(1))
  .join(' ')
