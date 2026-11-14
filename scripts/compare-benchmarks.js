import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export function parseCompareArgs(argv = process.argv.slice(2)) {
    const { values, positionals } = parseArgs({
        args: argv,
        options: {
            out: { type: 'string' },
            help: { type: 'boolean', short: 'h' },
        },
        allowPositionals: true,
    });
    return {
        baselinePath: positionals[0],
        candidatePath: positionals[1],
        outPath: values.out,
        help: Boolean(values.help),
    };
}

export function readReport(input) {
    if (typeof input === 'object' && input !== null) {
        return input;
    }
    const resolvedPath = path.resolve(input);
    if (!existsSync(resolvedPath)) {
        throw new Error(`Report file not found: ${resolvedPath}`);
    }
    const raw = readFileSync(resolvedPath, 'utf8');
    return JSON.parse(raw);
}

export function formatDeltaNumber(diff, suffix = '', decimals = 0) {
    const formatted = decimals > 0 ? diff.toFixed(decimals) : String(diff);
    if (diff > 0) return `+${formatted}${suffix}`;
    if (diff < 0) return `${formatted}${suffix}`;
    return decimals > 0 ? `0.${'0'.repeat(decimals)}${suffix}` : `0${suffix}`;
}

export function normalizeReport(report) {
    const mode = report.mode || 'single';

    if (mode === 'team' && Array.isArray(report.agents)) {
        const agentMap = new Map();
        const toolMap = new Map();
        const failureCounts = {};

        for (const agentEntry of report.agents) {
            const agentName = agentEntry.agent;
            const tools = agentEntry.tools || [];
            const agentFailures = agentEntry.failureCodes || {};

            let agentCalls = 0;
            let agentSucceeded = 0;
            let agentFailed = 0;
            let agentTotalLatency = 0;

            for (const t of tools) {
                agentCalls += t.calls;
                agentSucceeded += t.succeeded;
                agentFailed += t.failed;
                agentTotalLatency += t.avgLatencyMs * t.calls;

                const existingTool = toolMap.get(t.tool) ?? {
                    calls: 0,
                    succeeded: 0,
                    failed: 0,
                    totalLatency: 0,
                };
                existingTool.calls += t.calls;
                existingTool.succeeded += t.succeeded;
                existingTool.failed += t.failed;
                existingTool.totalLatency += t.avgLatencyMs * t.calls;
                toolMap.set(t.tool, existingTool);
            }

            for (const [code, count] of Object.entries(agentFailures)) {
                failureCounts[code] = (failureCounts[code] || 0) + count;
            }

            agentMap.set(agentName, {
                agent: agentName,
                calls: agentCalls,
                succeeded: agentSucceeded,
                failed: agentFailed,
                successRate: agentCalls > 0 ? agentSucceeded / agentCalls : 0,
                avgLatencyMs: agentCalls > 0 ? Math.round(agentTotalLatency / agentCalls) : 0,
                failureCodes: agentFailures,
                tools,
            });
        }

        const normalizedTools = new Map();
        let totalCalls = 0;
        let totalSucceeded = 0;
        let totalFailed = 0;
        let totalLatency = 0;

        for (const [toolName, stat] of toolMap.entries()) {
            totalCalls += stat.calls;
            totalSucceeded += stat.succeeded;
            totalFailed += stat.failed;
            totalLatency += stat.totalLatency;

            normalizedTools.set(toolName, {
                tool: toolName,
                calls: stat.calls,
                succeeded: stat.succeeded,
                failed: stat.failed,
                successRate: stat.calls > 0 ? stat.succeeded / stat.calls : 0,
                avgLatencyMs: stat.calls > 0 ? Math.round(stat.totalLatency / stat.calls) : 0,
            });
        }

        return {
            mode: 'team',
            target: report.target,
            team: report.team,
            overall: {
                calls: totalCalls,
                succeeded: totalSucceeded,
                failed: totalFailed,
                successRate: totalCalls > 0 ? totalSucceeded / totalCalls : 0,
                avgLatencyMs: totalCalls > 0 ? Math.round(totalLatency / totalCalls) : 0,
                failureCodes: failureCounts,
            },
            tools: normalizedTools,
            failureCodes: failureCounts,
            agents: agentMap,
        };
    }

    const tools = report.tools || [];
    const failureCodes = report.failureCodes || {};
    const agentName = report.agent || 'GeminiBot';

    const normalizedTools = new Map();
    let totalCalls = 0;
    let totalSucceeded = 0;
    let totalFailed = 0;
    let totalLatency = 0;

    for (const t of tools) {
        totalCalls += t.calls;
        totalSucceeded += t.succeeded;
        totalFailed += t.failed;
        totalLatency += t.avgLatencyMs * t.calls;

        normalizedTools.set(t.tool, {
            tool: t.tool,
            calls: t.calls,
            succeeded: t.succeeded,
            failed: t.failed,
            successRate: t.calls > 0 ? t.succeeded / t.calls : 0,
            avgLatencyMs: t.avgLatencyMs,
        });
    }

    const agentMap = new Map();
    agentMap.set(agentName, {
        agent: agentName,
        calls: totalCalls,
        succeeded: totalSucceeded,
        failed: totalFailed,
        successRate: totalCalls > 0 ? totalSucceeded / totalCalls : 0,
        avgLatencyMs: totalCalls > 0 ? Math.round(totalLatency / totalCalls) : 0,
        failureCodes,
        tools,
    });

    return {
        mode: 'single',
        target: report.target,
        agent: agentName,
        overall: {
            calls: totalCalls,
            succeeded: totalSucceeded,
            failed: totalFailed,
            successRate: totalCalls > 0 ? totalSucceeded / totalCalls : 0,
            avgLatencyMs: totalCalls > 0 ? Math.round(totalLatency / totalCalls) : 0,
            failureCodes,
        },
        tools: normalizedTools,
        failureCodes,
        agents: agentMap,
    };
}

