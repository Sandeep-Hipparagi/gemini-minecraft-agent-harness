import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    compareBenchmarks,
    formatDeltaNumber,
    main,
    normalizeReport,
    parseCompareArgs,
    readReport,
} from '../scripts/compare-benchmarks.js';

test('parseCompareArgs parses positionals, out flag, and help flag', () => {
    const empty = parseCompareArgs([]);
    assert.deepEqual(empty, {
        baselinePath: undefined,
        candidatePath: undefined,
        outPath: undefined,
        help: false,
    });

    const parsed = parseCompareArgs(['base.json', 'cand.json', '--out', 'diff.json']);
    assert.deepEqual(parsed, {
        baselinePath: 'base.json',
        candidatePath: 'cand.json',
        outPath: 'diff.json',
        help: false,
    });

    const help = parseCompareArgs(['-h']);
    assert.equal(help.help, true);
});

test('formatDeltaNumber formats positive, negative, and zero values with optional suffix', () => {
    assert.equal(formatDeltaNumber(5), '+5');
    assert.equal(formatDeltaNumber(-3), '-3');
    assert.equal(formatDeltaNumber(0), '0');

    assert.equal(formatDeltaNumber(12.5, '%', 1), '+12.5%');
    assert.equal(formatDeltaNumber(-8.2, '%', 1), '-8.2%');
    assert.equal(formatDeltaNumber(0, '%', 1), '0.0%');

    assert.equal(formatDeltaNumber(-85, ' ms'), '-85 ms');
    assert.equal(formatDeltaNumber(40, ' ms'), '+40 ms');
    assert.equal(formatDeltaNumber(0, ' ms'), '0 ms');
});

test('readReport throws when report file does not exist', () => {
    assert.throws(() => readReport(path.join(os.tmpdir(), 'non-existent-report-12345.json')), /Report file not found/);
});

test('normalizeReport handles both single and team mode structures', () => {
    const single = normalizeReport({
        mode: 'single',
        agent: 'SoloBot',
        tools: [
            {
                tool: 'dig',
                calls: 2,
                succeeded: 2,
                failed: 0,
                successRate: 1.0,
                avgLatencyMs: 150,
            },
        ],
        failureCodes: {},
    });
    assert.equal(single.mode, 'single');
    assert.equal(single.overall.calls, 2);
    assert.equal(single.overall.succeeded, 2);
    assert.equal(single.overall.failed, 0);
    assert.equal(single.overall.avgLatencyMs, 150);
    assert.equal(single.tools.get('dig').calls, 2);

    const team = normalizeReport({
        mode: 'team',
        team: 'duo',
        agents: [
            {
                agent: 'Alpha',
                tools: [
                    {
                        tool: 'dig',
                        calls: 1,
                        succeeded: 1,
                        failed: 0,
                        successRate: 1.0,
                        avgLatencyMs: 100,
                    },
                ],
                failureCodes: { fail_a: 1 },
            },
            {
                agent: 'Beta',
                tools: [
                    {
                        tool: 'dig',
                        calls: 2,
                        succeeded: 1,
                        failed: 1,
                        successRate: 0.5,
                        avgLatencyMs: 200,
                    },
                ],
                failureCodes: { fail_b: 1 },
            },
        ],
    });
    assert.equal(team.mode, 'team');
    assert.equal(team.overall.calls, 3);
    assert.equal(team.overall.succeeded, 2);
    assert.equal(team.overall.failed, 1);
    assert.equal(team.overall.avgLatencyMs, 167);
    assert.equal(team.tools.get('dig').calls, 3);
    assert.equal(team.failureCodes.fail_a, 1);
    assert.equal(team.failureCodes.fail_b, 1);
    assert.equal(team.agents.get('Alpha').calls, 1);
    assert.equal(team.agents.get('Beta').calls, 2);
});

