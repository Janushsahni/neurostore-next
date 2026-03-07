export function getAuthToken() {
    return localStorage.getItem('neuro_jwt') || '';
}

export function getAuthUser() {
    const raw = localStorage.getItem('neuro_user');
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

export function getCsrfToken() {
    return localStorage.getItem('neuro_csrf') || '';
}

export function isAuthenticated() {
    return !!getAuthToken() && !!getAuthUser();
}

export function setAuthSession(user, csrfToken, jwtToken) {
    if (jwtToken) {
        localStorage.setItem('neuro_jwt', jwtToken);
    }
    if (user) {
        localStorage.setItem('neuro_user', JSON.stringify(user));
    }
    if (csrfToken) {
        localStorage.setItem('neuro_csrf', csrfToken);
    }
    // Clean up legacy session storage
    sessionStorage.removeItem('neuro_user');
    sessionStorage.removeItem('neuro_csrf');
    sessionStorage.removeItem('neuro_token');
}

export function clearAuthSession() {
    localStorage.removeItem('neuro_jwt');
    localStorage.removeItem('neuro_user');
    localStorage.removeItem('neuro_csrf');
    sessionStorage.removeItem('neuro_user');
    sessionStorage.removeItem('neuro_csrf');
    sessionStorage.removeItem('neuro_token');
    sessionStorage.removeItem('neuro_vault_key');
    localStorage.removeItem('neuro_token');
}
