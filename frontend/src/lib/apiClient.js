import { API_BASE } from "./config";
import { clearAuthSession, getCsrfToken } from "./authStorage";

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

function shouldAttachCsrf(method) {
    const m = method.toUpperCase();
    return m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE";
}

export async function apiRequest(path, options = {}) {
    const method = (options.method || "GET").toUpperCase();
    const headers = new Headers(options.headers || {});
    const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
    const url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;

    if (shouldAttachCsrf(method)) {
        const csrfToken = getCsrfToken();
        if (csrfToken && !headers.has("x-csrf-token")) {
            headers.set("x-csrf-token", csrfToken);
        }
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
            credentials: options.credentials || "include",
            mode: "cors",
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
    const response = await apiRequest(path, options);
    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
        return { response, data: await response.json() };
    }

    const text = await response.text();
    return { response, data: { error: text || "Unexpected server response" } };
}
