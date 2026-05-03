'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function defaultProjectsDir() {
    return path.join(os.homedir(), '.claude', 'projects');
}

function encodeCwd(cwd) {
    return cwd.replace(/[:\\/]/g, '-');
}

function findProjectDirForCwd(cwd, projectsDir = defaultProjectsDir()) {
    if (!fs.existsSync(projectsDir)) return null;

    let dir = path.resolve(cwd);
    const root = path.parse(dir).root;

    while (true) {
        const candidate = path.join(projectsDir, encodeCwd(dir));
        if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
            return { projectDir: candidate, matchedCwd: dir };
        }
        if (dir === root) return null;
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

function listSessionsForProject(projectDir) {
    if (!projectDir || !fs.existsSync(projectDir)) return [];
    return fs.readdirSync(projectDir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => {
            const full = path.join(projectDir, f);
            const stat = fs.statSync(full);
            return { id: f.replace(/\.jsonl$/, ''), path: full, mtimeMs: stat.mtimeMs, sizeBytes: stat.size };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function resolveSessionPath({ projectDir, sessionId }) {
    if (!sessionId) return null;
    const direct = path.join(projectDir, `${sessionId}.jsonl`);
    if (fs.existsSync(direct)) return direct;
    return null;
}

module.exports = {
    defaultProjectsDir,
    encodeCwd,
    findProjectDirForCwd,
    listSessionsForProject,
    resolveSessionPath,
};
