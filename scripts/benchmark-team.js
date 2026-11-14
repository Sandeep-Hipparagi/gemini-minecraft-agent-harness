import { spawn, spawnSync } from 'node:child_process';
import { existsSync, promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { summarizeTelemetry } from './summarize-telemetry.js';

const BIN = fileURLToPath(new URL('../bin/minecraft-agent.js', import.meta.url));

export function parseBenchmarkArgs(argv = process.argv.slice(2)) {
    const { values } = parseArgs({
        args: argv,
        options: {
            team: { type: 'string', default: 'examples/team.json' },
            duration: { type: 'string', default: '180' },
            clean: { type: 'boolean', default: false },
            out: { type: 'string' },
            help: { type: 'boolean', short: 'h' },
        },
    });
    const duration = Number(values.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error(`Invalid duration: ${values.duration}. Must be a positive number of seconds.`);
    }
    return {
        teamPath: values.team,
        durationSeconds: duration,
        clean: Boolean(values.clean),
        outPath: values.out,
        help: Boolean(values.help),
    };
}

export function resolveTeamConfig(filePath, cwd = process.cwd()) {
    const fullPath = path.resolve(cwd, filePath);
    let parsed = {};
    if (existsSync(fullPath)) {
        try {
            parsed = JSON.parse(readFileSync(fullPath, 'utf8'));
        } catch {
            parsed = {};
        }
    }
    const teamName = typeof parsed.team === 'string' && parsed.team ? parsed.team : 'team';
    const stateDir = path.resolve(cwd, parsed.stateDir ?? path.join('.agent-state', teamName));
    return { teamName, stateDir, parsed };
}

export async function cleanStateDir(stateDir) {
    if (existsSync(stateDir)) {
        await fs.rm(stateDir, { recursive: true, force: true });
    }
}

export function terminateProcessTree(pid) {
    if (!pid) return;
    if (process.platform === 'win32') {
        try {
            spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
            return;
        } catch {}
    }
    try {
        process.kill(pid, 'SIGTERM');
    } catch {}
}

export async function stopProcessTree(child, graceMs = 2000) {
    if (!child || child.killed || child.exitCode !== null) return;
    try {
        child.kill('SIGTERM');
    } catch {}
    const exited = await new Promise(resolve => {
        const timer = setTimeout(() => resolve(false), graceMs);
        child.once('exit', () => {
            clearTimeout(timer);
            resolve(true);
        });
    });
    if (!exited && child.exitCode === null) {
        terminateProcessTree(child.pid);
    }
}

export async function runBenchmark(options = {}) {
    const cwd = options.cwd ?? process.cwd();
    const teamPath = path.resolve(cwd, options.teamPath ?? 'examples/team.json');
    const durationSeconds = options.durationSeconds ?? 180;
    const clean = options.clean ?? false;
    const command = options.command ?? process.execPath;
    const args = options.args ?? [BIN, 'team', '--team', teamPath];
    const stdio = options.stdio ?? 'inherit';

    const { teamName, stateDir } = resolveTeamConfig(teamPath, cwd);

    if (clean) {
        await cleanStateDir(stateDir);
    }

    console.log(`Starting benchmark for team "${teamName}" (${durationSeconds}s)...`);
    const child = spawn(command, args, { cwd, stdio, env: options.env ?? process.env });

    let stopping = false;
    const doStop = async () => {
        if (stopping) return;
        stopping = true;
        await stopProcessTree(child, options.graceMs ?? 2000);
    };

    const timer = setTimeout(async () => {
        console.log(`\nBenchmark duration of ${durationSeconds}s elapsed. Stopping team...`);
        await doStop();
    }, durationSeconds * 1000);

    const onSignal = async () => {
        clearTimeout(timer);
        await doStop();
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);

    await new Promise(resolve => child.once('exit', resolve));
    clearTimeout(timer);
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);

    let summary = null;
    if (options.summarize !== false) {
        console.log(`\nBenchmark completed. Summarizing telemetry for: ${stateDir}`);
        summary = await summarizeTelemetry(stateDir, {
            outPath: options.outPath,
            durationSeconds,
            teamConfigPath: teamPath,
            teamName,
        });
    }

    return { child, teamName, stateDir, summary };
}

export async function main(argv = process.argv.slice(2)) {
    let args;
    try {
        args = parseBenchmarkArgs(argv);
    } catch (e) {
        console.error(`benchmark-team: ${e.message}`);
        return 1;
    }

    if (args.help) {
        console.log(
            'Usage: npm run benchmark -- [--team <path>] [--duration <seconds>] [--clean] [--out <filepath>]\n\n' +
                'Runs a timed multi-agent benchmark, terminates agents cleanly when duration expires,\n' +
                'and prints the cross-agent telemetry summary.',
        );
        return 0;
    }

    await runBenchmark(args);
    return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const code = await main();
    if (code) process.exit(code);
}
