#!/usr/bin/env node
'use strict';

const { loadEnv, getConfig } = require('../src/config/env');

const envInfo = loadEnv();

if (process.argv.includes('--help')) {
    console.log(`
deepcode - Proxy optimizado para DeepSeek V4 + Claude Code

Uso:
  deepcode
  deepcode "hazme un script de automatización"

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

const { models } = getConfig();
require('../src/proxy')({ model: models.primary });
