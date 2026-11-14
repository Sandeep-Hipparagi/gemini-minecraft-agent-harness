import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    findAgentTelemetryFiles,
    parseTelemetry,
    parseTelemetryArgs,
    summarizeTeamTelemetry,
    summarizeTelemetry,
} from '../scripts/summarize-telemetry.js';

test('parseTelemetry aggregates tool stats and failure counts from readable stream', async () => {
    const lines = [
        JSON.stringify({ time: '2026-11-14T10:00:00Z', agent: 'GeminiBot', event: 'cycle', index: 1 }),
        '',
        'invalid json line',
        JSON.stringify({
            time: '2026-11-14T10:00:01Z',
            agent: 'GeminiBot',
            event: 'tool',
            tool: 'go_to',
            timeMs: 200,
            success: true,
        }),
        JSON.stringify({
            time: '2026-11-14T10:00:02Z',
            agent: 'GeminiBot',
            event: 'tool',
            tool: 'go_to',
            timeMs: 400,
            success: false,
            failureCode: 'no_path',
        }),
        JSON.stringify({
            time: '2026-11-14T10:00:03Z',
            agent: 'GeminiBot',
            event: 'tool',
            tool: 'find_and_collect_nearest',
            timeMs: 1500,
            success: true,
        }),
        JSON.stringify({
            time: '2026-11-14T10:00:04Z',
            agent: 'GeminiBot',
            event: 'tool',
            tool: 'find_and_collect_nearest',
            timeMs: 500,
            success: false,
            failureCode: 'out_of_reach',
        }),
    ].join('\n');

    const stream = Readable.from([lines]);
    const { toolSummary, failureSummary, tools, failureCodes, totalEvents } = await parseTelemetry(stream);

    assert.equal(toolSummary.length, 2);
    const collectStat = toolSummary.find(t => t.Tool === 'find_and_collect_nearest');
    assert.deepEqual(collectStat, {
        Tool: 'find_and_collect_nearest',
        Calls: 2,
        Success: 1,
        Failed: 1,
        'Success %': '50.0%',
        'Avg Latency (ms)': 1000,
    });

    const gotoStat = toolSummary.find(t => t.Tool === 'go_to');
    assert.deepEqual(gotoStat, {
        Tool: 'go_to',
        Calls: 2,
        Success: 1,
        Failed: 1,
        'Success %': '50.0%',
        'Avg Latency (ms)': 300,
    });

    assert.equal(failureSummary.length, 2);
    const codes = Object.fromEntries(failureSummary.map(f => [f['Failure Code'], f.Count]));
    assert.equal(codes.no_path, 1);
    assert.equal(codes.out_of_reach, 1);

    assert.equal(totalEvents, 4);
    assert.equal(tools.length, 2);
    assert.deepEqual(failureCodes, { no_path: 1, out_of_reach: 1 });
});

test('parseTelemetryArgs parses target, out path, and help', () => {
    const withAll = parseTelemetryArgs(['gemini-crew', '--out', 'reports/crew.json']);
    assert.deepEqual(withAll, {
        target: 'gemini-crew',
        outPath: 'reports/crew.json',
        help: false,
    });

    const outOnly = parseTelemetryArgs(['--out', 'output.json']);
    assert.deepEqual(outOnly, {
        target: undefined,
        outPath: 'output.json',
        help: false,
    });

    const help = parseTelemetryArgs(['-h']);
    assert.equal(help.help, true);
});

test('summarizeTelemetry handles non-existent and empty files gracefully', async () => {
    const missing = await summarizeTelemetry(path.join(os.tmpdir(), 'non-existent-telemetry.jsonl'));
    assert.equal(missing, null);

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'telemetry-test-'));
    const emptyFile = path.join(tmpDir, 'empty.jsonl');
    await fs.writeFile(emptyFile, '');

    const emptyResult = await summarizeTelemetry(emptyFile);
    assert.deepEqual(emptyResult.toolSummary, []);
    assert.deepEqual(emptyResult.failureSummary, []);
    assert.ok(emptyResult.report);
    assert.equal(emptyResult.report.totalEvents, 0);

    await fs.rm(tmpDir, { recursive: true, force: true });
});

