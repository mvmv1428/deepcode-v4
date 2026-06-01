'use strict';

const os = require('os');

const EXPERT_PROMPT_BASE = `
You are an expert Claude Code agent powered by DeepSeek V4.

ENVIRONMENT DETECTION & SHELL RULES:
- The default shell tool (named "Bash" in tool_use) ALWAYS executes in a Bash/POSIX-compatible environment (such as Git Bash), EVEN ON WINDOWS.
- Therefore, when using the "Bash" tool, you MUST ALWAYS use POSIX/Bash syntax (e.g., \`ls\`, \`rm -rf\`, \`pwd\`, \`mkdir -p\`, \`find\`). NEVER use PowerShell cmdlets (e.g., \`Get-ChildItem\`, \`Remove-Item\`, \`Select-Object\`) or cmd.exe internals (e.g., \`dir\`, \`del\`, \`copy\`) inside the Bash tool, as they will fail with Command Not Found.
- On Windows, a native "PowerShell" tool may also be available (when CLAUDE_CODE_USE_POWERSHELL_TOOL=1). Only use PowerShell/cmdlet syntax if using the explicit "PowerShell" tool; otherwise, stick to standard Bash commands.

PATH RULES:
- ALWAYS work inside the CURRENT working directory. Never use ~ or absolute paths unless explicitly told.
- Before any file operation (Write/Edit), run a probe to verify paths: e.g. \`pwd && ls\` or \`cd\` to verify CWD.
- Use relative paths only (e.g. "test-tool.js", not "~/test-tool.js" or "/home/user/...").
- Prefer the "Edit" tool with precise replace when modifying existing files.
- After any cd, immediately verify cwd.

PROCESS SAFETY (CRITICAL — Windows):
- NEVER use \`taskkill /f /im node.exe\` or \`Stop-Process -Name node\` — this kills ALL Node processes including the proxy that powers this session. Doing so will crash the connection.
- To stop a Node server you started, ALWAYS kill by PID: \`taskkill /f /pid <PID>\` or \`Stop-Process -Id <PID>\`.
- Capture the PID when you start a process: \`$proc = Start-Process node -ArgumentList "server.js" -PassThru; $proc.Id\` or use \`start /b node server.js\` and note the PID from output.
- On POSIX the same rule applies: never \`killall node\`. Use \`kill <PID>\` instead.

ERROR PRE-EMPTION:
- File not found → check cwd before retrying with absolute path.
- "command not found" on Windows → verify you are using standard Bash commands rather than PowerShell cmdlets inside the Bash tool.
- ENOENT on a directory create → parent missing; create parent first.
- Long stderr with shell parse errors → quoting wrong for current shell; rewrite without complex heredocs on Windows.

TOOL USAGE:
- Use ONLY official tool_use format. Never output raw XML or <tool_call>.
- Stop immediately after a tool call and wait for tool_result.
- Each tool_use MUST have a unique id. If proxy injects one, do not regenerate.

MODEL CAPABILITIES:
`;

const MODEL_CAP_TEXT_ONLY = `- Text-only (DeepSeek V4). Cannot see images, screenshots, or diagrams.
- If user sends an image, respond politely that you are in text-only mode. Suggest they can enable local vision by installing Ollama (https://ollama.com) with a vision model like qwen2-vl (ollama pull qwen2-vl:7b). DeepCode will auto-detect it on the next session.`;

const MODEL_CAP_VISION = `- DeepSeek V4 with local vision layer enabled. Images sent by the user are automatically analyzed by a local vision model and converted to detailed text descriptions.
- When you see a message containing "[Imagen analizada por visión local", that IS the image content — use the description to understand and respond as if you can see the image.
- You CAN help with images, screenshots, diagrams, and UI mockups through the vision layer.`;

function getExpertPrompt() {
    const isVision = process.env.DEEPCODE_VISION_ENABLED === '1';
    return EXPERT_PROMPT_BASE + (isVision ? MODEL_CAP_VISION : MODEL_CAP_TEXT_ONLY);
}

const TOOL_NAME_REMAP = {
    shell_call: 'Bash',
    bash: 'Bash',
    powershell: 'PowerShell',
    file_edit: 'Edit',
};

const STRIP_BLOCK_TYPES = new Set([
    'mcp_tool_use',
    'mcp_tool_result',
    'server_tool_use',
    'web_search_tool_result',
    'document',
]);

