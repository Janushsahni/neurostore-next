import { API_BASE, DEMO_MODE } from "./config";
import { clearAuthSession, getAuthToken } from "./authStorage";
import { demoApiJson, demoApiRequest } from "./demoApi";

const DEFAULT_TIMEOUT_MS = 15000;

function withTimeout(timeoutMs, externalSignal) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    if (externalSignal) {
        if (externalSignal.aborted) controller.abort();
        else externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    return {
        signal: controller.signal,
        cleanup: () => clearTimeout(timeoutId),
    };
}

export async function apiRequest(path, options = {}) {
    if (DEMO_MODE) return demoApiRequest(path, options);
    const method = (options.method || "GET").toUpperCase();
    const headers = new Headers(options.headers || {});
    const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
    const url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;

    // Attach JWT Bearer token for all requests (cross-domain safe)
    const jwt = getAuthToken();
    if (jwt && !headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${jwt}`);
    }

    let body = options.body;
    if (body && typeof body === "object" && !(body instanceof FormData) && !(body instanceof Blob)) {
        if (!headers.has("Content-Type")) {
            headers.set("Content-Type", "application/json");
        }
        body = JSON.stringify(body);
    }

    const timeout = withTimeout(timeoutMs, options.signal);
    try {
        const response = await fetch(url, {
            method,
            headers,
            body,
            signal: timeout.signal,
            mode: "cors",
            credentials: "include",
            cache: "no-store",
        });

        if (response.status === 401) {
            clearAuthSession();
        }

        return response;
    } finally {
        timeout.cleanup();
    }
}

export async function apiJson(path, options = {}) {
    if (DEMO_MODE) return demoApiJson(path, options);
    const response = await apiRequest(path, options);
    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
        return { response, data: await response.json() };
    }

    const text = await response.text();
    return { response, data: { error: text || "Unexpected server response" } };
}
