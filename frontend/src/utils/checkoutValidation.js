const REQUIRED = {
  firstName: 'Enter your first name.',
  lastName: 'Enter your last name.',
  email: 'Enter your email address.',
  phone: 'Enter your mobile number.',
  street: 'Enter your complete address.',
  city: 'Enter your city.',
  state: 'Enter your state.',
  zipcode: 'Enter your PIN code.'
}

// Mirrors backend/utils/orderValidation.js for early feedback; the server remains the authority.
export const validateCheckoutAddress = address => {
  const errors = {}
  for (const [key, message] of Object.entries(REQUIRED)) {
    if (typeof address?.[key] !== 'string' || !address[key].trim()) errors[key] = message
  }
  if (!errors.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.email.trim())) {
    errors.email = 'Enter a valid email address.'
  }
  if (!errors.zipcode && !/^\d{6}$/.test(address.zipcode.trim())) {
    errors.zipcode = 'Enter a valid six-digit PIN code.'
  }
  if (!errors.phone && !/^(?:\+91[\s-]?)?[6-9]\d{9}$/.test(address.phone.replace(/[\s-]/g, ''))) {
    errors.phone = 'Enter a valid 10-digit Indian mobile number.'
  }
  return errors
}
