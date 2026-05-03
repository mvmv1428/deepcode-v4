'use strict';

const THINKING_OPEN = '<deepseek_thinking>';
const THINKING_CLOSE = '</deepseek_thinking>';
const REDACTED_PLACEHOLDER = '[REDACTED THINKING — original signature stripped for portability]';

function wrapThinkingText(rawText) {
    const inner = (typeof rawText === 'string' ? rawText : '').trim();
    return `${THINKING_OPEN}\n${inner}\n${THINKING_CLOSE}`;
}

function transformBlock(block) {
    if (!block || typeof block !== 'object') return { block, changed: false };

    if (block.type === 'thinking') {
        return {
            block: { type: 'text', text: wrapThinkingText(block.thinking) },
            changed: true,
        };
    }

    if (block.type === 'redacted_thinking') {
        return {
            block: { type: 'text', text: REDACTED_PLACEHOLDER },
            changed: true,
        };
    }

    return { block, changed: false };
}

function transformContentArray(content) {
    if (!Array.isArray(content)) return { content, changed: false };
    let changed = false;
    const out = content.map(b => {
        const r = transformBlock(b);
        if (r.changed) changed = true;
        return r.block;
    });
    return { content: out, changed };
}

function transformLineObject(obj) {
    if (!obj || typeof obj !== 'object') return { obj, changed: false };

    let changed = false;

    if (obj.message && Array.isArray(obj.message.content)) {
        const r = transformContentArray(obj.message.content);
        if (r.changed) {
            obj.message.content = r.content;
            changed = true;
        }
    }

    if (Array.isArray(obj.content)) {
        const r = transformContentArray(obj.content);
        if (r.changed) {
            obj.content = r.content;
            changed = true;
        }
    }

    return { obj, changed };
}

function transformLine(rawLine) {
    if (!rawLine || !rawLine.trim()) {
        return { line: rawLine, changed: false, parsed: false };
    }
    let obj;
    try {
        obj = JSON.parse(rawLine);
    } catch {
        return { line: rawLine, changed: false, parsed: false };
    }
    const result = transformLineObject(obj);
    if (!result.changed) {
        return { line: rawLine, changed: false, parsed: true };
    }
    return { line: JSON.stringify(result.obj), changed: true, parsed: true };
}

function transformJsonl(content) {
    const lines = content.split(/\r?\n/);
    let modifiedCount = 0;
    let parsedCount = 0;
    const outLines = lines.map(l => {
        const r = transformLine(l);
        if (r.parsed) parsedCount += 1;
        if (r.changed) modifiedCount += 1;
        return r.line;
    });
    return {
        content: outLines.join('\n'),
        modifiedCount,
        parsedCount,
        totalLines: lines.length,
    };
}

module.exports = {
    transformLine,
    transformLineObject,
    transformBlock,
    transformContentArray,
    transformJsonl,
    wrapThinkingText,
    THINKING_OPEN,
    THINKING_CLOSE,
    REDACTED_PLACEHOLDER,
};
