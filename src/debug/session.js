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

function cleanStaleMarkers() {
    try {
        const dir = sessionDir();
        if (!fs.existsSync(dir)) return;
        const files = fs.readdirSync(dir);
        for (const file of files) {
            if (file.startsWith('deepcode-session-') && file.endsWith('.json')) {
                const p = path.join(dir, file);
                try {
                    const raw = fs.readFileSync(p, 'utf8');
                    const m = JSON.parse(raw);
                    if (m && m.pid && !isPidAlive(m.pid)) {
                        fs.unlinkSync(p);
                    }
                } catch {}
            }
        }
    } catch {}
}

function writeMarker(info) {
    try {
        cleanStaleMarkers();
        fs.mkdirSync(sessionDir(), { recursive: true });
        const id = info.id || newSessionId();
        const data = {
            ...info,
            id,
            pid: info.pid || process.pid,
            startedAt: info.startedAt || Date.now(),
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
    cleanStaleMarkers,
    markerPath,
    isPidAlive,
};
