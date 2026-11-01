// Runs one async task at a time. A second call while the first is pending is ignored,
// which prevents duplicate submissions from double clicks or repeated taps.
export const createExclusiveRunner = () => {
  let busy = false
  return async task => {
    if (busy) return { skipped: true }
    busy = true
    try {
      return { skipped: false, value: await task() }
    } finally {
      busy = false
    }
  }
}
