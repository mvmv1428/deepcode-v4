'use strict';

/**
 * DeepSeek V4 pricing — single source of truth.
 *
 * Source: https://api-docs.deepseek.com/quick_start/pricing (verified 2026-05-02).
 * v4-pro carries a 75% promotional discount that ENDS 2026-05-31 15:59 UTC.
 * After that date the proxy will fall back to full retail pricing automatically.
 *
 * Update strategy: bump PROMO_END_UTC and DISCOUNT_FACTOR when DeepSeek changes terms.
 */

const PROMO_END_UTC = '2026-05-31T15:59:00Z';

const PRICING_DISCOUNTED = {
    'deepseek-v4-pro':      { input: 0.435,  cachedInput: 0.003625, output: 0.87 },
    'deepseek-v4-pro[1m]':  { input: 0.435,  cachedInput: 0.003625, output: 0.87 },
    'deepseek-v4-flash':    { input: 0.14,   cachedInput: 0.0028,   output: 0.28 },
    _default:               { input: 0.435,  cachedInput: 0.003625, output: 0.87 },
};

const PRICING_RETAIL = {
    'deepseek-v4-pro':      { input: 1.74,   cachedInput: 0.0145,   output: 3.48 },
    'deepseek-v4-pro[1m]':  { input: 1.74,   cachedInput: 0.0145,   output: 3.48 },
    'deepseek-v4-flash':    { input: 0.14,   cachedInput: 0.0028,   output: 0.28 },
    _default:               { input: 1.74,   cachedInput: 0.0145,   output: 3.48 },
};

function isPromoActive(now = Date.now()) {
    return now < Date.parse(PROMO_END_UTC);
}

function getPricing(now = Date.now()) {
    return isPromoActive(now) ? PRICING_DISCOUNTED : PRICING_RETAIL;
}

function getRate(model, now = Date.now()) {
    const table = getPricing(now);
    return table[model] || table._default;
}

function daysUntilPromoEnd(now = Date.now()) {
    const ms = Date.parse(PROMO_END_UTC) - now;
    return ms <= 0 ? 0 : Math.ceil(ms / (1000 * 60 * 60 * 24));
}

module.exports = {
    PROMO_END_UTC,
    PRICING_DISCOUNTED,
    PRICING_RETAIL,
    isPromoActive,
    getPricing,
    getRate,
    daysUntilPromoEnd,
};
