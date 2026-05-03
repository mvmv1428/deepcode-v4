'use strict';

/**
 * Active-session marker for the DeepCode proxy.
 *
 * Lifecycle:
 *   1. Proxy generates a UUID, writes ~/.claude/deepcode-session-<uuid>.json,
 *      and injects DEEPCODE_V4_SESSION_ID=<uuid> into the Claude Code child env.
 *   2. Claude Code inherits the env. When it spawns the statusline command,
 *      the child also inherits DEEPCODE_V4_SESSION_ID.
 *   3. The statusline reads the env var, locates the marker, and renders
 *      live stats. If the env var is missing, the statusline exits silently.
 *   4. On proxy exit the marker is removed.
 *
 * Marker contents:
 *   { id, pid, startedAt, model, proxyUrl, stats }
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ENV_VAR = 'DEEPCODE_V4_SESSION_ID';

function sessionDir() {
    return path.join(os.homedir(), '.claude');
}

function markerPath(id) {
    return path.join(sessionDir(), `deepcode-session-${id}.json`);
}

function isPidAlive(pid) {
    if (!pid || pid <= 0) return false;
    try { process.kill(pid, 0); return true; }
    catch (e) { return e.code === 'EPERM'; }
}

function newSessionId() {
    return crypto.randomUUID().replace(/-/g, '');
}

function writeMarker(info) {
    try {
        fs.mkdirSync(sessionDir(), { recursive: true });
        const id = info.id || newSessionId();
        const data = {
            id,
            pid: process.pid,
            startedAt: Date.now(),
            ...info,
        };
        fs.writeFileSync(markerPath(id), JSON.stringify(data, null, 2), 'utf8');
        return data;
    } catch {
        return null;
    }
}

function clearMarker(id) {
    try { fs.unlinkSync(markerPath(id)); } catch {}
}

function readMarker(id) {
    if (!id) return null;
    try {
        const raw = fs.readFileSync(markerPath(id), 'utf8');
        const m = JSON.parse(raw);
        if (!isPidAlive(m.pid)) {
            try { fs.unlinkSync(markerPath(id)); } catch {}
            return null;
        }
        return m;
    } catch {
        return null;
    }
}

function readActiveMarker() {
    return readMarker(process.env[ENV_VAR]);
}

module.exports = {
    ENV_VAR,
    newSessionId,
    writeMarker,
    clearMarker,
    readMarker,
    readActiveMarker,
    markerPath,
    isPidAlive,
};
