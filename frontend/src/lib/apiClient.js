import { buildApiUrl } from "./config";
import { clearAuthSession, getAuthToken, getCsrfToken, setAuthSession } from "./authStorage";

const DEFAULT_TIMEOUT_MS = 15000;

let sessionRecoveryPromise = null;

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

/**
 * Attempt to recover a lost sessionStorage session by asking the server
 * to re-derive the JWT / CSRF from the still-valid HttpOnly cookie.
 * Returns true if session was recovered.
 */
async function attemptSessionRecovery() {
    // Deduplicate concurrent recovery attempts
    if (sessionRecoveryPromise) return sessionRecoveryPromise;

    sessionRecoveryPromise = (async () => {
        try {
            const res = await fetch(buildApiUrl("/api/auth/session"), {
                method: "GET",
                credentials: "include",
                cache: "no-store",
            });
            if (!res.ok) return false;

            const data = await res.json();
            if (data?.user?.email) {
                setAuthSession(data.user, data.csrf_token || "", data.token || "");
                return true;
            }
            return false;
        } catch {
            return false;
        } finally {
            sessionRecoveryPromise = null;
        }
    })();

    return sessionRecoveryPromise;
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
    const attemptFetch = async (hdrs) => {
        const response = await fetch(url, {
            method,
            headers: hdrs,
            body,
            signal: timeout.signal,
            mode: "cors",
            credentials: "include",
            cache: "no-store",
        });

        // Only clear session on 401 from non-auth endpoints
        if (response.status === 401 && !path.includes("/auth/") && path !== "/api/login" && path !== "/api/register") {
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

        let response = await attemptFetch(headers);

        // Session Recovery: If we get 401/403 and have no JWT but might have a valid cookie,
        // try to recover the session first, then retry the request once.
        if ((response.status === 401 || response.status === 403) && !options._recovered) {
            const hasJwt = Boolean(getAuthToken());
            const isAuthEndpoint = path.includes("/auth/") || path === "/api/login" || path === "/api/register";

            // If JWT is missing (sessionStorage cleared) but user data suggests they were logged in,
            // or if we got a CSRF mismatch (403) because CSRF token was lost with sessionStorage
            if ((!hasJwt || response.status === 403) && !isAuthEndpoint) {
                const recovered = await attemptSessionRecovery();
                if (recovered) {
                    options._recovered = true;
                    // Rebuild headers with fresh tokens
                    const freshJwt = getAuthToken();
                    const freshCsrf = getCsrfToken();
                    if (freshJwt) headers.set("Authorization", `Bearer ${freshJwt}`);
                    if (freshCsrf && ["POST", "PUT", "DELETE", "PATCH"].includes(method)) {
                        headers.set("X-CSRF-Token", freshCsrf);
                    }
                    response = await attemptFetch(headers);
                }
            }
        }

        // Retry once on transient 503 (service temporarily unavailable)
        if (response.status === 503 && !options._retried) {
            await new Promise(r => setTimeout(r, 1000));
            options._retried = true;
            response = await attemptFetch(headers);
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
