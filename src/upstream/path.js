'use strict';

const CANONICAL_PREFIX = '/anthropic';

const KNOWN_SUFFIXES = [
    '/v1/messages/count_tokens',
    '/v1/messages',
    '/v1/models',
    '/v1/complete',
];

function canonicalizeUpstreamPath(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') {
        return CANONICAL_PREFIX + '/v1/messages';
    }

    const qIdx = rawUrl.indexOf('?');
    let pathPart = qIdx === -1 ? rawUrl : rawUrl.slice(0, qIdx);
    const query = qIdx === -1 ? '' : rawUrl.slice(qIdx);

    while (pathPart.startsWith(CANONICAL_PREFIX + CANONICAL_PREFIX)) {
        pathPart = pathPart.slice(CANONICAL_PREFIX.length);
    }
    if (pathPart.startsWith(CANONICAL_PREFIX + '/')) {
        pathPart = pathPart.slice(CANONICAL_PREFIX.length);
    } else if (pathPart === CANONICAL_PREFIX) {
        pathPart = '/v1/messages';
    }

    if (pathPart === '' || pathPart === '/') {
        pathPart = '/v1/messages';
    }

    if (!pathPart.startsWith('/')) {
        pathPart = '/' + pathPart;
    }

    let matched = false;
    for (const suffix of KNOWN_SUFFIXES) {
        if (pathPart === suffix || pathPart.startsWith(suffix + '/')) {
            matched = true;
            break;
        }
    }

    if (!matched && /^\/messages(?:\/|$)/.test(pathPart)) {
        pathPart = '/v1' + pathPart;
        matched = true;
    }

    if (!matched && !pathPart.startsWith('/v1/')) {
        pathPart = '/v1/messages';
    }

    return CANONICAL_PREFIX + pathPart + query;
}

module.exports = { canonicalizeUpstreamPath };