test('compareBenchmarks handles single-agent reports and computes deltas', async () => {
    const baseline = {
        mode: 'single',
        agent: 'MinerBot',
        target: 'base.jsonl',
        totalEvents: 2,
        tools: [
            {
                tool: 'dig',
                calls: 2,
                succeeded: 1,
                failed: 1,
                successRate: 0.5,
                avgLatencyMs: 300,
            },
        ],
        failureCodes: { out_of_reach: 1 },
    };

    const candidate = {
        mode: 'single',
        agent: 'MinerBot',
        target: 'cand.jsonl',
        totalEvents: 4,
        tools: [
            {
                tool: 'dig',
                calls: 3,
                succeeded: 3,
                failed: 0,
                successRate: 1.0,
                avgLatencyMs: 200,
            },
            {
                tool: 'observe_world',
                calls: 1,
                succeeded: 1,
                failed: 0,
                successRate: 1.0,
                avgLatencyMs: 50,
            },
        ],
        failureCodes: {},
    };

    const result = await compareBenchmarks(baseline, candidate);
    assert.ok(result);

    const { overallTable, toolTable, failureTable, agentTable, diff } = result;

    assert.equal(agentTable, null);

    const callsRow = overallTable.find(r => r.Metric === 'Total Calls');
    assert.deepEqual(callsRow, {
        Metric: 'Total Calls',
        Baseline: 2,
        Candidate: 4,
        Delta: '+2',
    });

    const successRow = overallTable.find(r => r.Metric === 'Success %');
    assert.equal(successRow.Baseline, '50.0%');
    assert.equal(successRow.Candidate, '100.0%');
    assert.equal(successRow.Delta, '+50.0%');

    const latencyRow = overallTable.find(r => r.Metric === 'Avg Latency');
    assert.equal(latencyRow.Baseline, '300 ms');
    assert.equal(latencyRow.Candidate, '163 ms');
    assert.equal(latencyRow.Delta, '-137 ms');

    assert.equal(toolTable.length, 2);
    const digRow = toolTable.find(r => r.Tool === 'dig');
    assert.deepEqual(digRow, {
        Tool: 'dig',
        'Base Calls': 2,
        'Cand Calls': 3,
        'Base Success %': '50.0%',
        'Cand Success %': '100.0%',
        'Success Delta': '+50.0%',
        'Base Latency (ms)': 300,
        'Cand Latency (ms)': 200,
        'Latency Delta (ms)': '-100',
    });

    const observeRow = toolTable.find(r => r.Tool === 'observe_world');
    assert.deepEqual(observeRow, {
        Tool: 'observe_world',
        'Base Calls': 0,
        'Cand Calls': 1,
        'Base Success %': '-',
        'Cand Success %': '100.0%',
        'Success Delta': '-',
        'Base Latency (ms)': '-',
        'Cand Latency (ms)': 50,
        'Latency Delta (ms)': '-',
    });

    assert.equal(failureTable.length, 1);
    assert.deepEqual(failureTable[0], {
        'Failure Code': 'out_of_reach',
        Baseline: 1,
        Candidate: 0,
        Delta: '-1',
    });

    assert.equal(diff.overall.delta.calls, 2);
    assert.equal(diff.overall.delta.succeeded, 3);
    assert.equal(diff.overall.delta.failed, -1);
    assert.equal(diff.toolDeltas.length, 2);
    assert.equal(diff.failureCodeDeltas.length, 1);
});

