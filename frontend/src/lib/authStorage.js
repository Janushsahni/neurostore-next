const STORAGE_PREFIX = "neuro";
let vaultSecret = "";

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
    ].forEach((key) => {
        window.localStorage.removeItem(key);
        window.sessionStorage.removeItem(key);
    });
}

export function getAuthToken() {
    return read("jwt");
}

export function setVaultSecret(secret) {
    vaultSecret = String(secret || "");
}

export function getVaultSecret() {
    return vaultSecret;
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

function hashBucketSeed(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}

export function getUserDriveBucket() {
    const email = String(getAuthUser()?.email || "").trim().toLowerCase();
    if (!email) {
        return "user-drive";
    }
    return `user-drive-${hashBucketSeed(email)}`;
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
    vaultSecret = "";
    if (storage) {
        ["jwt", "user", "csrf", "token", "vault_key", "vault_escrowed"].forEach((key) => storage.removeItem(getKey(key)));
    }
    removeLegacyKeys();
}