export function writeDiffFile(diff, outPath) {
    if (!outPath) return;
    const resolvedPath = path.resolve(outPath);
    mkdirSync(path.dirname(resolvedPath), { recursive: true });
    writeFileSync(resolvedPath, JSON.stringify(diff, null, 4) + '\n', 'utf8');
    console.log(`\nDiff report written to: ${resolvedPath}`);
}

export async function compareBenchmarks(baselineInput, candidateInput, options = {}) {
    const baselineRaw = readReport(baselineInput);
    const candidateRaw = readReport(candidateInput);

    const base = normalizeReport(baselineRaw);
    const cand = normalizeReport(candidateRaw);

    const baseCalls = base.overall.calls;
    const candCalls = cand.overall.calls;

    const baseSuccessPct = baseCalls > 0 ? `${(base.overall.successRate * 100).toFixed(1)}%` : '-';
    const candSuccessPct = candCalls > 0 ? `${(cand.overall.successRate * 100).toFixed(1)}%` : '-';
    const successDeltaStr =
        baseCalls > 0 && candCalls > 0
            ? formatDeltaNumber((cand.overall.successRate - base.overall.successRate) * 100, '%', 1)
            : '-';

    const baseLatencyStr = baseCalls > 0 ? `${base.overall.avgLatencyMs} ms` : '-';
    const candLatencyStr = candCalls > 0 ? `${cand.overall.avgLatencyMs} ms` : '-';
    const latencyDeltaStr =
        baseCalls > 0 && candCalls > 0
            ? formatDeltaNumber(cand.overall.avgLatencyMs - base.overall.avgLatencyMs, ' ms')
            : '-';

    const overallTable = [
        {
            Metric: 'Total Calls',
            Baseline: baseCalls,
            Candidate: candCalls,
            Delta: formatDeltaNumber(candCalls - baseCalls),
        },
        {
            Metric: 'Succeeded',
            Baseline: base.overall.succeeded,
            Candidate: cand.overall.succeeded,
            Delta: formatDeltaNumber(cand.overall.succeeded - base.overall.succeeded),
        },
        {
            Metric: 'Failed',
            Baseline: base.overall.failed,
            Candidate: cand.overall.failed,
            Delta: formatDeltaNumber(cand.overall.failed - base.overall.failed),
        },
        {
            Metric: 'Success %',
            Baseline: baseSuccessPct,
            Candidate: candSuccessPct,
            Delta: successDeltaStr,
        },
        {
            Metric: 'Avg Latency',
            Baseline: baseLatencyStr,
            Candidate: candLatencyStr,
            Delta: latencyDeltaStr,
        },
    ];

    const allTools = Array.from(new Set([...base.tools.keys(), ...cand.tools.keys()])).sort();
    const toolTable = [];
    const jsonToolDeltas = [];

    for (const tool of allTools) {
        const b = base.tools.get(tool);
        const c = cand.tools.get(tool);

        const bCount = b?.calls ?? 0;
        const cCount = c?.calls ?? 0;

        const bRate = b?.successRate ?? 0;
        const cRate = c?.successRate ?? 0;

        const bLat = b?.avgLatencyMs ?? 0;
        const cLat = c?.avgLatencyMs ?? 0;

        const bSuccess = bCount > 0 ? `${(bRate * 100).toFixed(1)}%` : '-';
        const cSuccess = cCount > 0 ? `${(cRate * 100).toFixed(1)}%` : '-';
        const sDelta = bCount > 0 && cCount > 0 ? formatDeltaNumber((cRate - bRate) * 100, '%', 1) : '-';

        const bLatDisplay = bCount > 0 ? bLat : '-';
        const cLatDisplay = cCount > 0 ? cLat : '-';
        const lDelta = bCount > 0 && cCount > 0 ? formatDeltaNumber(cLat - bLat) : '-';

        toolTable.push({
            Tool: tool,
            'Base Calls': bCount,
            'Cand Calls': cCount,
            'Base Success %': bSuccess,
            'Cand Success %': cSuccess,
            'Success Delta': sDelta,
            'Base Latency (ms)': bLatDisplay,
            'Cand Latency (ms)': cLatDisplay,
            'Latency Delta (ms)': lDelta,
        });

        jsonToolDeltas.push({
            tool,
            baseCalls: bCount,
            candCalls: cCount,
            baseSuccessRate: Number(bRate.toFixed(4)),
            candSuccessRate: Number(cRate.toFixed(4)),
            successRateDelta: Number((cRate - bRate).toFixed(4)),
            baseAvgLatencyMs: bLat,
            candAvgLatencyMs: cLat,
            avgLatencyDeltaMs: cLat - bLat,
        });
    }

    const allFailureCodes = Array.from(
        new Set([...Object.keys(base.failureCodes), ...Object.keys(cand.failureCodes)]),
    ).sort();
    const failureTable = [];
    const jsonFailureDeltas = [];

    for (const code of allFailureCodes) {
        const bCount = base.failureCodes[code] ?? 0;
        const cCount = cand.failureCodes[code] ?? 0;
        const delta = cCount - bCount;

        failureTable.push({
            'Failure Code': code,
            Baseline: bCount,
            Candidate: cCount,
            Delta: formatDeltaNumber(delta),
        });

        jsonFailureDeltas.push({
            code,
            baseline: bCount,
            candidate: cCount,
            delta,
        });
    }

    let agentTable = null;
    const jsonAgentDeltas = [];

    if (base.mode === 'team' && cand.mode === 'team') {
        agentTable = [];
        const allAgents = Array.from(new Set([...base.agents.keys(), ...cand.agents.keys()])).sort();

        for (const agent of allAgents) {
            const b = base.agents.get(agent);
            const c = cand.agents.get(agent);

            const bCount = b?.calls ?? 0;
            const cCount = c?.calls ?? 0;

            const bRate = b?.successRate ?? 0;
            const cRate = c?.successRate ?? 0;

            const bLat = b?.avgLatencyMs ?? 0;
            const cLat = c?.avgLatencyMs ?? 0;

            const bSuccess = bCount > 0 ? `${(bRate * 100).toFixed(1)}%` : '-';
            const cSuccess = cCount > 0 ? `${(cRate * 100).toFixed(1)}%` : '-';
            const sDelta = bCount > 0 && cCount > 0 ? formatDeltaNumber((cRate - bRate) * 100, '%', 1) : '-';

            const bLatDisplay = bCount > 0 ? bLat : '-';
            const cLatDisplay = cCount > 0 ? cLat : '-';
            const lDelta = bCount > 0 && cCount > 0 ? formatDeltaNumber(cLat - bLat) : '-';

            agentTable.push({
                Agent: agent,
                'Base Calls': bCount,
                'Cand Calls': cCount,
                'Base Success %': bSuccess,
                'Cand Success %': cSuccess,
                'Success Delta': sDelta,
                'Base Latency (ms)': bLatDisplay,
                'Cand Latency (ms)': cLatDisplay,
                'Latency Delta (ms)': lDelta,
            });

            jsonAgentDeltas.push({
                agent,
                baseCalls: bCount,
                candCalls: cCount,
                baseSuccessRate: Number(bRate.toFixed(4)),
                candSuccessRate: Number(cRate.toFixed(4)),
                successRateDelta: Number((cRate - bRate).toFixed(4)),
                baseAvgLatencyMs: bLat,
                candAvgLatencyMs: cLat,
                avgLatencyDeltaMs: cLat - bLat,
            });
        }
    }

    const baselineTarget = typeof baselineInput === 'string' ? baselineInput : baselineRaw.target;
    const candidateTarget = typeof candidateInput === 'string' ? candidateInput : candidateRaw.target;

    const diffReport = {
        generatedAt: new Date().toISOString(),
        baselineTarget,
        candidateTarget,
        baselineMode: base.mode,
        candidateMode: cand.mode,
        overall: {
            baseline: {
                calls: baseCalls,
                succeeded: base.overall.succeeded,
                failed: base.overall.failed,
                successRate: Number(base.overall.successRate.toFixed(4)),
                avgLatencyMs: base.overall.avgLatencyMs,
            },
            candidate: {
                calls: candCalls,
                succeeded: cand.overall.succeeded,
                failed: cand.overall.failed,
                successRate: Number(cand.overall.successRate.toFixed(4)),
                avgLatencyMs: cand.overall.avgLatencyMs,
            },
            delta: {
                calls: candCalls - baseCalls,
                succeeded: cand.overall.succeeded - base.overall.succeeded,
                failed: cand.overall.failed - base.overall.failed,
                successRate: Number((cand.overall.successRate - base.overall.successRate).toFixed(4)),
                avgLatencyMs: cand.overall.avgLatencyMs - base.overall.avgLatencyMs,
            },
        },
        toolDeltas: jsonToolDeltas,
        failureCodeDeltas: jsonFailureDeltas,
    };

    if (agentTable) {
        diffReport.agentDeltas = jsonAgentDeltas;
    }

    if (options.outPath) {
        writeDiffFile(diffReport, options.outPath);
    }

    console.log('\nOverall Summary Delta:');
    console.table(overallTable);

    console.log('\nPer-Tool Delta:');
    console.table(toolTable);

    if (failureTable.length > 0) {
        console.log('\nFailure Code Delta:');
        console.table(failureTable);
    } else {
        console.log('\nNo failure codes recorded in either run.');
    }

    if (agentTable) {
        console.log('\nPer-Agent Delta:');
        console.table(agentTable);
    }

    return {
        overallTable,
        toolTable,
        failureTable,
        agentTable,
        diff: diffReport,
    };
}

export async function main(argv = process.argv.slice(2)) {
    let args;
    try {
        args = parseCompareArgs(argv);
    } catch (e) {
        console.error(`compare-benchmarks: ${e.message}`);
        return 1;
    }

    if (args.help) {
        console.log(
            'Usage: npm run compare -- <baseline.json> <candidate.json> [--out <filepath>]\n\n' +
                'Compares two benchmark telemetry reports and prints side-by-side delta tables.',
        );
        return 0;
    }

    if (!args.baselinePath || !args.candidatePath) {
        console.error('compare-benchmarks: Two report file paths are required: <baseline.json> <candidate.json>');
        return 1;
    }

    try {
        await compareBenchmarks(args.baselinePath, args.candidatePath, { outPath: args.outPath });
        return 0;
    } catch (e) {
        console.error(`compare-benchmarks: ${e.message}`);
        return 1;
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const code = await main();
    if (code) process.exit(code);
}
