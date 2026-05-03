'use strict';

const { ToolIdTracker } = require('./toolIdTracker');
const usageTracker = require('../debug/usageTracker'); // DEBUG_USAGE

const EVENT_SEPARATOR_RE = /\r?\n\r?\n/;

function splitBuffer(prevBuffer, chunk) {
    const merged = prevBuffer + chunk;
    const parts = merged.split(EVENT_SEPARATOR_RE);
    const leftover = parts.pop();
    return { events: parts, leftover: leftover || '' };
}

function parseEvent(rawEvent) {
    const lines = rawEvent.split(/\r?\n/);
    let eventName = null;
    const dataParts = [];
    const otherLines = [];

    for (const line of lines) {
        if (line.startsWith('event:')) {
            if (eventName === null) {
                eventName = line.slice(6).trimStart();
            }
        } else if (line.startsWith('data:')) {
            dataParts.push(line.slice(5).replace(/^ /, ''));
        } else if (line.length > 0) {
            otherLines.push(line);
        }
    }

    const dataString = dataParts.join('\n');
    let dataObj = null;
    let isDone = false;

    if (dataParts.length > 0) {
        if (dataString.trim() === '[DONE]') {
            isDone = true;
        } else {
            try {
                dataObj = JSON.parse(dataString);
            } catch {
                dataObj = null;
            }
        }
    }

    return { eventName, dataString, dataObj, isDone, otherLines, hadData: dataParts.length > 0 };
}

function serializeEvent({ eventName, dataString, otherLines = [] }) {
    const lines = [];
    for (const o of otherLines) lines.push(o);
    if (eventName) lines.push(`event: ${eventName}`);
    if (dataString !== null && dataString !== undefined) {
        const parts = String(dataString).split('\n');
        for (const p of parts) lines.push(`data: ${p}`);
    }
    return lines.join('\n');
}

function logCacheUsage(usage) {
    if (!usage || typeof usage !== 'object') return;
    const hit = usage.prompt_cache_hit_tokens;
    const miss = usage.prompt_cache_miss_tokens;
    if (typeof hit === 'number' || typeof miss === 'number') {
        const h = typeof hit === 'number' ? hit : 0;
        const m = typeof miss === 'number' ? miss : 0;
        console.error(`[deepcode-v4] cache hit=${h} miss=${m} (total input=${h + m})`);
    }
    if (usageTracker.isEnabled()) usageTracker.recordUsage(usage); // DEBUG_USAGE
}

function transformEvent(rawEvent, tracker) {
    const parsed = parseEvent(rawEvent);

    if (!parsed.hadData) return rawEvent;
    if (parsed.isDone) return rawEvent;

    if (!parsed.dataObj) return rawEvent;

    const data = parsed.dataObj;

    try {
        if (data.type === 'content_block_start' && data.content_block?.type === 'tool_use') {
            const idx = data.index;
            if (data.content_block.id) {
                tracker.set(idx, data.content_block.id);
            } else {
                data.content_block.id = tracker.getOrAssign(idx);
            }
        } else if (data.type === 'content_block_delta') {
            const idx = data.index;
            if (data.delta && data.delta.type === 'tool_use' && !data.delta.id) {
                data.delta.id = tracker.has(idx) ? tracker.get(idx) : tracker.getOrAssign(idx);
            }
        } else if (data.type === 'message_delta' && Array.isArray(data.delta?.content)) {
            // Inject IDs into tool_use blocks inside message_delta events
            data.delta.content = data.delta.content.map(b =>
                b.type === 'tool_use' && !b.id ? { ...b, id: tracker.getOrAssign(undefined) } : b
            );
        }

        if (data.type === 'message_start') {
            logCacheUsage(data.message?.usage);
        } else if (data.type === 'message_delta') {
            logCacheUsage(data.usage);
        }
    } catch {
        return rawEvent;
    }

    let eventName = parsed.eventName;
    if (!eventName && typeof data.type === 'string') {
        eventName = data.type;
    }

    return serializeEvent({
        eventName,
        dataString: JSON.stringify(data),
        otherLines: parsed.otherLines,
    });
}

function createStreamProcessor() {
    const tracker = new ToolIdTracker();
    let buffer = '';

    return {
        push(chunkStr) {
            const { events, leftover } = splitBuffer(buffer, chunkStr);
            buffer = leftover;
            const out = [];
            for (const ev of events) {
                if (!ev.trim()) continue;
                out.push(transformEvent(ev, tracker));
            }
            return out;
        },
        flush() {
            const remainder = buffer;
            buffer = '';
            if (!remainder.trim()) return [];
            return [transformEvent(remainder, tracker)];
        },
        tracker,
    };
}

module.exports = {
    splitBuffer,
    parseEvent,
    serializeEvent,
    transformEvent,
    createStreamProcessor,
};
