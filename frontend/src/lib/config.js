export const getApiBase = () => {
    let url = import.meta.env.VITE_API_URL || "http://localhost:9009";
    // Trim trailing slash
    url = url.replace(/\/$/, "");
    // If it looks like a domain without a protocol, default to https
    if (!url.startsWith('http')) {
        url = `https://${url}`;
    }
    return url;
};

export const API_BASE = getApiBase();
