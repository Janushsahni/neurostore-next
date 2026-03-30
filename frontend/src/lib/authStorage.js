const STORAGE_PREFIX = "neuro";

function getStorage() {
    if (typeof window === "undefined") {
        return null;
    }
    return window.sessionStorage;
}

function getKey(name) {
    return `${STORAGE_PREFIX}_${name}`;
}

function read(name) {
    return getStorage()?.getItem(getKey(name)) || "";
}

function write(name, value) {
    const storage = getStorage();
    if (!storage) {
        return;
    }
    if (!value) {
        storage.removeItem(getKey(name));
        return;
    }
    storage.setItem(getKey(name), value);
}

function removeLegacyKeys() {
    if (typeof window === "undefined") {
        return;
    }

    [
        "neuro_jwt",
        "neuro_user",
        "neuro_csrf",
        "neuro_token",
        "neuro_vault_key",
        "neuro_vault_escrowed",
    ].forEach((key) => window.localStorage.removeItem(key));
}

export function getAuthToken() {
    return read("jwt");
}

export function getAuthUser() {
    const raw = read("user");
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

export function getCsrfToken() {
    return read("csrf");
}

export function isAuthenticated() {
    return Boolean(getAuthToken() && getAuthUser());
}

export function setAuthSession(user, csrfToken, jwtToken) {
    if (jwtToken) {
        write("jwt", jwtToken);
    }
    if (user) {
        write("user", JSON.stringify(user));
        if (user.plan) {
            write("plan", String(user.plan).toLowerCase());
        }
    }
    if (csrfToken) {
        write("csrf", csrfToken);
    }
    removeLegacyKeys();
}

export function getSelectedPlan() {
    return read("plan") || "free";
}

export function setSelectedPlan(plan) {
    write("plan", String(plan || "free").toLowerCase());
}

export function clearAuthSession() {
    const storage = getStorage();
    if (storage) {
        ["jwt", "user", "csrf", "token", "vault_key", "vault_escrowed"].forEach((key) => storage.removeItem(getKey(key)));
    }
    removeLegacyKeys();
}
