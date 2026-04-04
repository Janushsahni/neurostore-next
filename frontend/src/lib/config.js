function trimTrailingSlash(value) {
    return value.replace(/\/+$/, "");
}



export function getApiBase() {
    const raw = (import.meta.env.VITE_API_URL || "").trim();

    if (!raw && typeof window !== "undefined") {
        const { protocol, hostname } = window.location;
        const apiPort = import.meta.env.VITE_API_PORT || "8080";
        return `${protocol}//${hostname || "localhost"}:${apiPort}`;
    }

    if (!raw) {
        return "http://localhost:8080";
    }

    const normalized = trimTrailingSlash(raw);
    const withProtocol = /^https?:\/\//i.test(normalized)
        ? normalized
        : `${/localhost|127\.0\.0\.1/i.test(normalized) ? "http" : "https"}://${normalized}`;

    try {
        return trimTrailingSlash(new URL(withProtocol).origin);
    } catch {
        return "";
    }
}

export const API_BASE = getApiBase();

export function buildApiUrl(path) {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return API_BASE ? `${API_BASE}${normalizedPath}` : normalizedPath;
}
