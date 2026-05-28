#!/usr/bin/env node
'use strict';

const { loadEnv, getConfig } = require('../src/config/env');
const { readConfig, writeConfig, clearConfig } = require('../src/vision/config');
const { detectVisionProvider, verifyProvider } = require('../src/vision/detector');
const { ensureApiKey, GLOBAL_ENV_PATH } = require('../src/config/setup');

const envInfo = loadEnv();

if (process.argv.includes('--help')) {
    console.log(`
deepcode - Proxy optimizado para DeepSeek V4 + Claude Code

Uso:
  deepcode
  deepcode "hazme un script de automatización"
  deepcode --no-vision           Desactiva la detección de visión local
  deepcode --setup-vision        Fuerza re-detección del proveedor de visión
  deepcode --setup               Configura o reemplaza DEEPSEEK_API_KEY global

API Key (DeepSeek):
  Al iniciar por primera vez, si no hay DEEPSEEK_API_KEY se solicita por consola
  y se guarda en ~/.deepcode-v4/.env (global, una sola vez para todos los proyectos).
  Usa --setup para reconfigurar la key existente.
  Obtener key: https://platform.deepseek.com/api_keys

Visión local (automática):
  Si tienes Ollama o LM Studio corriendo con un modelo de visión (ej: qwen2-vl),
  DeepCode lo detecta y configura automáticamente al iniciar.
  Usa --no-vision para desactivarlo, o --setup-vision para forzar re-detección.

Modelos:
- Inicia por defecto con: DeepSeek V4 Pro
- Para cambiar a la versión rápida (Flash), usa dentro de la consola: /model sonnet

Configuración de Esfuerzo (NUEVO):
- DeepCode soporta el comando nativo /effort de Claude Code (/effort low, /effort max)
- DeepSeek usa 'max' por defecto (mejor para código complejo)

Configuración de entorno:
- .env resuelto desde: ${envInfo.path || '(no encontrado — exporta DEEPSEEK_API_KEY en tu shell)'}
- Búsqueda walk-up desde CWD, fallback a ~/.deepcode-v4/.env
`);
    process.exit(0);
}

if (process.argv.includes('--version') || process.argv.includes('-v')) {
    console.log(require('../package.json').version);
    process.exit(0);
}

if (process.argv.includes('--setup-vision')) {
    clearConfig();
    console.log('🔄 Config de visión eliminada — se re-detectará automáticamente al iniciar.');
}

const SETUP_FLAG = process.argv.includes('--setup') || process.argv.includes('--set-api-key');

async function main() {
    if (SETUP_FLAG) {
        await ensureApiKey({ force: true });
        console.log('✅ DEEPSEEK_API_KEY configurada. Ejecuta `deepcode` para iniciar.');
        process.exit(0);
    } else {
        const ok = await ensureApiKey();
        if (!ok && !process.env.DEEPSEEK_API_KEY) {
            console.error('\n❌ DEEPSEEK_API_KEY no encontrada y stdin no es interactivo.');
            console.error(`Ejecuta 'deepcode --setup' en una terminal, o crea ${GLOBAL_ENV_PATH} con DEEPSEEK_API_KEY=sk-...`);
            console.error('Obtener key: https://platform.deepseek.com/api_keys\n');
            process.exit(1);
        }
    }

    const noVision = process.argv.includes('--no-vision');

    if (!noVision) {
        // 1. Check existing config
        const saved = readConfig();
        if (saved) {
            const alive = await verifyProvider(saved);
            if (alive) {
                _enableVision(saved);
            } else {
                clearConfig();
            }
        }

        // 2. Auto-detect if no valid config
        if (process.env.DEEPCODE_VISION_ENABLED !== '1') {
            const detected = await detectVisionProvider();
            if (detected) {
                const config = { provider: detected.provider, endpoint: detected.endpoint, model: detected.model };
                writeConfig(config);
                _enableVision(config);
            }
        }
    }

    // Start proxy
    const { models } = getConfig();
    require('../src/proxy')({ model: models.primary });
}

function _enableVision(config) {
    process.env.DEEPCODE_VISION_ENABLED = '1';
    process.env.DEEPCODE_VISION_PROVIDER = config.provider;
    process.env.DEEPCODE_VISION_ENDPOINT = config.endpoint;
    process.env.DEEPCODE_VISION_MODEL = config.model;
}

main().catch(err => {
    console.error('[deepcode] Error fatal:', err.message);
    process.exit(1);
});
