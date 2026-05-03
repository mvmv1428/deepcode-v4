'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const dotenv = require('dotenv');

let _loaded = false;
let _loadedFrom = null;

function findEnvFileWalkUp(startDir) {
    let dir = path.resolve(startDir);
    const root = path.parse(dir).root;
    while (true) {
        const candidate = path.join(dir, '.env');
        if (fs.existsSync(candidate)) return candidate;
        if (dir === root) return null;
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

function findGlobalEnvFile() {
    const candidates = [
        path.join(os.homedir(), '.deepcode-v4', '.env'),
        path.join(os.homedir(), '.config', 'deepcode-v4', '.env'),
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    return null;
}

function loadEnv(opts = {}) {
    if (_loaded && !opts.force) {
        return { loaded: true, path: _loadedFrom, cached: true };
    }

    const startDir = opts.startDir || process.cwd();

    let envPath = findEnvFileWalkUp(startDir);
    if (!envPath) envPath = findGlobalEnvFile();

    if (envPath) {
        const result = dotenv.config({ path: envPath });
        if (result.error && !opts.silent) {
            console.error(`[deepcode] dotenv parse error at ${envPath}: ${result.error.message}`);
        }
        _loadedFrom = envPath;
    }

    _loaded = true;
    return { loaded: !!envPath, path: envPath, cached: false };
}

function getConfig() {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    return {
        apiKey,
        upstream: {
            host: process.env.DEEPSEEK_API_HOST || 'api.deepseek.com',
            port: parseInt(process.env.DEEPSEEK_API_PORT || '443', 10),
            tls: process.env.DEEPSEEK_API_TLS !== 'false',
            timeoutMs: parseInt(process.env.DEEPCODE_UPSTREAM_TIMEOUT || '600000', 10),
            streamIdleMs: parseInt(process.env.DEEPCODE_STREAM_IDLE_MS || '60000', 10),
        },
        server: {
            maxBody: parseInt(process.env.DEEPCODE_MAX_BODY || (8 * 1024 * 1024), 10),
            maxSockets: parseInt(process.env.DEEPCODE_MAX_SOCKETS || '128', 10),
        },
        models: {
            primary: process.env.DEEPCODE_PRIMARY_MODEL || 'deepseek-v4-pro[1m]',
            fast: process.env.DEEPCODE_FAST_MODEL || 'deepseek-v4-flash',
            haiku: process.env.DEEPCODE_HAIKU_MODEL || 'deepseek-v4-flash',
        },
        retry: {
            max: parseInt(process.env.DEEPCODE_RETRY_MAX || '2', 10),
            baseMs: parseInt(process.env.DEEPCODE_RETRY_BASE_MS || '250', 10),
            maxMs: parseInt(process.env.DEEPCODE_RETRY_MAX_MS || '4000', 10),
            retryNetworkErrors: process.env.DEEPCODE_RETRY_NETWORK !== 'false',
        },
    };
}

const KNOWN_MODELS = new Set([
    'deepseek-v4-pro',
    'deepseek-v4-pro[1m]',
    'deepseek-v4-flash',
]);

function validateKnownModels(config) {
    const cfg = config || getConfig();
    const checked = [
        ['primary', cfg.models.primary],
        ['fast', cfg.models.fast],
        ['haiku', cfg.models.haiku],
    ];
    const unknown = checked.filter(([, name]) => name && !KNOWN_MODELS.has(name));
    for (const [slot, name] of unknown) {
        console.warn(`[deepcode] warning: model "${name}" (${slot}) not in known list. DeepSeek may silently map it to deepseek-v4-flash.`);
    }
    return unknown.length === 0;
}

function requireApiKey() {
    const { apiKey } = getConfig();
    if (!apiKey) {
        const where = _loadedFrom || '(no .env found)';
        console.error('\n❌ ERROR: DEEPSEEK_API_KEY no encontrado.');
        console.error(`Buscado en: ${where}`);
        console.error('Crea un archivo .env con: DEEPSEEK_API_KEY=sk-...');
        console.error('O exporta la variable directamente en tu shell.\n');
        process.exit(1);
    }
    return apiKey;
}

module.exports = {
    loadEnv,
    getConfig,
    requireApiKey,
    validateKnownModels,
    KNOWN_MODELS,
    findEnvFileWalkUp,
    findGlobalEnvFile,
};