test('findAgentTelemetryFiles discovers agent subdirectories and ignores shared', async () => {
    const teamDir = await fs.mkdtemp(path.join(os.tmpdir(), 'team-scan-'));
    const archDir = path.join(teamDir, 'ArchitectPro');
    const gatherDir = path.join(teamDir, 'GathererFlash');
    const sharedDir = path.join(teamDir, 'shared');

    await fs.mkdir(archDir, { recursive: true });
    await fs.mkdir(gatherDir, { recursive: true });
    await fs.mkdir(sharedDir, { recursive: true });

    await fs.writeFile(path.join(archDir, 'telemetry.jsonl'), '');
    await fs.writeFile(path.join(gatherDir, 'telemetry.jsonl'), '');
    await fs.writeFile(path.join(sharedDir, 'telemetry.jsonl'), '');

    const found = await findAgentTelemetryFiles(teamDir);
    assert.equal(found.length, 2);
    assert.deepEqual(
        found.map(f => f.agent),
        ['ArchitectPro', 'GathererFlash'],
    );

    await fs.rm(teamDir, { recursive: true, force: true });
});

test('summarizeTeamTelemetry computes team overview and per-tool comparison table', async () => {
    const teamDir = await fs.mkdtemp(path.join(os.tmpdir(), 'team-summary-'));
    const archDir = path.join(teamDir, 'ArchitectPro');
    const gatherDir = path.join(teamDir, 'GathererFlash');

    await fs.mkdir(archDir, { recursive: true });
    await fs.mkdir(gatherDir, { recursive: true });

    const archLines = [
        JSON.stringify({
            time: '2026-11-14T10:00:00Z',
            agent: 'ArchitectPro',
            event: 'tool',
            tool: 'observe_world',
            timeMs: 50,
            success: true,
        }),
        JSON.stringify({
            time: '2026-11-14T10:00:01Z',
            agent: 'ArchitectPro',
            event: 'tool',
            tool: 'send_dm',
            timeMs: 100,
            success: true,
        }),
    ].join('\n');

    const gatherLines = [
        JSON.stringify({
            time: '2026-11-14T10:00:00Z',
            agent: 'GathererFlash',
            event: 'tool',
            tool: 'find_and_collect_nearest',
            timeMs: 800,
            success: true,
        }),
        JSON.stringify({
            time: '2026-11-14T10:00:01Z',
            agent: 'GathererFlash',
            event: 'tool',
            tool: 'find_and_collect_nearest',
            timeMs: 400,
            success: false,
            failureCode: 'not_found',
        }),
        JSON.stringify({
            time: '2026-11-14T10:00:02Z',
            agent: 'GathererFlash',
            event: 'tool',
            tool: 'send_dm',
            timeMs: 150,
            success: true,
        }),
    ].join('\n');

    await fs.writeFile(path.join(archDir, 'telemetry.jsonl'), archLines);
    await fs.writeFile(path.join(gatherDir, 'telemetry.jsonl'), gatherLines);

    const result = await summarizeTeamTelemetry(teamDir);
    assert.ok(result);

    const { teamOverview, crossToolBreakdown, agentSummaries } = result;

    assert.equal(teamOverview.length, 2);
    const archOverview = teamOverview.find(o => o.Agent === 'ArchitectPro');
    assert.deepEqual(archOverview, {
        Agent: 'ArchitectPro',
        'Total Calls': 2,
        Succeeded: 2,
        Failed: 0,
        'Success %': '100.0%',
        'Avg Latency (ms)': 75,
        'Top Failure Code': '-',
    });

    const gatherOverview = teamOverview.find(o => o.Agent === 'GathererFlash');
    assert.deepEqual(gatherOverview, {
        Agent: 'GathererFlash',
        'Total Calls': 3,
        Succeeded: 2,
        Failed: 1,
        'Success %': '66.7%',
        'Avg Latency (ms)': 450,
        'Top Failure Code': 'not_found',
    });

    assert.equal(crossToolBreakdown.length, 3);
    const dmTool = crossToolBreakdown.find(t => t.Tool === 'send_dm');
    assert.equal(dmTool['Total Calls'], 2);
    assert.equal(dmTool.Success, 2);
    assert.equal(dmTool.Failed, 0);
    assert.equal(dmTool.ArchitectPro, '1/1');
    assert.equal(dmTool.GathererFlash, '1/1');

    const collectTool = crossToolBreakdown.find(t => t.Tool === 'find_and_collect_nearest');
    assert.equal(collectTool['Total Calls'], 2);
    assert.equal(collectTool.Success, 1);
    assert.equal(collectTool.Failed, 1);
    assert.equal(collectTool.ArchitectPro, '-');
    assert.equal(collectTool.GathererFlash, '1/2');

    assert.ok(agentSummaries.ArchitectPro);
    assert.ok(agentSummaries.GathererFlash);

    const directSummary = await summarizeTelemetry(teamDir);
    assert.deepEqual(directSummary.teamOverview, result.teamOverview);
    assert.deepEqual(directSummary.crossToolBreakdown, result.crossToolBreakdown);
    assert.deepEqual(directSummary.agentSummaries, result.agentSummaries);

    await fs.rm(teamDir, { recursive: true, force: true });
});

