export const getWhatsAppSupportUrl = number => {
  const digits = typeof number === 'string' ? number.replace(/\D/g, '') : ''
  return /^[1-9]\d{9,14}$/.test(digits) ? `https://wa.me/${digits}` : ''
}
