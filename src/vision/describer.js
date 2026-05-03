'use strict';

const http = require('http');

const DESCRIBE_PROMPT = 'Describe this image concisely. Include: all visible text, UI type, layout, and key elements. If code is visible, transcribe it. Be brief but complete.';

function httpPost(url, body, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const payload = JSON.stringify(body);
        const opts = {
            hostname: parsed.hostname,
            port: parsed.port,
            path: parsed.pathname,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
            timeout: timeoutMs,
        };
        const req = http.request(opts, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch { reject(new Error('Invalid JSON from vision LLM')); }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Vision LLM timeout')); });
        req.write(payload);
        req.end();
    });
}

async function describeWithOllama(base64Data, config) {
    const body = {
        model: config.model,
        messages: [{ role: 'user', content: DESCRIBE_PROMPT, images: [base64Data] }],
        stream: false,
    };
    const result = await httpPost(`${config.endpoint}/api/chat`, body);
    if (result && result.message && result.message.content) return result.message.content;
    throw new Error('No response from Ollama vision model');
}

async function describeWithLMStudio(base64Data, mediaType, config) {
    const body = {
        model: config.model,
        messages: [{
            role: 'user',
            content: [
                { type: 'text', text: DESCRIBE_PROMPT },
                { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64Data}` } },
            ],
        }],
        stream: false,
    };
    const result = await httpPost(`${config.endpoint}/v1/chat/completions`, body);
    if (result && result.choices && result.choices[0] && result.choices[0].message) {
        return result.choices[0].message.content;
    }
    throw new Error('No response from LM Studio vision model');
}

async function describeImage(source, config) {
    const base64Data = source.data;
    const mediaType = source.media_type || 'image/png';
    if (config.provider === 'ollama') return describeWithOllama(base64Data, config);
    if (config.provider === 'lmstudio') return describeWithLMStudio(base64Data, mediaType, config);
    throw new Error(`Unknown vision provider: ${config.provider}`);
}

module.exports = { describeImage, DESCRIBE_PROMPT };
