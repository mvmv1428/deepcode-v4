# DeepCode V4

![DeepCode V4 en acción](./screenshot-1.png)

**DeepSeek V4 Pro + Claude Code + Visión Local.** Un solo comando. El proxy que hace funcionar DeepSeek como si fuera Claude — con tools nativas, 1 millón de tokens de contexto, y **soporte de imágenes** vía LLM local. Todo por una fracción del costo.

## ✨ ¿Qué hace especial a DeepCode?

- 👁️ **Visión con DeepSeek** — DeepSeek no soporta imágenes. DeepCode sí. Auto-detecta Ollama o LM Studio y le da ojos a DeepSeek usando un modelo de visión local. Sin configurar nada.
- 🔧 **100% compatible con Claude Code** — Mismos flags, mismas tools, mismo entorno. Usa `deepcode` igual que usarías `claude`.
- 💰 **95% más barato** — DeepSeek V4 Pro cuesta ~$0.04 por cada $0.90 de Claude Sonnet.
- 🔄 **Continúa sesiones de Claude** — ¿Se te acabaron los tokens? `deepcode --resume` y sigues donde lo dejaste.
- 📊 **Statusline en tiempo real** — Tokens consumidos y costo directo en la barra inferior de Claude Code.

## 🚀 Instalación

```bash
npm install -g deepcode-v4
```

## 📋 Uso

```bash
deepcode                              # Nueva sesión
deepcode --resume                     # Continuar sesión anterior
deepcode --dangerously-skip-permissions  # Modo autónomo
deepcode "crea una API REST con Express" # Prompt directo
```

Cualquier flag de `claude` funciona con `deepcode`.

## ⚙️ Configuración

Configura tu `DEEPSEEK_API_KEY` de una de estas formas:
- Archivo `.env` en tu carpeta de trabajo
- Variable de entorno del sistema
- `~/.deepcode-v4/.env` (recomendado para uso global)

Revisa `.env.example` para ver todas las opciones disponibles.

> ⚠️ **Seguridad:** Tu API key se queda en tu máquina local. Si creas el `.env` dentro de un proyecto, recuerda agregar `.env` a tu `.gitignore`.

## 👁️ Visión Local (Auto-detectada)

DeepSeek no puede ver imágenes. **DeepCode le da ojos.**

Al ejecutar `deepcode`, el proxy detecta automáticamente si tienes un LLM de visión local corriendo. Si lo encuentra, intercepta las imágenes, las convierte en descripciones textuales detalladas y se las pasa a DeepSeek para que razone sobre ellas. Si no encuentra un LLM local, funciona normal en modo texto.

**Activar visión (3 pasos):**
1. Instala [Ollama](https://ollama.com)
2. `ollama pull qwen2-vl:7b`
3. Ejecuta `deepcode` — la visión se activa sola

**Modelos recomendados:**
| Modelo | VRAM | Calidad |
|--------|------|---------|
| `qwen2-vl:7b` | ~5 GB | Muy buena |
| `qwen3-vl:8b` | ~6 GB | Excelente |
| `llava:7b` | ~5 GB | Buena |
| `moondream` | ~2 GB | Ligera |

También soporta **LM Studio** (`localhost:1234`).

## 📜 Licencia

MIT
