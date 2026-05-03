'use strict';

const http = require('http');

const VISION_PATTERNS = [
    'llava', 'bakllava', 'moondream', 'minicpm-v', 'minicpm_v',
    'cogvlm', 'yi-vl', 'internvl', 'qwen-vl', 'qwen2-vl', 'qwen2.5-vl', 'qwen3-vl',
    'llama-3.2-vision', 'gemma-3',
];

function isVisionModel(name) {
    const lower = (name || '').toLowerCase();
    return VISION_PATTERNS.some(p => lower.includes(p));
}

function httpGet(url, timeoutMs = 3000) {
    return new Promise((resolve) => {
        const req = http.get(url, { timeout: timeoutMs }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch { resolve(null); }
            });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
    });
}

async function detectOllama(endpoint = 'http://localhost:11434') {
    const data = await httpGet(`${endpoint}/api/tags`);
    if (!data || !Array.isArray(data.models)) return null;
    const visionModels = data.models.map(m => m.name || '').filter(isVisionModel);
    if (visionModels.length === 0) return null;
    return { provider: 'ollama', endpoint, model: visionModels[0], allVisionModels: visionModels };
}

async function detectLMStudio(endpoint = 'http://localhost:1234') {
    const data = await httpGet(`${endpoint}/v1/models`);
    if (!data || !Array.isArray(data.data)) return null;
    const visionModels = data.data.map(m => m.id || '').filter(isVisionModel);
    if (visionModels.length === 0) return null;
    return { provider: 'lmstudio', endpoint, model: visionModels[0], allVisionModels: visionModels };
}

async function detectVisionProvider() {
    const ollama = await detectOllama();
    if (ollama) return ollama;
    const lmstudio = await detectLMStudio();
    if (lmstudio) return lmstudio;
    return null;
}

async function verifyProvider(config) {
    if (!config || !config.provider) return false;
    if (config.provider === 'ollama') return (await detectOllama(config.endpoint)) !== null;
    if (config.provider === 'lmstudio') return (await detectLMStudio(config.endpoint)) !== null;
    return false;
}

module.exports = { detectVisionProvider, verifyProvider, isVisionModel };
