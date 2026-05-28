'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const { loadEnv, findEnvFileWalkUp, findGlobalEnvFile } = require('./env');

const GLOBAL_DIR = path.join(os.homedir(), '.deepcode-v4');
const GLOBAL_ENV_PATH = path.join(GLOBAL_DIR, '.env');
const DEEPSEEK_KEYS_URL = 'https://platform.deepseek.com/api_keys';

function _parseEnvFile(filePath) {
    const out = {};
    if (!fs.existsSync(filePath)) return out;
    const text = fs.readFileSync(filePath, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        let val = line.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        out[key] = val;
    }
    return out;
}

function _serializeEnv(map) {
    return Object.entries(map)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n') + '\n';
}

function writeGlobalApiKey(apiKey) {
    fs.mkdirSync(GLOBAL_DIR, { recursive: true });
    const merged = _parseEnvFile(GLOBAL_ENV_PATH);
    merged.DEEPSEEK_API_KEY = apiKey;
    fs.writeFileSync(GLOBAL_ENV_PATH, _serializeEnv(merged), { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(GLOBAL_ENV_PATH, 0o600); } catch { /* windows: ignore */ }
    return GLOBAL_ENV_PATH;
}

function validateApiKey(input) {
    if (!input || typeof input !== 'string') return false;
    const v = input.trim();
    if (v.length < 20) return false;
    if (!/^sk-[A-Za-z0-9_\-]+$/.test(v)) return false;
    return true;
}

function _maskedPrompt(question) {
    return new Promise((resolve, reject) => {
        const stdin = process.stdin;
        const stdout = process.stderr;

        stdout.write(question);

        if (typeof stdin.setRawMode !== 'function') {
            const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true });
            rl.question('', (ans) => { rl.close(); resolve(ans); });
            rl.on('error', reject);
            return;
        }

        const wasRaw = stdin.isRaw;
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding('utf8');

        let buf = '';
        let onData;
        const finish = (action) => {
            stdin.setRawMode(wasRaw);
            stdin.pause();
            stdin.removeListener('data', onData);
            stdout.write('\n');
            action();
        };
        onData = (chunk) => {
            for (const ch of chunk) {
                const code = ch.charCodeAt(0);
                if (code === 0x0D || code === 0x0A) return finish(() => resolve(buf));
                if (code === 0x03) return finish(() => reject(new Error('Cancelado por usuario (Ctrl+C)')));
                if (code === 0x04 && buf.length === 0) return finish(() => reject(new Error('EOF en entrada')));
                if (code === 0x7F || code === 0x08) {
                    if (buf.length > 0) {
                        buf = buf.slice(0, -1);
                        stdout.write('\b \b');
                    }
                    continue;
                }
                if (code < 32) continue;
                buf += ch;
                stdout.write('*');
            }
        };
        stdin.on('data', onData);
    });
}

async function promptApiKey({ reason = 'missing' } = {}) {
    const header = reason === 'reconfigure'
        ? '\n🔧 Reconfigurar DEEPSEEK_API_KEY'
        : '\n🔑 DEEPSEEK_API_KEY no configurada';

    process.stderr.write(`${header}\n`);
    process.stderr.write(`Obtén tu key en: ${DEEPSEEK_KEYS_URL}\n`);
    process.stderr.write(`Se guardará en: ${GLOBAL_ENV_PATH}\n\n`);

    for (let attempt = 0; attempt < 3; attempt++) {
        let input;
        try {
            input = await _maskedPrompt('DEEPSEEK_API_KEY (sk-...): ');
        } catch (err) {
            process.stderr.write(`${err.message}\n`);
            process.exit(130);
        }
        const key = (input || '').trim();
        if (!validateApiKey(key)) {
            process.stderr.write('❌ Formato inválido. Debe empezar con "sk-" y tener al menos 20 caracteres.\n\n');
            continue;
        }
        const savedPath = writeGlobalApiKey(key);
        process.env.DEEPSEEK_API_KEY = key;
        process.stderr.write(`✅ Guardado en ${savedPath}\n\n`);
        return { apiKey: key, path: savedPath };
    }

    process.stderr.write('❌ Demasiados intentos inválidos. Aborto.\n');
    process.exit(1);
}

async function ensureApiKey({ force = false } = {}) {
    if (force) {
        delete process.env.DEEPSEEK_API_KEY;
        await promptApiKey({ reason: 'reconfigure' });
        loadEnv({ force: true, silent: true });
        return true;
    }

    if (process.env.DEEPSEEK_API_KEY) return true;

    if (!process.stdin.isTTY) {
        return false;
    }

    await promptApiKey({ reason: 'missing' });
    loadEnv({ force: true, silent: true });
    return true;
}

module.exports = {
    ensureApiKey,
    promptApiKey,
    writeGlobalApiKey,
    validateApiKey,
    GLOBAL_ENV_PATH,
    DEEPSEEK_KEYS_URL,
    findEnvFileWalkUp,
    findGlobalEnvFile,
};
