'use strict';

const crypto = require('crypto');

const newToolId = () => `tool_${crypto.randomUUID().replace(/-/g, '')}`;

class ToolIdTracker {
    constructor() {
        this._byIndex = new Map();
    }

    getOrAssign(index) {
        if (typeof index !== 'number') return newToolId();
        if (this._byIndex.has(index)) return this._byIndex.get(index);
        const id = newToolId();
        this._byIndex.set(index, id);
        return id;
    }

    get(index) {
        return this._byIndex.get(index);
    }

    has(index) {
        return this._byIndex.has(index);
    }

    set(index, id) {
        if (typeof index === 'number' && id) this._byIndex.set(index, id);
    }

    size() {
        return this._byIndex.size;
    }
}

module.exports = { ToolIdTracker, newToolId };
