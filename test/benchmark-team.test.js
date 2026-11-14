import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanStateDir, parseBenchmarkArgs, resolveTeamConfig, runBenchmark } from '../scripts/benchmark-team.js';

test('parseBenchmarkArgs parses defaults and custom CLI flags', () => {
    const defaults = parseBenchmarkArgs([]);
    assert.deepEqual(defaults, {
        teamPath: 'examples/team.json',
        durationSeconds: 180,
        clean: false,
        outPath: undefined,
        help: false,
    });

    const custom = parseBenchmarkArgs([
        '--team',
        'custom.json',
        '--duration',
        '45',
        '--clean',
        '--out',
        'custom-report.json',
    ]);
    assert.deepEqual(custom, {
        teamPath: 'custom.json',
        durationSeconds: 45,
        clean: true,
        outPath: 'custom-report.json',
        help: false,
    });

    const help = parseBenchmarkArgs(['-h']);
    assert.equal(help.help, true);

    assert.throws(() => parseBenchmarkArgs(['--duration', '0']), /Invalid duration/);
    assert.throws(() => parseBenchmarkArgs(['--duration=-10']), /Invalid duration/);
    assert.throws(() => parseBenchmarkArgs(['--duration', 'not-a-number']), /Invalid duration/);
});

test('resolveTeamConfig reads team name and resolves state directory', async () => {
    const resolved = resolveTeamConfig('examples/team.json');
    assert.equal(resolved.teamName, 'gemini-crew');
    assert.ok(resolved.stateDir.endsWith(path.join('.agent-state', 'gemini-crew')));

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'team-cfg-'));
    try {
        const customFile = path.join(tmpDir, 'custom.json');
        await fs.writeFile(
            customFile,
            JSON.stringify({
                team: 'special-force',
                stateDir: 'custom-state-dir',
            }),
        );

        const custom = resolveTeamConfig(customFile, tmpDir);
        assert.equal(custom.teamName, 'special-force');
        assert.equal(custom.stateDir, path.join(tmpDir, 'custom-state-dir'));

        const fallback = resolveTeamConfig(path.join(tmpDir, 'missing.json'), tmpDir);
        assert.equal(fallback.teamName, 'team');
        assert.equal(fallback.stateDir, path.join(tmpDir, '.agent-state', 'team'));
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
    }
});

test('cleanStateDir removes state directory when present', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clean-test-'));
    const dummyFile = path.join(tmpDir, 'dummy.txt');
    await fs.writeFile(dummyFile, 'hello');

    await cleanStateDir(tmpDir);

    const exists = await fs
        .access(tmpDir)
        .then(() => true)
        .catch(() => false);
    assert.equal(exists, false);

    await cleanStateDir(path.join(os.tmpdir(), 'non-existent-dir-12345'));
});

test('runBenchmark terminates timed child process cleanly', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bench-proc-'));
    try {
        const workerScript = path.join(tmpDir, 'worker.js');
        await fs.writeFile(workerScript, 'setInterval(() => {}, 1000);\n');

        const teamConfig = path.join(tmpDir, 'team.json');
        await fs.writeFile(teamConfig, JSON.stringify({ team: 'mock-team' }));

        const { child, teamName } = await runBenchmark({
            cwd: tmpDir,
            teamPath: teamConfig,
            durationSeconds: 0.3,
            graceMs: 150,
            command: process.execPath,
            args: [workerScript],
            clean: false,
            summarize: false,
            stdio: 'pipe',
        });

        assert.equal(teamName, 'mock-team');
        assert.ok(child.killed || child.exitCode !== null || child.signalCode !== null);
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
    }
});

test('runBenchmark invokes telemetry summary upon completion', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bench-summary-'));
    try {
        const workerScript = path.join(tmpDir, 'worker.js');
        await fs.writeFile(workerScript, 'process.exit(0);\n');

        const stateDir = path.join(tmpDir, 'state');
        const agentDir = path.join(stateDir, 'Agent1');
        await fs.mkdir(agentDir, { recursive: true });

        const telemetryLine = JSON.stringify({
            time: '2026-11-14T10:00:00Z',
            agent: 'Agent1',
            event: 'tool',
            tool: 'observe_world',
            timeMs: 40,
            success: true,
        });
        await fs.writeFile(path.join(agentDir, 'telemetry.jsonl'), telemetryLine + '\n');

        const teamConfig = path.join(tmpDir, 'team.json');
        await fs.writeFile(teamConfig, JSON.stringify({ team: 'telemetry-team', stateDir }));

        const { summary } = await runBenchmark({
            cwd: tmpDir,
            teamPath: teamConfig,
            durationSeconds: 1,
            command: process.execPath,
            args: [workerScript],
            clean: false,
            summarize: true,
            stdio: 'pipe',
        });

        assert.ok(summary);
        assert.equal(summary.teamOverview.length, 1);
        assert.equal(summary.teamOverview[0].Agent, 'Agent1');
        assert.equal(summary.teamOverview[0]['Total Calls'], 1);
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
    }
});

test('runBenchmark writes telemetry JSON report when outPath is specified', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bench-out-'));
    try {
        const workerScript = path.join(tmpDir, 'worker.js');
        await fs.writeFile(workerScript, 'process.exit(0);\n');

        const stateDir = path.join(tmpDir, 'state');
        const agentDir = path.join(stateDir, 'Agent1');
        await fs.mkdir(agentDir, { recursive: true });

        const telemetryLine = JSON.stringify({
            time: '2026-11-14T10:00:00Z',
            agent: 'Agent1',
            event: 'tool',
            tool: 'observe_world',
            timeMs: 40,
            success: true,
        });
        await fs.writeFile(path.join(agentDir, 'telemetry.jsonl'), telemetryLine + '\n');

        const teamConfig = path.join(tmpDir, 'team.json');
        await fs.writeFile(teamConfig, JSON.stringify({ team: 'telemetry-team', stateDir }));

        const outReportPath = path.join(tmpDir, 'nested', 'custom-report.json');

        const { summary } = await runBenchmark({
            cwd: tmpDir,
            teamPath: teamConfig,
            durationSeconds: 1,
            command: process.execPath,
            args: [workerScript],
            clean: false,
            summarize: true,
            outPath: outReportPath,
            stdio: 'pipe',
        });

        assert.ok(summary);
        assert.ok(summary.report);

        const raw = await fs.readFile(outReportPath, 'utf8');
        const report = JSON.parse(raw);

        assert.equal(report.mode, 'team');
        assert.equal(report.team, 'telemetry-team');
        assert.equal(report.durationSeconds, 1);
        assert.equal(report.teamConfigPath, teamConfig);
        assert.equal(report.agents.length, 1);
        assert.equal(report.agents[0].agent, 'Agent1');
        assert.equal(report.agents[0].tools.length, 1);
        assert.equal(report.agents[0].tools[0].tool, 'observe_world');
        assert.equal(report.crossToolBreakdown.length, 1);
        assert.equal(report.crossToolBreakdown[0].tool, 'observe_world');
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
    }
});