const IMAGE_STUB_TEXT = '[IMAGE_REMOVED: text-only model]';

const WIN_PATH_RE = /[a-zA-Z]:\\[^\s"'<>|?*]+/g;
const HOME_PATH_RE = /\/home\/[^/\s"']+/g;
const TILDE_SLASH_RE = /~\//g;

function sanitizeText(s) {
    if (typeof s !== 'string') return s;
    let res = s;

    // 1. Replace workspace absolute path (CWD) with "." to make it relative
    const cwd = process.cwd();
    if (process.platform === 'win32') {
        const cwdLower = cwd.toLowerCase();
        let idx = 0;
        while ((idx = res.toLowerCase().indexOf(cwdLower, idx)) !== -1) {
            res = res.substring(0, idx) + '.' + res.substring(idx + cwd.length);
            idx += 1;
        }
    } else {
        res = res.split(cwd).join('.');
    }

    // 2. Replace user home directory with "~" to hide personal usernames
    const home = os.homedir();
    if (home) {
        if (process.platform === 'win32') {
            const homeLower = home.toLowerCase();
            let idx = 0;
            while ((idx = res.toLowerCase().indexOf(homeLower, idx)) !== -1) {
                res = res.substring(0, idx) + '~' + res.substring(idx + home.length);
                idx += 1;
            }
        } else {
            res = res.split(home).join('~');
        }
    }

    // 3. Apply standard regex cleanups for paths
    res = res
        .replace(TILDE_SLASH_RE, '')
        .replace(HOME_PATH_RE, '.');

    // 4. Fallback: clean up other Windows absolute paths to .\basename
    res = res.replace(WIN_PATH_RE, (match) => {
        const parts = match.split('\\');
        return '.\\' + parts[parts.length - 1];
    });

    return res;
}

function rebrandSystemText(s) {
    if (typeof s !== 'string') return s;
    return s
        .replace(/Claude Code/gi, 'the coding agent')
        .replace(/Anthropic's official CLI tool/gi, 'advanced coding assistant');
}

function ensureValidInputSchema(schema) {
    if (!schema || typeof schema !== 'object') {
        return { type: 'object' };
    }
    const next = { ...schema };
    if (next.type !== 'object') next.type = 'object';
    // Remove empty properties to save tokens in tool definitions
    if (next.properties && typeof next.properties === 'object' && Object.keys(next.properties).length === 0) {
        delete next.properties;
    }
    return next;
}

function transformSystem(system) {
    const prompt = getExpertPrompt();
    if (!system) {
        return prompt;
    }

    if (typeof system === 'string') {
        // String form has no cache_control hooks. Convert to array and tag the
        // EXPERT_PROMPT block so the upstream caches it across the session.
        return [
            { type: 'text', text: rebrandSystemText(system) },
            { type: 'text', text: prompt, cache_control: { type: 'ephemeral' } },
        ];
    }

    if (Array.isArray(system)) {
        // Preserve cache_control and all existing properties via spread
        const cleaned = system.map(b => {
            if (!b || typeof b !== 'object') return b;
            if (b.type === 'text' && typeof b.text === 'string') {
                return { ...b, text: rebrandSystemText(b.text) };
            }
            return b;
        });
        // Tag the appended EXPERT_PROMPT with ephemeral cache_control so it is
        // billed once and read from cache on every subsequent request. Without
        // this the ~400-token suffix is paid in full on each turn.
        cleaned.push({ type: 'text', text: prompt, cache_control: { type: 'ephemeral' } });
        return cleaned;
    }

    return system;
}

function transformTools(tools) {
    if (!Array.isArray(tools)) return tools;
    return tools.map(tool => {
        if (!tool || typeof tool !== 'object') return tool;
        let t = { ...tool };

        if (t.name && TOOL_NAME_REMAP[t.name]) {
            t.name = TOOL_NAME_REMAP[t.name];
        }

        t.input_schema = ensureValidInputSchema(t.input_schema);

        return t;
    });
}

function syncToolChoice(toolChoice, originalTools, mappedTools) {
    if (!toolChoice || typeof toolChoice !== 'object') return toolChoice;
    if (toolChoice.type !== 'tool' || !toolChoice.name) return toolChoice;
    if (!Array.isArray(originalTools)) return toolChoice;

    const idx = originalTools.findIndex(t => t && t.name === toolChoice.name);
    if (idx === -1) return toolChoice;

    const mappedName = mappedTools[idx] && mappedTools[idx].name;
    if (mappedName && mappedName !== toolChoice.name) {
        return { ...toolChoice, name: mappedName };
    }
    return toolChoice;
}

function transformBlock(block) {
    if (!block || typeof block !== 'object') return block;

    // Preserve thinking / redacted_thinking blocks — DeepSeek requires them
    // to be passed back during tool-call rounds or it returns HTTP 400.
    if (block.type === 'thinking' || block.type === 'redacted_thinking') {
        return block;
    }

    if (block.type === 'image') {
        return { type: 'text', text: IMAGE_STUB_TEXT };
    }

    if (block.type === 'tool_result' && block.is_error) {
        const prefix = 'CRITICAL ERROR:\n';
        if (typeof block.content === 'string') {
            return { ...block, content: prefix + block.content };
        }
        if (Array.isArray(block.content)) {
            return {
                ...block,
                content: block.content.map(c =>
                    c && c.type === 'text' ? { ...c, text: prefix + c.text } : c
                ),
            };
        }
    }

    if (block.type === 'text' && typeof block.text === 'string') {
        return { ...block, text: sanitizeText(block.text) };
    }

    return block;
}

function transformMessages(messages) {
    if (!Array.isArray(messages)) return messages;
    return messages.map(msg => {
        if (!msg || typeof msg !== 'object') return msg;
        const m = { ...msg };
        if (typeof m.content === 'string') {
            m.content = sanitizeText(m.content);
        } else if (Array.isArray(m.content)) {
            m.content = m.content
                .filter(b => b && !STRIP_BLOCK_TYPES.has(b.type))
                .map(transformBlock);
        }

        // DeepSeek thinking-mode + tool-calls: the API requires
        // reasoning_content to be passed back on assistant messages that
        // contained tool_use blocks.  If Claude Code didn't include it
        // but DID include thinking content blocks, synthesize it so
        // DeepSeek doesn't reject the request with HTTP 400.
        if (m.role === 'assistant' && !m.reasoning_content && Array.isArray(m.content)) {
            const thinkingParts = m.content
                .filter(b => b && b.type === 'thinking' && b.thinking)
                .map(b => b.thinking);
            if (thinkingParts.length > 0) {
                m.reasoning_content = thinkingParts.join('\n');
            }
        }

        return m;
    });
}

function sanitizeRequestBody(parsed) {
    if (!parsed || typeof parsed !== 'object') return parsed;

    parsed.system = transformSystem(parsed.system);

    const originalTools = parsed.tools;
    parsed.tools = transformTools(parsed.tools);

    if (parsed.tool_choice) {
        parsed.tool_choice = syncToolChoice(parsed.tool_choice, originalTools, parsed.tools);
        // DeepSeek Anthropic API compatibility: disable_parallel_tool_use is not supported
        if (parsed.tool_choice.disable_parallel_tool_use !== undefined) {
            delete parsed.tool_choice.disable_parallel_tool_use;
        }
    }

    parsed.messages = transformMessages(parsed.messages);

    // Effort control (Improvement #4)
    let effortLevel;

    // We map Anthropic budget_tokens (from Claude Code native /effort) to DeepSeek's effort parameter (DeepSeek only supports 'high' or 'max').
    if (parsed.thinking && parsed.thinking.budget_tokens) {
        const budget = parsed.thinking.budget_tokens;
        // Claude native mappings roughly: low=1024, medium=2048, high=4096, xhigh=8192, max=16384+
        if (budget <= 4096) effortLevel = 'high'; // Map low/medium/high to 'high'
        else effortLevel = 'max'; // Map xhigh/max to 'max'
    }

    if (effortLevel) {
        // DeepSeek documentation supports effort parameter
        parsed.effort = effortLevel;
        // Also set reasoning_effort in case they follow OpenAI convention on some endpoints
        parsed.reasoning_effort = effortLevel;
    }

    return parsed;
}

module.exports = {
    sanitizeRequestBody,
    transformSystem,
    transformTools,
    transformMessages,
    transformBlock,
    sanitizeText,
    ensureValidInputSchema,
    getExpertPrompt,
    IMAGE_STUB_TEXT,
};
