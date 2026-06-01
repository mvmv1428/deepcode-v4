'use strict';

/**
 * Usage Tracker for the DeepCode proxy.
 *
 * Default: ON. Disable with DEEPCODE_DEBUG_USAGE=0.
 *
 * Tracks token usage, costs, and cache hit rates in-memory.
 * Stats are persisted to the session marker for the statusline.
 */

const { getRate } = require('./pricing');
const sessionMarker = require('./session');

let _enabled = null;
let _initialized = false;
let _handlersRegistered = false;
let currentSessionId = null;

function _getEnabled() {
    if (_enabled === null) _enabled = process.env.DEEPCODE_DEBUG_USAGE !== '0';
    return _enabled;
}

function setSessionId(id) {
    currentSessionId = id;
}

// Session-level cumulative stats
let session = {
    startedAt: null,
    requestCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheHit: 0,
    totalCacheMiss: 0,
    totalCostUsd: 0,
};

let current = null;

// ── Terminal title updater ──────────────────────────────
function updateTerminalTitle() {
    const totalTok = session.totalInputTokens + session.totalOutputTokens;
    const totalCache = session.totalCacheHit + session.totalCacheMiss;
    const hitRate = totalCache > 0
        ? ((session.totalCacheHit / totalCache) * 100).toFixed(0)
        : '-';

    const tokStr = totalTok >= 1000 ? (totalTok / 1000).toFixed(1) + 'K' : String(totalTok);
    const costStr = '$' + session.totalCostUsd.toFixed(4);

    const title = `📊 #${session.requestCount} | ${tokStr} tok | Cache ${hitRate}% | ${costStr}`;

    // ANSI escape: set terminal title (works on Windows Terminal, iTerm2, etc.)
    process.stderr.write(`\x1b]0;${title}\x07`);
}

// ── Init (runs once on first request) ──────────────────
function _initOnce() {
    if (_initialized) return;
    _initialized = true;
    if (!_getEnabled()) return;

    if (!_handlersRegistered) {
        _handlersRegistered = true;
        // Solo escuchar 'exit' — el proxy controla SIGINT/SIGTERM y llama process.exit()
        // que dispara 'exit', asegurando que limpiamos el título del terminal.
        process.on('exit', printSessionSummary);
    }

    session.startedAt = Date.now();

    // Set initial title
    process.stderr.write(`\x1b]0;📊 DeepCode-V4 — Esperando requests...\x07`);
}

// ── Public API ─────────────────────────────────────────
function isEnabled() {
    return _getEnabled();
}

function startRequest(model) {
    if (!_getEnabled()) return;
    _initOnce();
    current = {
        model: model || 'unknown',
        startedAt: Date.now(),
        inputTokens: 0,
        outputTokens: 0,
        cacheHitTokens: 0,
        cacheMissTokens: 0,
    };
}

function recordUsage(usage) {
    if (!_getEnabled() || !current || !usage || typeof usage !== 'object') return;

    if (typeof usage.input_tokens === 'number') current.inputTokens = usage.input_tokens;
    if (typeof usage.output_tokens === 'number') current.outputTokens = usage.output_tokens;
    if (typeof usage.prompt_cache_hit_tokens === 'number') current.cacheHitTokens = usage.prompt_cache_hit_tokens;
    if (typeof usage.prompt_cache_miss_tokens === 'number') current.cacheMissTokens = usage.prompt_cache_miss_tokens;
    if (typeof usage.cache_read_input_tokens === 'number') current.cacheHitTokens = usage.cache_read_input_tokens;
    if (typeof usage.cache_creation_input_tokens === 'number') current.cacheMissTokens += usage.cache_creation_input_tokens;
}

function endRequest() {
    if (!_getEnabled() || !current) return;

    const elapsed = Date.now() - current.startedAt;
    const pricing = getRate(current.model);

    // Calculate cost
    const cachedCost = (current.cacheHitTokens / 1_000_000) * pricing.cachedInput;
    const uncachedCost = (current.cacheMissTokens / 1_000_000) * pricing.input;
    const inputCost = (current.cacheHitTokens > 0 || current.cacheMissTokens > 0)
        ? cachedCost + uncachedCost
        : (current.inputTokens / 1_000_000) * pricing.input;
    const outputCost = (current.outputTokens / 1_000_000) * pricing.output;
    const totalCost = inputCost + outputCost;

    // Cache hit rate
    const totalCacheTokens = current.cacheHitTokens + current.cacheMissTokens;
    const cacheHitRate = totalCacheTokens > 0
        ? ((current.cacheHitTokens / totalCacheTokens) * 100).toFixed(1)
        : null;

    // Update session
    session.requestCount++;
    session.totalInputTokens += current.inputTokens;
    session.totalOutputTokens += current.outputTokens;
    session.totalCacheHit += current.cacheHitTokens;
    session.totalCacheMiss += current.cacheMissTokens;
    session.totalCostUsd += totalCost;

    // Update terminal title in real-time
    updateTerminalTitle();

    if (currentSessionId) {
        const marker = sessionMarker.readMarker(currentSessionId);
        if (marker) {
            marker.stats = {
                count: session.requestCount,
                input: session.totalInputTokens,
                output: session.totalOutputTokens,
                cost: session.totalCostUsd,
                lastModel: current.model,
                lastInput: current.inputTokens,
                lastOutput: current.outputTokens,
                lastCacheHit: current.cacheHitTokens,
                lastCacheMiss: current.cacheMissTokens,
            };
            sessionMarker.writeMarker(marker);
        }
    }

    current = null;
}

function printSessionSummary() {
    // Session stats are tracked in the statusline only
    if (session.requestCount > 0) {
        process.stderr.write('\x1b]0;\x07');
    }
}

module.exports = {
    isEnabled,
    startRequest,
    recordUsage,
    endRequest,
    printSessionSummary,
    getSession: () => ({ ...session }),
    setSessionId,
};
