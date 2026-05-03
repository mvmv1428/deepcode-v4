#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const {
    defaultProjectsDir,
    findProjectDirForCwd,
    listSessionsForProject,
    resolveSessionPath,
} = require('../src/cleaner/pathLocator');
const { transformJsonl } = require('../src/cleaner/transformer');

function parseArgs(argv) {
    const args = { _: [], flags: {} };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--help' || a === '-h') args.flags.help = true;
        else if (a === '--version' || a === '-v') args.flags.version = true;
        else if (a === '--all') args.flags.all = true;
        else if (a === '--dry-run' || a === '-n') args.flags.dryRun = true;
        else if (a === '--no-backup') args.flags.noBackup = true;
        else if (a === '--quiet' || a === '-q') args.flags.quiet = true;
        else if (a === '--list' || a === '-l') args.flags.list = true;
        else if (a === '--session' || a === '-s') args.flags.session = argv[++i];
        else if (a === '--cwd') args.flags.cwd = argv[++i];
        else if (a === '--projects-dir') args.flags.projectsDir = argv[++i];
        else if (a === '--file' || a === '-f') args.flags.file = argv[++i];
        else if (a.startsWith('--')) { console.error(`unknown flag: ${a}`); process.exit(2); }
        else args._.push(a);
    }
    if (args._.length > 0 && !args.flags.session) args.flags.session = args._[0];
    return args.flags;
}

function printHelp() {
    console.log(`
deepcode-clean — sanitize Claude Code transcripts (.jsonl) for cross-API portability.

Converts assistant "thinking" / "redacted_thinking" blocks into "text" blocks wrapped in
<deepseek_thinking>...</deepseek_thinking>, removing the cryptographic signature that makes
DeepSeek-generated histories incompatible with Anthropic's signature validator.

Usage:
  deepcode-clean                       Clean newest session for current directory's project
  deepcode-clean <session-id>          Clean specific session by UUID
  deepcode-clean --all                 Clean every session in current project
  deepcode-clean --list                List sessions for current project (no changes)
  deepcode-clean --file <path>         Clean an explicit .jsonl path
  deepcode-clean --cwd <path>          Treat <path> as the project root (instead of CWD)
  deepcode-clean --projects-dir <path> Override Claude projects dir (default ~/.claude/projects)
  deepcode-clean --dry-run, -n         Report what would change, write nothing
  deepcode-clean --no-backup           Skip writing <file>.bak (default backup ON)
  deepcode-clean --quiet, -q           Minimal output
  deepcode-clean --help, -h            Show this help
  deepcode-clean --version, -v         Show version

Examples:
  deepcode-clean
  deepcode-clean 6b8f55c1-b477-4130-9b04-261a7bb33883
  deepcode-clean --all --dry-run
  deepcode-clean --file ~/.claude/projects/<dir>/<uuid>.jsonl
`);
}

function backupAndWrite(filePath, newContent, { noBackup }) {
    if (!noBackup) {
        const bak = filePath + '.bak';
        fs.copyFileSync(filePath, bak);
    }
    const tmp = filePath + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, newContent, 'utf8');
    fs.renameSync(tmp, filePath);
}

function cleanFile(filePath, { dryRun, noBackup, quiet }) {
    const original = fs.readFileSync(filePath, 'utf8');
    const result = transformJsonl(original);

    if (!quiet) {
        const action = dryRun ? '[DRY-RUN]' : '[CLEAN]';
        console.log(`${action} ${filePath}`);
        console.log(`  lines=${result.totalLines}  parsed=${result.parsedCount}  rewritten=${result.modifiedCount}`);
    }

    if (result.modifiedCount === 0) {
        if (!quiet) console.log('  (no thinking blocks found — file unchanged)');
        return { changed: false, modifiedCount: 0 };
    }

    if (dryRun) {
        return { changed: false, modifiedCount: result.modifiedCount, dryRun: true };
    }

    backupAndWrite(filePath, result.content, { noBackup });
    if (!quiet) {
        const bakNote = noBackup ? '(no backup written)' : `backup → ${filePath}.bak`;
        console.log(`  wrote ${result.modifiedCount} block(s). ${bakNote}`);
    }
    return { changed: true, modifiedCount: result.modifiedCount };
}

function main() {
    const flags = parseArgs(process.argv.slice(2));

    if (flags.help) { printHelp(); process.exit(0); }
    if (flags.version) {
        console.log(require('../package.json').version);
        process.exit(0);
    }

    if (flags.file) {
        if (!fs.existsSync(flags.file)) {
            console.error(`file not found: ${flags.file}`);
            process.exit(1);
        }
        const r = cleanFile(path.resolve(flags.file), flags);
        process.exit(r.modifiedCount > 0 || r.changed ? 0 : 0);
    }

    const cwd = path.resolve(flags.cwd || process.cwd());
    const projectsDir = flags.projectsDir ? path.resolve(flags.projectsDir) : defaultProjectsDir();

    if (!fs.existsSync(projectsDir)) {
        console.error(`Claude projects dir not found: ${projectsDir}`);
        console.error('Set --projects-dir or run Claude Code at least once.');
        process.exit(1);
    }

    const located = findProjectDirForCwd(cwd, projectsDir);
    if (!located) {
        console.error(`No Claude Code project dir found for cwd: ${cwd}`);
        console.error(`Searched walking up under: ${projectsDir}`);
        console.error('Pass --cwd <path-to-project-root> if your sessions live elsewhere.');
        process.exit(1);
    }

    if (!flags.quiet) {
        console.log(`Project dir: ${located.projectDir}`);
        if (located.matchedCwd !== cwd) {
            console.log(`(matched walking up from ${cwd} → ${located.matchedCwd})`);
        }
    }

    const sessions = listSessionsForProject(located.projectDir);
    if (sessions.length === 0) {
        console.error('No .jsonl sessions in project dir.');
        process.exit(1);
    }

    if (flags.list) {
        console.log(`\n${sessions.length} session(s):`);
        for (const s of sessions) {
            const when = new Date(s.mtimeMs).toISOString();
            const kb = (s.sizeBytes / 1024).toFixed(1);
            console.log(`  ${s.id}  ${kb} KB  ${when}`);
        }
        process.exit(0);
    }

    let targets;
    if (flags.all) {
        targets = sessions.map(s => s.path);
    } else if (flags.session) {
        const direct = resolveSessionPath({ projectDir: located.projectDir, sessionId: flags.session });
        if (!direct) {
            console.error(`session not found: ${flags.session}.jsonl`);
            console.error('Run with --list to see available sessions.');
            process.exit(1);
        }
        targets = [direct];
    } else {
        targets = [sessions[0].path];
        if (!flags.quiet) console.log(`Newest session selected: ${sessions[0].id}`);
    }

    let totalChanged = 0;
    let totalRewritten = 0;
    for (const t of targets) {
        const r = cleanFile(t, flags);
        if (r.changed) totalChanged += 1;
        totalRewritten += r.modifiedCount;
    }

    if (!flags.quiet) {
        console.log(`\nDone. files_modified=${totalChanged}/${targets.length}  blocks_rewritten=${totalRewritten}`);
        if (flags.dryRun) console.log('(dry-run — no files written)');
    }
}

try {
    main();
} catch (err) {
    console.error('deepcode-clean error:', err.message);
    process.exit(1);
}
