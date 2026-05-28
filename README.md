# DeepCode V4

🇪🇸 *[Leer en Español](./README-es.md)*

![DeepCode V4 in action](./screenshot-1.png)

**DeepSeek V4 Pro + Claude Code + Local Vision.** A single command. The ultimate proxy that makes DeepSeek work seamlessly as if it were Claude — with native tool-calling, 1M context tokens, and **image support** via local LLMs. All for a fraction of the cost.

## ✨ Why DeepCode?

- 👁️ **Vision for DeepSeek** — DeepSeek doesn't support images. DeepCode does. It auto-detects Ollama or LM Studio and gives DeepSeek eyes using a local vision model. Zero configuration required.
- 🧠 **Native Thinking Mode Support** — Renders DeepSeek's reasoning (R1) directly into Claude Code's collapsible `∴ Thinking…` block. Supports chained tool-calls without losing context.
- 🎛️ **Native Effort Control** — Use the `/effort low` or `/effort max` commands in the console; the proxy translates Anthropic's tokens to DeepSeek's engine in real-time.
- 🔧 **100% compatible with Claude Code** — Same flags, same tools, same environment. Use `deepcode` exactly as you would use `claude`.
- 💰 **95% cheaper** — DeepSeek V4 Pro costs ~$0.04 for every $0.90 you would spend on Claude Sonnet.
- 🔄 **Continue Claude sessions** — Ran out of tokens? Run `deepcode --resume` and pick up right where you left off.
- 📊 **Real-time Statusline** — Track tokens consumed and direct costs right in the bottom bar of Claude Code.

## 📦 Prerequisites

Before installing DeepCode, make sure you have:

1. **Claude Code** installed and working on your system. You can install it following the [official Anthropic guide](https://docs.anthropic.com/en/docs/claude-code/overview).
2. **DeepSeek V4 API Key** — Get your key at [platform.deepseek.com](https://platform.deepseek.com). DeepCode uses this API key to route requests to DeepSeek V4 Pro.

> [!IMPORTANT]
> Without Claude Code installed, `deepcode` will not run. Without a valid DeepSeek API key, requests cannot be processed.

## 🚀 Installation

```bash
npm install -g deepcode-v4
```

On the **first launch**, if no `DEEPSEEK_API_KEY` is found, DeepCode prompts for it in the console (masked input), validates the format (`sk-...`), and saves it globally to `~/.deepcode-v4/.env`. You only do this **once** — works across all projects, no per-project `.env` required.

```bash
deepcode            # First run → prompts for API key, then starts
deepcode --setup    # Reconfigure / replace the saved API key
```

Get your key at [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys).

## 📋 Usage

```bash
deepcode                              # New session
deepcode "create an Express REST API" # Direct prompt
deepcode --setup                      # Configure or replace global DEEPSEEK_API_KEY
deepcode --no-vision                  # DeepCode specific: Disable auto-detected vision

# --- Native Claude Code Flags ---
# DeepCode acts as a transparent wrapper, so all native Claude flags work flawlessly:
deepcode --resume                     # Open interactive picker to resume a previous session
deepcode --resume <session-id>        # Continue a specific previous session directly
deepcode --dangerously-skip-permissions  # Autonomous mode (auto-approve all tool uses)
```

Any other `claude` flag works perfectly with `deepcode`.

**Native in-console commands:**
- `/effort low` or `/effort max`: Control DeepSeek's thinking depth and time on the fly.
- `/model sonnet`: Instantly switch to the ultra-fast `deepseek-v4-flash` version.

## ⚙️ Configuration

The interactive setup at first launch covers the common case. For advanced setups, `DEEPSEEK_API_KEY` is resolved in this precedence order:

1. Shell environment variable (`export DEEPSEEK_API_KEY=sk-...`)
2. `.env` file walking up from the current working directory (per-project override)
3. `~/.deepcode-v4/.env` (global, written by `deepcode --setup`)

Run `deepcode --setup` anytime to replace the saved global key. Check `.env.example` for all optional vars (model overrides, retry, timeouts, telemetry).

> ⚠️ **Security:** Your API key stays on your local machine. The global file `~/.deepcode-v4/.env` is created with `0600` permissions on POSIX. If you put a `.env` inside a project, remember to add `.env` to your `.gitignore`.

## 👁️ Local Vision (Auto-detected)

DeepSeek cannot see images. **DeepCode gives it eyes.**

When you run `deepcode`, the proxy automatically detects if you have a local vision LLM running. If it finds one, it intercepts images, converts them into highly detailed textual descriptions, and passes them to DeepSeek so it can reason about them. If no local LLM is found, it falls back to normal text mode.

**Enable vision (3 steps):**
1. Install [Ollama](https://ollama.com)
2. Run `ollama pull qwen2-vl:7b`
3. Run `deepcode` — vision is automatically activated!

**Recommended Models:**
| Model | VRAM | Quality |
|--------|------|---------|
| `qwen2-vl:7b` | ~5 GB | Very Good |
| `qwen3-vl:8b` | ~6 GB | Excellent |
| `llava:7b` | ~5 GB | Good |
| `moondream` | ~2 GB | Lightweight |

It also supports **LM Studio** (`localhost:1234`).

## 📜 License

MIT
