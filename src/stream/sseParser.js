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
    if (process.env.DEEPCODE_DEBUG_CACHE === '1') {
        const hit = usage.prompt_cache_hit_tokens;
        const miss = usage.prompt_cache_miss_tokens;
        if (typeof hit === 'number' || typeof miss === 'number') {
            const h = typeof hit === 'number' ? hit : 0;
            const m = typeof miss === 'number' ? miss : 0;
            console.error(`[deepcode] cache hit=${h} miss=${m} (total input=${h + m})`);
        }
    }
    if (usageTracker.isEnabled()) usageTracker.recordUsage(usage);
}

// ---------------------------------------------------------------------------
// Reasoning / Thinking helpers
// ---------------------------------------------------------------------------

/**
 * Build a serialized SSE event string from a data object and event name.
 */
function buildSSE(eventName, dataObj) {
    return serializeEvent({ eventName, dataString: JSON.stringify(dataObj) });
}

/**
 * Create a synthetic content_block_start event for a thinking block.
 */
function syntheticThinkingStart(index) {
    return buildSSE('content_block_start', {
        type: 'content_block_start',
        index,
        content_block: { type: 'thinking', thinking: '' },
    });
}

/**
 * Create a synthetic content_block_delta with thinking_delta payload.
 */
function syntheticThinkingDelta(index, text) {
    return buildSSE('content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: { type: 'thinking_delta', thinking: text },
    });
}

/**
 * Create a synthetic content_block_stop event.
 */
function syntheticBlockStop(index) {
    return buildSSE('content_block_stop', {
        type: 'content_block_stop',
        index,
    });
}

// ---------------------------------------------------------------------------
// Main transform — now returns a single string OR an array of strings
// ---------------------------------------------------------------------------

function transformEvent(rawEvent, tracker, thinkingState) {
    const parsed = parseEvent(rawEvent);

    if (!parsed.hadData) return rawEvent;
    if (parsed.isDone) return rawEvent;

    if (!parsed.dataObj) return rawEvent;

    const data = parsed.dataObj;
    const extra = []; // synthetic events to inject BEFORE this event

    try {
        // ----- Reasoning / Thinking handling --------------------------------

        // Case 1: DeepSeek sends reasoning_content inside a content_block_delta
        //         (non-standard field). Convert to proper thinking_delta.
        if (data.type === 'content_block_delta' && data.delta) {
            const rc = data.delta.reasoning_content;
            if (rc != null && rc !== '') {
                if (!thinkingState.started) {
                    thinkingState.started = true;
                    thinkingState.index = data.index != null ? data.index : 0;
                    extra.push(syntheticThinkingStart(thinkingState.index));
                }
                extra.push(syntheticThinkingDelta(thinkingState.index, rc));
                // If there's no other useful content in this delta, suppress
                // the original event to avoid an empty/duplicate block.
                if (!data.delta.text && data.delta.type !== 'tool_use') {
                    return extra;
                }
                // Otherwise, strip reasoning_content and let the rest through.
                delete data.delta.reasoning_content;
            }
        }

        // Case 2: DeepSeek sends reasoning_content at the top level of a
        //         message_start or message_delta event.
        if ((data.type === 'message_start' || data.type === 'message_delta') && data.reasoning_content) {
            if (!thinkingState.started) {
                thinkingState.started = true;
                thinkingState.index = 0;
                extra.push(syntheticThinkingStart(thinkingState.index));
            }
            extra.push(syntheticThinkingDelta(thinkingState.index, data.reasoning_content));
            delete data.reasoning_content;
        }

        // Case 3: Standard Anthropic thinking block starts — track it so we
        //         don't inject duplicates.
        if (data.type === 'content_block_start' && data.content_block?.type === 'thinking') {
            thinkingState.started = true;
            thinkingState.index = data.index != null ? data.index : 0;
            thinkingState.native = true; // DeepSeek sent native thinking
        }

        // Case 4: A non-thinking content block starts AFTER we opened a
        //         synthetic thinking block. Close it first.
        if (data.type === 'content_block_start'
            && data.content_block?.type !== 'thinking'
            && thinkingState.started
            && !thinkingState.native
            && !thinkingState.closed) {
            thinkingState.closed = true;
            extra.push(syntheticBlockStop(thinkingState.index));
            // Bump all subsequent indices by 1 to account for the synthetic
            // thinking block we injected at thinkingState.index.
            if (typeof data.index === 'number') {
                data.index = Math.max(data.index, thinkingState.index + 1);
            }
        }

        // ----- Tool ID handling (existing logic, unchanged) -----------------

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

        // ----- Cache usage logging (existing logic, unchanged) --------------

        if (data.type === 'message_start') {
            logCacheUsage(data.message?.usage);
        } else if (data.type === 'message_delta') {
            logCacheUsage(data.usage);
        }
    } catch (err) {
        if (process.env.DEEPCODE_DEBUG === '1') {
            console.error('[deepcode] SSE transform error:', err.message);
        }
        return rawEvent;
    }

    let eventName = parsed.eventName;
    if (!eventName && typeof data.type === 'string') {
        eventName = data.type;
    }

    const thisEvent = serializeEvent({
        eventName,
        dataString: JSON.stringify(data),
        otherLines: parsed.otherLines,
    });

    if (extra.length > 0) {
        extra.push(thisEvent);
        return extra;
    }
    return thisEvent;
}

function createStreamProcessor() {
    const tracker = new ToolIdTracker();
    const thinkingState = { started: false, index: null, native: false, closed: false };
    let buffer = '';

    return {
        push(chunkStr) {
            const { events, leftover } = splitBuffer(buffer, chunkStr);
            buffer = leftover;
            const out = [];
            for (const ev of events) {
                if (!ev.trim()) continue;
                const result = transformEvent(ev, tracker, thinkingState);
                if (Array.isArray(result)) {
                    for (const r of result) out.push(r);
                } else {
                    out.push(result);
                }
            }
            return out;
        },
        flush() {
            const remainder = buffer;
            buffer = '';
            const out = [];
            // Close any open synthetic thinking block before stream ends
            if (thinkingState.started && !thinkingState.native && !thinkingState.closed) {
                thinkingState.closed = true;
                out.push(syntheticBlockStop(thinkingState.index));
            }
            if (remainder.trim()) {
                const result = transformEvent(remainder, tracker, thinkingState);
                if (Array.isArray(result)) {
                    for (const r of result) out.push(r);
                } else {
                    out.push(result);
                }
            }
            return out;
        },
        tracker,
        thinkingState,
    };
}

module.exports = {
    splitBuffer,
    parseEvent,
    serializeEvent,
    transformEvent,
    createStreamProcessor,
};
