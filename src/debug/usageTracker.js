'use strict';

/**
 * Usage Tracker for the deepcode-v4 proxy.
 *
 * Default: ON. Disable with DEEPCODE_DEBUG_USAGE=0.
 *
 * Default log file: ~/.claude/deepcode-usage.jsonl (override with DEEPCODE_USAGE_LOG).
 * Tracking lives outside the project tree so it works no matter where the user
 * launches `deepcode-v4` from.
 *
 * Reads:
 *   - Terminal window title (live)
 *   - JSONL log → consumed by the statusline and `deepcode-usage`
 */

const { getRate, isPromoActive, daysUntilPromoEnd, PROMO_END_UTC } = require('./pricing');
const sessionMarker = require('./session');

let _enabled = null;
let _initialized = false;
let currentSessionId = null;

function _getEnabled() {
    if (_enabled === null) _enabled = process.env.DEEPCODE_DEBUG_USAGE !== '0';
    return _enabled;
}

function setSessionId(id) {
    currentSessionId = id;
}

// Session-level cumulative stats
const session = {
    startedAt: Date.now(),
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

    process.on('exit', printSessionSummary);
    process.on('SIGINT', () => { printSessionSummary(); process.exit(0); });
    process.on('SIGTERM', () => { printSessionSummary(); process.exit(0); });


    // Warn when promotional discount window is closing
    if (isPromoActive()) {
        const days = daysUntilPromoEnd();
        if (days <= 7) {
            process.stderr.write(`[deepcode-v4] ⚠️  v4-pro 75% promo ends in ${days}d (${PROMO_END_UTC}). Retail pricing kicks in automatically.\n`);
        }
    } else {
        process.stderr.write(`[deepcode-v4] ℹ️  v4-pro promo expired ${PROMO_END_UTC} — using retail pricing.\n`);
    }

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
            };
            sessionMarker.writeMarker(marker);
        }
    }

    current = null;
}

function printSessionSummary() {
    if (!_getEnabled() || session.requestCount === 0) return;

    const elapsed = ((Date.now() - session.startedAt) / 1000).toFixed(0);
    const totalCache = session.totalCacheHit + session.totalCacheMiss;
    const hitRate = totalCache > 0
        ? ((session.totalCacheHit / totalCache) * 100).toFixed(1) + '%'
        : 'N/A';
    const totalTok = session.totalInputTokens + session.totalOutputTokens;

    process.stderr.write('\n');
    process.stderr.write('╔══════════════════════════════════════════════╗\n');
    process.stderr.write('║         📊 RESUMEN DE SESIÓN                ║\n');
    process.stderr.write('╠══════════════════════════════════════════════╣\n');
    process.stderr.write(`║ Duración:     ${elapsed}s | ${session.requestCount} requests\n`);
    process.stderr.write(`║ Tokens:       ${totalTok.toLocaleString()} (${session.totalInputTokens.toLocaleString()} in + ${session.totalOutputTokens.toLocaleString()} out)\n`);
    if (totalCache > 0) {
        process.stderr.write(`║ Cache:        ${hitRate} hit (${session.totalCacheHit.toLocaleString()} / ${totalCache.toLocaleString()})\n`);
    }
    process.stderr.write(`║ Costo total:  $${session.totalCostUsd.toFixed(6)}\n`);
    process.stderr.write('╚══════════════════════════════════════════════╝\n\n');

    // Restore terminal title
    process.stderr.write('\x1b]0;\x07');
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
