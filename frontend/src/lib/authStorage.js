export function getAuthUser() {
    const raw = sessionStorage.getItem('neuro_user');
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

export function getCsrfToken() {
    return sessionStorage.getItem('neuro_csrf') || '';
}

export function isAuthenticated() {
    return !!getAuthUser();
}

export function setAuthSession(user, csrfToken) {
    if (user) {
        sessionStorage.setItem('neuro_user', JSON.stringify(user));
    }
    if (csrfToken) {
        sessionStorage.setItem('neuro_csrf', csrfToken);
    }
    // Remove legacy bearer token storage.
    sessionStorage.removeItem('neuro_token');
    localStorage.removeItem('neuro_token');
    localStorage.removeItem('neuro_user');
}

export function clearAuthSession() {
    sessionStorage.removeItem('neuro_user');
    sessionStorage.removeItem('neuro_csrf');
    sessionStorage.removeItem('neuro_token');
    localStorage.removeItem('neuro_token');
    localStorage.removeItem('neuro_user');
}
