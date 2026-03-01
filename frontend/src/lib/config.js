export const getApiBase = () => {
    let url = import.meta.env.VITE_API_URL || "";

    if (!url) {
        return "http://localhost:9009";
    }

    url = url.replace(/\/$/, "");

    if (!url.startsWith('http')) {
        const isLocal = url.includes('localhost') || url.includes('127.0.0.1');
        const protocol = (isLocal) ? 'http://' : 'https://';
        url = `${protocol}${url}`;
    }

    try {
        const parsed = new URL(url);
        return parsed.origin;
    } catch {
        return "http://localhost:9009";
    }
};

export const API_BASE = getApiBase();
