let dirty = false

export const LEAVE_MESSAGE = 'You have unsaved changes to this product. Leave without saving?'

export const setUnsavedChanges = value => { dirty = value === true }
export const hasUnsavedChanges = () => dirty

// Returns true when navigation may proceed.
export const confirmLeave = (ask = message => window.confirm(message)) => {
  if (!dirty) return true
  if (ask(LEAVE_MESSAGE)) {
    dirty = false
    return true
  }
  return false
}

export const guardNavigation = (event, ask) => {
  if (!confirmLeave(ask)) event.preventDefault()
}