test('summarizeTelemetry exports structured JSON report for single-agent runs', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'single-out-'));
    try {
        const filePath = path.join(tmpDir, 'telemetry.jsonl');
        const lines = [
            JSON.stringify({
                time: '2026-11-14T10:00:00Z',
                agent: 'MinerBot',
                event: 'tool',
                tool: 'dig',
                timeMs: 250,
                success: true,
            }),
            JSON.stringify({
                time: '2026-11-14T10:00:01Z',
                agent: 'MinerBot',
                event: 'tool',
                tool: 'dig',
                timeMs: 350,
                success: false,
                failureCode: 'out_of_reach',
            }),
        ].join('\n');
        await fs.writeFile(filePath, lines);

        const outPath = path.join(tmpDir, 'nested', 'export', 'summary.json');
        const res = await summarizeTelemetry(filePath, { outPath });
        assert.ok(res);

        const raw = await fs.readFile(outPath, 'utf8');
        const json = JSON.parse(raw);

        assert.equal(json.mode, 'single');
        assert.equal(json.agent, 'MinerBot');
        assert.equal(json.target, filePath);
        assert.equal(json.totalEvents, 2);
        assert.ok(Array.isArray(json.tools));
        assert.equal(json.tools.length, 1);
        assert.deepEqual(json.tools[0], {
            tool: 'dig',
            calls: 2,
            succeeded: 1,
            failed: 1,
            successRate: 0.5,
            avgLatencyMs: 300,
        });
        assert.deepEqual(json.failureCodes, { out_of_reach: 1 });
        assert.ok(!isNaN(Date.parse(json.generatedAt)));
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
    }
});

test('summarizeTeamTelemetry exports structured JSON report for team runs', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'team-out-'));
    try {
        const teamDir = path.join(tmpDir, 'alpha-crew');
        const agentDir = path.join(teamDir, 'Scout');
        await fs.mkdir(agentDir, { recursive: true });

        const lines = [
            JSON.stringify({
                time: '2026-11-14T10:00:00Z',
                agent: 'Scout',
                event: 'tool',
                tool: 'observe_world',
                timeMs: 60,
                success: true,
            }),
        ].join('\n');
        await fs.writeFile(path.join(agentDir, 'telemetry.jsonl'), lines);

        const outPath = path.join(tmpDir, 'reports', 'alpha-summary.json');
        const res = await summarizeTeamTelemetry(teamDir, { outPath });
        assert.ok(res);

        const raw = await fs.readFile(outPath, 'utf8');
        const json = JSON.parse(raw);

        assert.equal(json.mode, 'team');
        assert.equal(json.team, 'alpha-crew');
        assert.equal(json.target, teamDir);
        assert.ok(Array.isArray(json.agents));
        assert.equal(json.agents.length, 1);
        assert.equal(json.agents[0].agent, 'Scout');
        assert.equal(json.agents[0].totalEvents, 1);
        assert.ok(Array.isArray(json.crossToolBreakdown));
        assert.equal(json.crossToolBreakdown.length, 1);
        assert.equal(json.crossToolBreakdown[0].tool, 'observe_world');
        assert.equal(json.crossToolBreakdown[0].totalCalls, 1);
        assert.ok(!isNaN(Date.parse(json.generatedAt)));
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
    }
});
