'use strict';

const HOP_BY_HOP = [
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailers',
    'transfer-encoding',
    'upgrade',
    'accept-encoding',
    'content-length',
    'host',
];

function normalizeHeaders(incoming, { apiKey, upstreamHost, bodyByteLength, anthropicVersion }) {
    const out = {};
    for (const [k, v] of Object.entries(incoming || {})) {
        const lk = k.toLowerCase();
        if (HOP_BY_HOP.includes(lk)) continue;
        if (lk === 'x-api-key') continue;
        if (lk === 'authorization') continue;
        out[lk] = v;
    }

    out['authorization'] = `Bearer ${apiKey}`;
    out['host'] = upstreamHost;
    out['content-length'] = bodyByteLength;

    if (!out['anthropic-version']) {
        out['anthropic-version'] = anthropicVersion || '2023-06-01';
    }

    return out;
}

module.exports = { normalizeHeaders, HOP_BY_HOP };
