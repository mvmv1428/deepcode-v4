'use strict';

/**
 * DeepSeek V4 pricing — single source of truth.
 *
 * Source: https://api-docs.deepseek.com/quick_start/pricing (verified 2026-05-31).
 * DeepSeek has frozen these rates indefinitely.
 *
 * Prices are per 1M tokens (USD).
 */

const PRICING = {
    // Standard model identifier
    'deepseek-v4-pro':      { input: 0.435,  cachedInput: 0.003625, output: 0.87 },
    // 1M context variant mapped for compatibility with some client statuslines
    'deepseek-v4-pro[1m]':  { input: 0.435,  cachedInput: 0.003625, output: 0.87 },
    'deepseek-v4-flash':    { input: 0.14,   cachedInput: 0.0028,   output: 0.28 },
    _default:               { input: 0.435,  cachedInput: 0.003625, output: 0.87 },
};

function getRate(model) {
    return PRICING[model] || PRICING._default;
}

module.exports = {
    PRICING,
    getRate,
};
