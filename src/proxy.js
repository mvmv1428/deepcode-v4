#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const { StringDecoder } = require('string_decoder');

const { loadEnv, getConfig, requireApiKey, validateKnownModels } = require('./config/env');
const { sanitizeRequestBody } = require('./transform/payload');
const { normalizeHeaders } = require('./transform/headers');
const { createStreamProcessor } = require('./stream/sseParser');
const { canonicalizeUpstreamPath } = require('./upstream/path');
const { createRetryClient } = require('./upstream/retry');
const usageTracker = require('./debug/usageTracker'); // DEBUG_USAGE
const sessionMarker = require('./debug/session');

loadEnv();
const config = getConfig();

const httpsAgent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 30000,
    maxSockets: config.server.maxSockets,
});
const httpAgent = new http.Agent({
    keepAlive: true,
    keepAliveMsecs: 30000,
    maxSockets: config.server.maxSockets,
});

function isStreamingResponse(proxyRes, parsedRequest) {
    if (proxyRes.statusCode < 200 || proxyRes.statusCode >= 300) return false;
    const ct = (proxyRes.headers['content-type'] || '').toLowerCase();
    if (ct.includes('text/event-stream')) return true;
    if (parsedRequest && parsedRequest.stream === true) return true;
    return false;
}

function createProxyServer() {
    const apiKey = config.apiKey;
    const {
        host: UPSTREAM_HOST,
        port: UPSTREAM_PORT,
        tls: UPSTREAM_TLS,
        timeoutMs: UPSTREAM_TIMEOUT_MS,
        streamIdleMs: STREAM_IDLE_MS,
    } = config.upstream;
    const MAX_BODY = config.server.maxBody;

    const transport = UPSTREAM_TLS ? https : http;
    const retryClient = createRetryClient({
        transport,
        retry: {
            ...config.retry,
            onRetry: ({ attempt, delay, reason }) => {
                const detail = reason.kind === 'status' ? `status=${reason.status}` : `code=${reason.error?.code || 'unknown'}`;
                console.error(`[deepcode] retry attempt=${attempt} in ${delay}ms (${detail})`);
            },
        },
    });

    return http.createServer((req, res) => {
        const chunks = [];
        let total = 0;
        let aborted = false;

        req.on('data', chunk => {
            total += chunk.length;
            if (total > MAX_BODY) {
                aborted = true;
                res.writeHead(413, { 'content-type': 'text/plain' });
                res.end('payload too large');
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });

        req.on('error', err => {
            if (!res.headersSent) {
                res.writeHead(400);
                res.end(`bad request: ${err.message}`);
            }
        });

        req.on('end', async () => {
            if (aborted) return;

            let bodyStr = Buffer.concat(chunks).toString('utf8');
            let parsed = null;

            try {
                parsed = JSON.parse(bodyStr);

                // Vision layer: convert images to text descriptions BEFORE sanitization
                if (parsed && process.env.DEEPCODE_VISION_ENABLED === '1') {
                    try {
                        const { processVisionBlocks } = require('./vision/processor');
                        await processVisionBlocks(parsed);
                    } catch (e) {
                        console.error('[deepcode] vision error:', e.message);
                    }
                }

                parsed = sanitizeRequestBody(parsed);
                bodyStr = JSON.stringify(parsed);
            } catch {
                // not JSON — forward as-is
            }

            if (usageTracker.isEnabled()) usageTracker.startRequest(parsed?.model); // DEBUG_USAGE

            const outgoingHeaders = normalizeHeaders(req.headers, {
                apiKey,
                upstreamHost: UPSTREAM_HOST,
                bodyByteLength: Buffer.byteLength(bodyStr),
                anthropicVersion: req.headers['anthropic-version'] || '2023-06-01',
            });

            if (res.socket && typeof res.socket.setNoDelay === 'function') {
                res.socket.setNoDelay(true);
            }

            const upstreamPath = canonicalizeUpstreamPath(req.url);

            let streamDone = false;
            let clientClosed = false;
            let idleTimer = null;

            const clearIdleWatchdog = () => {
                if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
            };

            const armIdleWatchdog = (onFire) => {
                clearIdleWatchdog();
                if (!STREAM_IDLE_MS || STREAM_IDLE_MS <= 0) return;
                idleTimer = setTimeout(onFire, STREAM_IDLE_MS);
            };

            const handle = retryClient(
                {
                    hostname: UPSTREAM_HOST,
                    port: UPSTREAM_PORT,
                    path: upstreamPath,
                    method: req.method,
                    headers: outgoingHeaders,
                    timeout: UPSTREAM_TIMEOUT_MS,
                    agent: UPSTREAM_TLS ? httpsAgent : httpAgent,
                },
                bodyStr,
                {
                    onSocket(sock) {
                        if (sock && typeof sock.setNoDelay === 'function') sock.setNoDelay(true);
                    },
                    onTimeout() {
                        // request-level timeout already destroys req inside retry helper
                    },
                    onResponse(proxyRes /*, attempt */) {
                        const streaming = isStreamingResponse(proxyRes, parsed);
                        const headers = { ...proxyRes.headers };

                        if (streaming) {
                            delete headers['content-length'];
                            delete headers['content-encoding'];
                            headers['content-type'] = 'text/event-stream';
                            headers['cache-control'] = 'no-cache';
                            headers['connection'] = 'keep-alive';
                        }

                        res.writeHead(proxyRes.statusCode, headers);
                        if (typeof res.flushHeaders === 'function') res.flushHeaders();

                        if (!streaming) {
                            proxyRes.pipe(res);
                            proxyRes.on('end', () => { streamDone = true; });
                            proxyRes.on('error', err => {
                                console.error('upstream non-stream error:', err.message);
                                streamDone = true;
                                if (!res.writableEnded) res.end();
                            });
                            return;
                        }

                        const decoder = new StringDecoder('utf8');
                        const processor = createStreamProcessor();
                        let paused = false;

                        const fireIdle = () => {
                            console.error(`[deepcode] stream idle ${STREAM_IDLE_MS}ms — destroying upstream socket`);
                            clearIdleWatchdog();
                            streamDone = true;
                            try { proxyRes.destroy(new Error('stream idle timeout')); } catch { }
                            if (!res.writableEnded) {
                                try { res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'timeout', message: 'upstream idle timeout' } })}\n\n`); } catch { }
                                res.end();
                            }
                        };

                        armIdleWatchdog(fireIdle);

                        res.on('drain', () => {
                            if (paused) {
                                paused = false;
                                proxyRes.resume();
                            }
                        });

                        proxyRes.on('data', (chunk) => {
                            armIdleWatchdog(fireIdle);
                            const events = processor.push(decoder.write(chunk));
                            for (const ev of events) {
                                const ok = res.write(`${ev}\n\n`);
                                if (!ok && !paused) {
                                    paused = true;
                                    proxyRes.pause();
                                }
                            }
                        });

                        proxyRes.on('end', () => {
                            clearIdleWatchdog();
                            const tail = decoder.end();
                            if (tail) {
                                const events = processor.push(tail);
                                for (const ev of events) {
                                    if (!res.writableEnded) res.write(`${ev}\n\n`);
                                }
                            }
                            const flushed = processor.flush();
                            for (const ev of flushed) {
                                if (!res.writableEnded) res.write(`${ev}\n\n`);
                            }
                            streamDone = true;
                            if (usageTracker.isEnabled()) usageTracker.endRequest(); // DEBUG_USAGE
                            if (!res.writableEnded) res.end();
                        });

                        proxyRes.on('error', err => {
                            clearIdleWatchdog();
                            if (!clientClosed && err.message !== 'stream idle timeout') {
                                console.error('upstream stream error:', err.message);
                            }
                            streamDone = true;
                            if (!res.writableEnded) res.end();
                        });
                    },
                    onError(err /*, attempt */) {
                        clearIdleWatchdog();
                        if (clientClosed && (err.code === 'ECONNRESET' || err.message === 'socket hang up')) {
                            return;
                        }
                        if (streamDone) {
                            // already finalized (e.g. via idle watchdog) — suppress duplicate noise
                            return;
                        }
                        console.error('\n❌ Proxy error a DeepSeek:', err.message);
                        if (!res.headersSent) {
                            res.writeHead(502, { 'content-type': 'text/plain' });
                            res.end(`upstream error: ${err.message}`);
                        } else if (!res.writableEnded) {
                            res.end();
                        }
                    },
                }
            );

            res.on('close', () => {
                clientClosed = true;
                clearIdleWatchdog();
                if (!streamDone) handle.abort();
            });
        });
    });
}

let _started = false;
function startProxy(options = {}) {
    if (_started) return;
    _started = true;

    if (!config.apiKey && !options.allowMissingKey) {
        requireApiKey();
    }

    validateKnownModels(config);

    const server = createProxyServer();
    server.listen(options.port || 0, '127.0.0.1', () => {
        const port = server.address().port;
        const proxyUrl = `http://127.0.0.1:${port}/anthropic`;


        const sessionId = sessionMarker.newSessionId();
        sessionMarker.writeMarker({
            id: sessionId,
            model: options.model || config.models.primary,
            proxyUrl,
        });
        usageTracker.setSessionId(sessionId);
        const cleanup = () => sessionMarker.clearMarker(sessionId);
        process.on('exit', cleanup);
        process.on('SIGINT', () => { cleanup(); process.exit(0); });
        process.on('SIGTERM', () => { cleanup(); process.exit(0); });

        if (options.noSpawn) return server;

        const env = {
            ...process.env,
            ANTHROPIC_BASE_URL: proxyUrl,
            ANTHROPIC_AUTH_TOKEN: config.apiKey,
            ANTHROPIC_MODEL: options.model || config.models.primary,
            ANTHROPIC_DEFAULT_OPUS_MODEL: options.model || config.models.primary,
            ANTHROPIC_DEFAULT_SONNET_MODEL: config.models.primary,
            ANTHROPIC_DEFAULT_HAIKU_MODEL: config.models.haiku,
            CLAUDE_CODE_SUBAGENT_MODEL: config.models.fast,
            [sessionMarker.ENV_VAR]: sessionId,
        };

        // Filter out deepcode-specific flags before forwarding to Claude Code
        const DEEPCODE_FLAGS = new Set(['--no-vision', '--setup-vision', '--setup', '--set-api-key']);
        const claudeArgs = process.argv.slice(2).filter(a => !DEEPCODE_FLAGS.has(a));

        const isWin = process.platform === 'win32';
        const command = isWin ? 'cmd.exe' : 'npx';
        const args = isWin
            ? ['/c', 'npx', '-y', '@anthropic-ai/claude-code', ...claudeArgs]
            : ['-y', '@anthropic-ai/claude-code', ...claudeArgs];

        const child = spawn(command, args, { env, stdio: 'inherit' });

        child.on('exit', (code) => {
            cleanup();
            server.close();
            process.exit(code || 0);
        });
    });
    return server;
}

module.exports = startProxy;
module.exports.createProxyServer = createProxyServer;

if (require.main === module) startProxy({ model: config.models.primary });
