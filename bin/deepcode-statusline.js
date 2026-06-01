#!/usr/bin/env node
'use strict';

/**
 * deepcode-statusline — Claude Code statusLine for the deepcode-v4 proxy.
 *
 * Renders ONLY when Claude Code was launched by `deepcode`. The proxy
 * injects DEEPCODE_V4_SESSION_ID into the child env and writes a session
 * marker. The statusline reads both — missing env or stale marker → no
 * output. Plain Claude Code (no proxy) shows nothing.
 *
 * Output: "⚡ DeepCode | <model> | <reqs> req | <tokens> tok | $<cost>"
 *
 * Modes:
 *   deepcode-statusline                 read stdin JSON, print statusline
 *   deepcode-statusline --install       wire ~/.claude/settings.json
 *   deepcode-statusline --uninstall     remove from settings.json
 *   deepcode-statusline --self-test     force-render (skip marker check)
 *   deepcode-statusline --help
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { readActiveMarker, ENV_VAR } = require('../src/debug/session');

const NO_COLOR = process.env.NO_COLOR === '1' || process.env.DEEPCODE_STATUSLINE_NOCOLOR === '1';
const C = NO_COLOR
    ? new Proxy({}, { get: () => (s) => s })
    : {
        dim:    (s) => `\x1b[2m${s}\x1b[0m`,
        bold:   (s) => `\x1b[1m${s}\x1b[0m`,
        cyan:   (s) => `\x1b[36m${s}\x1b[0m`,
        purple: (s) => `\x1b[35m${s}\x1b[0m`,
        blue:   (s) => `\x1b[34m${s}\x1b[0m`,
        green:  (s) => `\x1b[32m${s}\x1b[0m`,
    };

function fmtTokens(n) {
    if (!n) return '0';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
    return String(n);
}

function fmtUsd(n) {
    if (!n) return '$0';
    if (n >= 1)    return '$' + n.toFixed(2);
    if (n >= 0.01) return '$' + n.toFixed(3);
    return '$' + n.toFixed(4);
}

function readStdinJson(timeoutMs = 200) {
    return new Promise((resolve) => {
        if (process.stdin.isTTY) return resolve(null);
        let data = '';
        const t = setTimeout(() => resolve(null), timeoutMs);
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (c) => { data += c; });
        process.stdin.on('end', () => {
            clearTimeout(t);
            try { resolve(JSON.parse(data)); } catch { resolve(null); }
        });
        process.stdin.on('error', () => { clearTimeout(t); resolve(null); });
    });
}

function modelLabel(model) {
    if (!model) return C.dim('—');
    if (model.includes('flash')) return C.cyan('Flash');
    if (model.includes('pro'))   return C.purple('Pro');
    return C.dim(model);
}

function buildStatusline(marker) {
    const agg = marker.stats || { count: 0, input: 0, output: 0, cost: 0, lastModel: null, lastInput: 0 };
    const model = agg.lastModel || marker.model;
    const ctxTok = typeof agg.lastInput === 'number' ? agg.lastInput : agg.input;

    return [
        C.bold(C.blue('⚡ DeepCode')),
        modelLabel(model),
        `${C.bold(agg.count)} ${C.dim('req')}`,
        `${C.bold(fmtTokens(ctxTok))} ${C.dim('ctx')}`,
        C.green(fmtUsd(agg.cost)),
    ].join(C.dim(' │ '));
}

// ── Install / uninstall ──────────────────────────────────

function settingsPath() {
    return path.join(os.homedir(), '.claude', 'settings.json');
}

function readSettings() {
    const p = settingsPath();
    if (!fs.existsSync(p)) return {};
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

function writeSettings(obj) {
    const p = settingsPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (fs.existsSync(p)) fs.copyFileSync(p, p + '.bak.' + Date.now());
    fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function statuslineCommand() {
    return `node "${path.resolve(__filename)}"`;
}

function install() {
    if (process.env.CI === 'true' || process.env.CI === '1' || process.env.DEEPCODE_NO_POSTINSTALL === '1') {
        return;
    }
    try {
        const settings = readSettings();
        settings.statusLine = { type: 'command', command: statuslineCommand() };
        writeSettings(settings);
        console.log('✓ deepcode statusline registered in ' + settingsPath());
        console.log('  Visible only when Claude Code is launched via `deepcode`.');
    } catch (err) {
        // npm postinstall must never fail the install
        console.error('[deepcode-statusline] install skipped: ' + err.message);
    }
}

function uninstall() {
    try {
        const settings = readSettings();
        if (settings.statusLine && settings.statusLine.command && settings.statusLine.command.includes('deepcode-statusline')) {
            delete settings.statusLine;
            writeSettings(settings);
            console.log('✓ Statusline removed from ' + settingsPath());
        }
    } catch (err) {
        console.error('[deepcode-statusline] uninstall skipped: ' + err.message);
    }
}

function help() {
    console.log(`deepcode-statusline — proxy-gated Claude Code statusLine

Usage:
  deepcode-statusline               read stdin → print line (called by Claude Code)
  deepcode-statusline --install     register in ~/.claude/settings.json
  deepcode-statusline --uninstall   remove from settings.json
  deepcode-statusline --self-test   render with a fake session marker
  deepcode-statusline --help

Visibility rule:
  Renders only when ${ENV_VAR} is in the env AND a matching session marker
  with a live PID exists in ~/.claude/. Plain Claude Code launches show nothing.
`);
}

async function main() {
    const argv = process.argv.slice(2);
    if (argv.includes('--help') || argv.includes('-h')) { help(); return; }
    if (argv.includes('--install'))   { install(); return; }
    if (argv.includes('--uninstall')) { uninstall(); return; }

    if (argv.includes('--self-test')) {
        const fake = {
            startedAt: 0,
            model: 'deepseek-v4-pro[1m]',
            logPath: path.join(process.cwd(), 'usage.jsonl'),
            stats: { count: 5, input: 12400, output: 3200, cost: 0.0183, lastModel: 'deepseek-v4-pro[1m]', lastInput: 2480 },
        };
        process.stdout.write(buildStatusline(fake) + '\n');
        return;
    }

    const marker = readActiveMarker();
    if (!marker) {
        // Drain stdin so Claude Code does not block on the pipe
        await readStdinJson(50);
        return; // silent — proxy not active
    }

    await readStdinJson(); // drain even if unused
    process.stdout.write(buildStatusline(marker));
}

main().catch(() => { /* never crash Claude Code's status refresh */ });
