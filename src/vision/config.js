'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG_DIR = path.join(os.homedir(), '.deepcode-v4');
const CONFIG_PATH = path.join(CONFIG_DIR, 'vision.json');

function readConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) return null;
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch { return null; }
}

function writeConfig(config) {
    try {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');
        return true;
    } catch { return false; }
}

function clearConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH);
        return true;
    } catch { return false; }
}

module.exports = { readConfig, writeConfig, clearConfig, CONFIG_PATH };
