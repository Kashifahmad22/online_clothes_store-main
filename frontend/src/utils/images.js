const CLOUDINARY_UPLOAD = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/

// Returns the Cloudinary delivery URL with a transformation inserted, or null when the URL is
// not an untransformed Cloudinary upload (so callers can fall back to the original).
export const cloudinaryUrl = (url, transformation) => {
  const match = CLOUDINARY_UPLOAD.exec(typeof url === 'string' ? url : '')
  if (!match) return null
  const firstSegment = match[2].split('/')[0]
  const alreadyTransformed = !/^v\d+$/.test(firstSegment) &&
    (firstSegment.includes(',') || /^[a-z]{1,3}_/.test(firstSegment))
  return alreadyTransformed ? null : `${match[1]}${transformation}/${match[2]}`
}

export const resizedUrl = (url, width) => cloudinaryUrl(url, `f_auto,q_auto,w_${width},c_limit`)

export const resizedSrcSet = (url, widths) => {
  const entries = widths.map(width => [width, resizedUrl(url, width)])
  return entries.every(([, resized]) => resized)
    ? entries.map(([width, resized]) => `${resized} ${width}w`).join(', ')
    : null
}

// Social networks and structured data need a universally supported format, so force JPEG.
export const socialImageUrl = url =>
  cloudinaryUrl(url, 'f_jpg,q_auto,w_1200,h_1200,c_limit') || url
