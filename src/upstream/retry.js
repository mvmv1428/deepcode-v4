'use strict';

// 429 (rate-limit) is included because rate-limit errors do not charge tokens,
// and retrying them allows recovering from temporary upstream rate limits.
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
// Hard deny-list: never retry these statuses even if a caller overrides
// `retry.statuses`. Permanent client-side errors (auth, validation, not found)
// will not be fixed by retrying — fail fast.
const NON_RETRYABLE_STATUSES = new Set([400, 401, 403, 404, 422]);
const RETRYABLE_ERROR_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'ECONNREFUSED']);

function computeBackoffMs(attempt, base, max) {
    const exp = Math.min(max, base * Math.pow(2, attempt - 1));
    const jitter = Math.random() * (exp * 0.25);
    return Math.floor(exp + jitter);
}

function shouldRetryStatus(statusCode, retry) {
    if (NON_RETRYABLE_STATUSES.has(statusCode)) return false;
    if (!retry.statuses) return false;
    return retry.statuses.has(statusCode);
}

function shouldRetryError(err, retry) {
    if (!retry.retryNetworkErrors) return false;
    if (!err || !err.code) return false;
    return RETRYABLE_ERROR_CODES.has(err.code);
}

function createRetryClient({ transport, retry }) {
    const cfg = {
        max: retry.max ?? 2,
        statuses: retry.statuses || RETRYABLE_STATUSES,
        baseMs: retry.baseMs ?? 250,
        maxMs: retry.maxMs ?? 4000,
        retryNetworkErrors: retry.retryNetworkErrors ?? true,
        onRetry: typeof retry.onRetry === 'function' ? retry.onRetry : null,
    };

    return function send(options, body, hooks = {}) {
        const { onResponse, onError, onSocket, onTimeout } = hooks;
        let attempt = 0;
        let currentReq = null;
        let aborted = false;
        let pendingTimer = null;

        function scheduleRetry(reason) {
            attempt += 1;
            const delay = computeBackoffMs(attempt, cfg.baseMs, cfg.maxMs);
            if (cfg.onRetry) {
                try { cfg.onRetry({ attempt, delay, reason }); } catch {}
            }
            pendingTimer = setTimeout(() => {
                pendingTimer = null;
                if (!aborted) go();
            }, delay);
        }

        function go() {
            const req = transport.request(options, (res) => {
                if (aborted) { res.resume(); return; }

                if (attempt < cfg.max && shouldRetryStatus(res.statusCode, cfg)) {
                    res.resume();
                    res.on('end', () => {
                        if (!aborted) scheduleRetry({ kind: 'status', status: res.statusCode });
                    });
                    res.on('error', () => {
                        if (!aborted) scheduleRetry({ kind: 'status', status: res.statusCode });
                    });
                    return;
                }

                onResponse && onResponse(res, attempt);
            });

            currentReq = req;

            if (typeof onSocket === 'function') {
                req.on('socket', sock => onSocket(sock));
            }

            req.on('timeout', () => {
                if (typeof onTimeout === 'function') onTimeout(attempt);
                req.destroy(new Error('upstream timeout'));
            });

            req.on('error', (err) => {
                if (aborted) return;
                if (attempt < cfg.max && shouldRetryError(err, cfg)) {
                    scheduleRetry({ kind: 'error', error: err });
                    return;
                }
                onError && onError(err, attempt);
            });

            req.write(body);
            req.end();
        }

        go();

        return {
            abort() {
                aborted = true;
                if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
                if (currentReq && !currentReq.destroyed) currentReq.destroy();
            },
            get current() { return currentReq; },
            get attempt() { return attempt; },
        };
    };
}

module.exports = { createRetryClient };