test('compareBenchmarks handles team reports and computes per-agent deltas', async () => {
    const baselineTeam = {
        mode: 'team',
        team: 'crew-alpha',
        target: 'base-dir',
        agents: [
            {
                agent: 'ArchitectPro',
                totalEvents: 2,
                tools: [
                    {
                        tool: 'observe_world',
                        calls: 2,
                        succeeded: 2,
                        failed: 0,
                        successRate: 1.0,
                        avgLatencyMs: 60,
                    },
                ],
                failureCodes: {},
            },
            {
                agent: 'GathererFlash',
                totalEvents: 4,
                tools: [
                    {
                        tool: 'find_and_collect_nearest',
                        calls: 4,
                        succeeded: 2,
                        failed: 2,
                        successRate: 0.5,
                        avgLatencyMs: 400,
                    },
                ],
                failureCodes: { not_found: 2 },
            },
        ],
    };

    const candidateTeam = {
        mode: 'team',
        team: 'crew-alpha',
        target: 'cand-dir',
        agents: [
            {
                agent: 'ArchitectPro',
                totalEvents: 3,
                tools: [
                    {
                        tool: 'observe_world',
                        calls: 3,
                        succeeded: 3,
                        failed: 0,
                        successRate: 1.0,
                        avgLatencyMs: 50,
                    },
                ],
                failureCodes: {},
            },
            {
                agent: 'GathererFlash',
                totalEvents: 5,
                tools: [
                    {
                        tool: 'find_and_collect_nearest',
                        calls: 5,
                        succeeded: 4,
                        failed: 1,
                        successRate: 0.8,
                        avgLatencyMs: 320,
                    },
                ],
                failureCodes: { not_found: 1 },
            },
        ],
    };

    const result = await compareBenchmarks(baselineTeam, candidateTeam);
    assert.ok(result);

    const { agentTable, diff } = result;
    assert.ok(Array.isArray(agentTable));
    assert.equal(agentTable.length, 2);

    const archAgent = agentTable.find(a => a.Agent === 'ArchitectPro');
    assert.deepEqual(archAgent, {
        Agent: 'ArchitectPro',
        'Base Calls': 2,
        'Cand Calls': 3,
        'Base Success %': '100.0%',
        'Cand Success %': '100.0%',
        'Success Delta': '0.0%',
        'Base Latency (ms)': 60,
        'Cand Latency (ms)': 50,
        'Latency Delta (ms)': '-10',
    });

    const gatherAgent = agentTable.find(a => a.Agent === 'GathererFlash');
    assert.deepEqual(gatherAgent, {
        Agent: 'GathererFlash',
        'Base Calls': 4,
        'Cand Calls': 5,
        'Base Success %': '50.0%',
        'Cand Success %': '80.0%',
        'Success Delta': '+30.0%',
        'Base Latency (ms)': 400,
        'Cand Latency (ms)': 320,
        'Latency Delta (ms)': '-80',
    });

    assert.ok(Array.isArray(diff.agentDeltas));
    assert.equal(diff.agentDeltas.length, 2);
});

test('compareBenchmarks writes diff JSON file when outPath is specified', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'compare-out-'));
    try {
        const baseFile = path.join(tmpDir, 'baseline.json');
        const candFile = path.join(tmpDir, 'candidate.json');
        const outDiff = path.join(tmpDir, 'nested', 'diff.json');

        const baseData = {
            mode: 'single',
            agent: 'BotA',
            tools: [
                {
                    tool: 'jump',
                    calls: 1,
                    succeeded: 1,
                    failed: 0,
                    successRate: 1.0,
                    avgLatencyMs: 20,
                },
            ],
            failureCodes: {},
        };

        const candData = {
            mode: 'single',
            agent: 'BotA',
            tools: [
                {
                    tool: 'jump',
                    calls: 2,
                    succeeded: 2,
                    failed: 0,
                    successRate: 1.0,
                    avgLatencyMs: 25,
                },
            ],
            failureCodes: {},
        };

        await fs.writeFile(baseFile, JSON.stringify(baseData));
        await fs.writeFile(candFile, JSON.stringify(candData));

        const result = await compareBenchmarks(baseFile, candFile, { outPath: outDiff });
        assert.ok(result);

        const raw = await fs.readFile(outDiff, 'utf8');
        const json = JSON.parse(raw);

        assert.equal(json.baselineMode, 'single');
        assert.equal(json.candidateMode, 'single');
        assert.equal(json.overall.delta.calls, 1);
        assert.equal(json.overall.delta.succeeded, 1);
        assert.equal(json.overall.delta.failed, 0);
        assert.equal(json.toolDeltas.length, 1);
        assert.equal(json.toolDeltas[0].tool, 'jump');
        assert.equal(json.toolDeltas[0].avgLatencyDeltaMs, 5);
        assert.ok(!isNaN(Date.parse(json.generatedAt)));
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
    }
});

test('main handles help flag and error conditions', async () => {
    const helpCode = await main(['-h']);
    assert.equal(helpCode, 0);

    const missingArgsCode = await main([]);
    assert.equal(missingArgsCode, 1);

    const missingFileCode = await main(['nonexistent-a.json', 'nonexistent-b.json']);
    assert.equal(missingFileCode, 1);
});
