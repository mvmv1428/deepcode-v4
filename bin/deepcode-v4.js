#!/usr/bin/env node
'use strict';

const { loadEnv, getConfig } = require('../src/config/env');
const { readConfig, writeConfig, clearConfig } = require('../src/vision/config');
const { detectVisionProvider, verifyProvider } = require('../src/vision/detector');

const envInfo = loadEnv();

if (process.argv.includes('--help')) {
    console.log(`
deepcode - Proxy optimizado para DeepSeek V4 + Claude Code

Uso:
  deepcode
  deepcode "hazme un script de automatización"
  deepcode --no-vision           Desactiva la detección de visión local
  deepcode --setup-vision        Re-configura el proveedor de visión

Visión local:
  Si tienes Ollama o LM Studio corriendo con un modelo de visión (ej: qwen2-vl),
  DeepCode lo detecta automáticamente y habilita soporte de imágenes.

Modelos:
- Inicia por defecto con: DeepSeek V4 Pro
- Para cambiar a la versión rápida (Flash), usa dentro de la consola: /model sonnet

Configuración:
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
    console.log('🔄 Configuración de visión eliminada. Se re-detectará en el próximo inicio.');
}

async function main() {
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
