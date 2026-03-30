import { buildApiUrl } from "./config";
import { clearAuthSession, getAuthToken, getCsrfToken } from "./authStorage";

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
    const method = (options.method || "GET").toUpperCase();
    const headers = new Headers(options.headers || {});
    const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
    const url = buildApiUrl(path);

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
    const attemptFetch = async () => {
        const response = await fetch(url, {
            method,
            headers,
            body,
            signal: timeout.signal,
            mode: "cors",
            credentials: "include",
            cache: "no-store",
        });

        if (response.status === 401 && path !== "/auth/session") {
            clearAuthSession();
        }

        return response;
    };

    try {
        // Attach CSRF token to all mutating requests
        const csrfToken = getCsrfToken();
        if (csrfToken && ["POST", "PUT", "DELETE", "PATCH"].includes(method)) {
            headers.set("X-CSRF-Token", csrfToken);
        }

        let response = await attemptFetch();

        // Retry once on transient 503 (service temporarily unavailable)
        if (response.status === 503 && !options._retried) {
            await new Promise(r => setTimeout(r, 1000));
            options._retried = true;
            response = await attemptFetch();
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
