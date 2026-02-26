export const getApiBase = () => {
    let url = import.meta.env.VITE_API_URL || "";

    // Fallback if missing
    if (!url) {
        console.warn("[NeuroStore] VITE_API_URL is missing. Please set it in Vercel.");
        return "http://localhost:9009";
    }

    // Trim trailing slash
    url = url.replace(/\/$/, "");

    // If no protocol is provided
    if (!url.startsWith('http')) {
        // Vercel (HTTPS) -> Railway/VPS (MUST be HTTPS if not localhost)
        const isLocal = url.includes('localhost') || url.includes('127.0.0.1');
        const protocol = (isLocal) ? 'http://' : 'https://';
        url = `${protocol}${url}`;
    }

    console.log("[NeuroStore] API targeting:", url);
    return url;
};

export const API_BASE = getApiBase();
