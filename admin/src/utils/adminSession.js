export const TOKEN_KEY = 'token'

const safely = action => {
    try {
        return action()
    } catch {
        return undefined
    }
}

// Any token left in localStorage by an older build is deleted, never adopted.
export const readAdminToken = (session = window.sessionStorage, legacy = window.localStorage) => {
    safely(() => legacy.removeItem(TOKEN_KEY))
    return safely(() => session.getItem(TOKEN_KEY)) || ''
}

export const writeAdminToken = (token, session = window.sessionStorage) => {
    safely(() => (token ? session.setItem(TOKEN_KEY, token) : session.removeItem(TOKEN_KEY)))
}

export const shouldEndSession = error =>
    error?.response?.status === 401 && Boolean(error?.config?.headers?.token)
