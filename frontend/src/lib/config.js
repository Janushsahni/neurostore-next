export const getApiBase = () => {
    let url = import.meta.env.VITE_API_URL || "http://localhost:9009";
    // Trim trailing slash
    url = url.replace(/\/$/, "");

    // If no protocol is provided
    if (!url.startsWith('http')) {
        // If it's an IP address or localhost, use http
        const isIp = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}/.test(url) || url.startsWith('localhost');
        url = isIp ? `http://${url}` : `https://${url}`;
    }
    return url;
};

export const API_BASE = getApiBase();
