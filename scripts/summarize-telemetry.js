import { createReadStream, existsSync, statSync, mkdirSync, writeFileSync, promises as fs } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export async function parseTelemetry(input) {
    const stream = typeof input === 'string' ? createReadStream(input, { encoding: 'utf8' }) : input;
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    const toolStats = new Map();
    const failureCounts = new Map();
    let detectedAgent = null;

    for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let entry;
        try {
            entry = JSON.parse(trimmed);
        } catch {
            continue;
        }
        if (entry.agent && !detectedAgent) detectedAgent = entry.agent;
        if (entry.event !== 'tool' || !entry.tool) continue;

        const stat = toolStats.get(entry.tool) ?? { calls: 0, success: 0, failed: 0, totalTimeMs: 0 };
        stat.calls++;
        if (entry.success === true) {
            stat.success++;
        } else {
            stat.failed++;
            const code = entry.failureCode || 'unknown';
            failureCounts.set(code, (failureCounts.get(code) || 0) + 1);
        }
        if (Number.isFinite(entry.timeMs)) {
            stat.totalTimeMs += entry.timeMs;
        }
        toolStats.set(entry.tool, stat);
    }

    const toolSummary = [...toolStats.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([tool, stat]) => ({
            Tool: tool,
            Calls: stat.calls,
            Success: stat.success,
            Failed: stat.failed,
            'Success %': `${((stat.success / stat.calls) * 100).toFixed(1)}%`,
            'Avg Latency (ms)': stat.calls > 0 ? Math.round(stat.totalTimeMs / stat.calls) : 0,
        }));

    const failureSummary = [...failureCounts.entries()]
        .sort(([, a], [, b]) => b - a)
        .map(([code, count]) => ({
            'Failure Code': code,
            Count: count,
        }));

    const tools = [...toolStats.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([tool, stat]) => ({
            tool,
            calls: stat.calls,
            succeeded: stat.success,
            failed: stat.failed,
            successRate: stat.calls > 0 ? Number((stat.success / stat.calls).toFixed(4)) : 0,
            avgLatencyMs: stat.calls > 0 ? Math.round(stat.totalTimeMs / stat.calls) : 0,
        }));

    const failureCodes = Object.fromEntries([...failureCounts.entries()].sort(([, a], [, b]) => b - a));
    const totalEvents = tools.reduce((sum, t) => sum + t.calls, 0);

    return {
        toolSummary,
        failureSummary,
        tools,
        failureCodes,
        totalEvents,
        agent: detectedAgent,
    };
}

export function buildSingleReport({ target, agent, tools, failureCodes, totalEvents, generatedAt, options = {} }) {
    const report = {
        generatedAt: generatedAt ?? new Date().toISOString(),
        mode: 'single',
        target,
        agent: agent ?? 'GeminiBot',
        totalEvents: totalEvents ?? tools.reduce((sum, t) => sum + t.calls, 0),
        tools,
        failureCodes,
    };
    if (options.durationSeconds) report.durationSeconds = options.durationSeconds;
    if (options.teamConfigPath) report.teamConfigPath = options.teamConfigPath;
    return report;
}

export function writeReportFile(report, outPath) {
    if (!outPath) return;
    const resolvedPath = path.resolve(outPath);
    mkdirSync(path.dirname(resolvedPath), { recursive: true });
    writeFileSync(resolvedPath, JSON.stringify(report, null, 4) + '\n', 'utf8');
    console.log(`\nReport written to: ${resolvedPath}`);
}

export async function findAgentTelemetryFiles(dirPath) {
    if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) return [];
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const agents = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === 'shared') continue;
        const candidate = path.join(dirPath, entry.name, 'telemetry.jsonl');
        if (existsSync(candidate) && statSync(candidate).isFile()) {
            agents.push({ agent: entry.name, file: candidate });
        }
    }
    return agents.sort((a, b) => a.agent.localeCompare(b.agent));
}

export async function summarizeTeamTelemetry(dirPath, options = {}) {
    const agentFiles = await findAgentTelemetryFiles(dirPath);
    if (!agentFiles.length) {
        console.error(`No agent telemetry files found in directory: ${dirPath}`);
        return null;
    }

    const teamOverview = [];
    const toolMap = new Map();
    const agentSummaries = {};
    const agentsList = [];

    for (const { agent, file } of agentFiles) {
        const { toolSummary, failureSummary, tools, failureCodes, totalEvents } = await parseTelemetry(file);
        agentSummaries[agent] = { toolSummary, failureSummary };

        const totalCalls = toolSummary.reduce((sum, t) => sum + t.Calls, 0);
        const succeeded = toolSummary.reduce((sum, t) => sum + t.Success, 0);
        const failed = toolSummary.reduce((sum, t) => sum + t.Failed, 0);
        const totalLatency = toolSummary.reduce((sum, t) => sum + t['Avg Latency (ms)'] * t.Calls, 0);
        const avgLatency = totalCalls > 0 ? Math.round(totalLatency / totalCalls) : 0;
        const topFailure = failureSummary[0]?.['Failure Code'] ?? '-';
        const successPct = totalCalls > 0 ? `${((succeeded / totalCalls) * 100).toFixed(1)}%` : '0.0%';

        teamOverview.push({
            Agent: agent,
            'Total Calls': totalCalls,
            Succeeded: succeeded,
            Failed: failed,
            'Success %': successPct,
            'Avg Latency (ms)': avgLatency,
            'Top Failure Code': topFailure,
        });

        agentsList.push({
            agent,
            totalEvents,
            tools,
            failureCodes,
        });

        for (const t of toolSummary) {
            const current = toolMap.get(t.Tool) ?? {
                totalCalls: 0,
                success: 0,
                failed: 0,
                agentStats: {},
            };
            current.totalCalls += t.Calls;
            current.success += t.Success;
            current.failed += t.Failed;
            current.agentStats[agent] = `${t.Success}/${t.Calls}`;
            toolMap.set(t.Tool, current);
        }
    }

    const agentNames = agentFiles.map(a => a.agent);
    const crossToolBreakdown = [...toolMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([tool, data]) => {
            const row = {
                Tool: tool,
                'Total Calls': data.totalCalls,
                Success: data.success,
                Failed: data.failed,
            };
            for (const name of agentNames) {
                row[name] = data.agentStats[name] ?? '-';
            }
            return row;
        });

    const jsonCrossToolBreakdown = [...toolMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([tool, data]) => {
            const row = {
                tool,
                totalCalls: data.totalCalls,
                succeeded: data.success,
                failed: data.failed,
                byAgent: { ...data.agentStats },
            };
            for (const name of agentNames) {
                row[name] = data.agentStats[name] ?? '-';
            }
            return row;
        });

    const team = options.teamName ?? path.basename(dirPath);
    const report = {
        generatedAt: new Date().toISOString(),
        mode: 'team',
        target: dirPath,
        team,
        agents: agentsList,
        crossToolBreakdown: jsonCrossToolBreakdown,
    };
    if (options.durationSeconds) report.durationSeconds = options.durationSeconds;
    if (options.teamConfigPath) report.teamConfigPath = options.teamConfigPath;

    if (options.outPath) {
        writeReportFile(report, options.outPath);
    }

    console.log(`\nTeam Overview (${dirPath}):`);
    console.table(teamOverview);

    console.log('\nPer-Tool Cross-Agent Breakdown:');
    console.table(crossToolBreakdown);

    for (const { agent } of agentFiles) {
        const { toolSummary, failureSummary } = agentSummaries[agent];
        console.log(`\n--- [Agent: ${agent}] Tool Summary ---`);
        if (toolSummary.length) {
            console.table(toolSummary);
        } else {
            console.log('No tool calls recorded.');
        }
        if (failureSummary.length) {
            console.log(`\n[Agent: ${agent}] Failure Breakdown:`);
            console.table(failureSummary);
        }
    }

    return { teamOverview, crossToolBreakdown, agentSummaries, report };
}

export function resolveTarget(arg) {
    if (!arg) {
        const defaultFile = path.resolve('.agent-state', 'GeminiBot', 'telemetry.jsonl');
        if (existsSync(defaultFile)) return { kind: 'file', path: defaultFile };
        const defaultTeam = path.resolve('.agent-state', 'GeminiBot');
        if (existsSync(defaultTeam) && statSync(defaultTeam).isDirectory()) {
            return { kind: 'directory', path: defaultTeam };
        }
        return { kind: 'file', path: defaultFile };
    }

    const directPath = path.resolve(arg);
    if (existsSync(directPath)) {
        if (statSync(directPath).isDirectory()) {
            const directFile = path.join(directPath, 'telemetry.jsonl');
            if (existsSync(directFile) && statSync(directFile).isFile()) {
                return { kind: 'file', path: directFile };
            }
            return { kind: 'directory', path: directPath };
        }
        return { kind: 'file', path: directPath };
    }

    const inState = path.resolve('.agent-state', arg);
    if (existsSync(inState)) {
        if (statSync(inState).isDirectory()) {
            const inStateFile = path.join(inState, 'telemetry.jsonl');
            if (existsSync(inStateFile) && statSync(inStateFile).isFile()) {
                return { kind: 'file', path: inStateFile };
            }
            return { kind: 'directory', path: inState };
        }
        return { kind: 'file', path: inState };
    }

    if (arg.endsWith('.jsonl')) return { kind: 'file', path: directPath };

    return { kind: 'file', path: path.resolve('.agent-state', arg, 'telemetry.jsonl') };
}

export function parseTelemetryArgs(argv = process.argv.slice(2)) {
    const { values, positionals } = parseArgs({
        args: argv,
        options: {
            out: { type: 'string' },
            help: { type: 'boolean', short: 'h' },
        },
        allowPositionals: true,
    });
    return {
        target: positionals[0],
        outPath: values.out,
        help: Boolean(values.help),
    };
}

export async function summarizeTelemetry(target, options = {}) {
    let resolvedTarget = target;
    let opts = options;
    if (
        target &&
        typeof target === 'object' &&
        !target.kind &&
        !target.path &&
        ('target' in target || 'outPath' in target)
    ) {
        resolvedTarget = target.target;
        opts = target;
    }

    const resolved =
        typeof resolvedTarget === 'string'
            ? resolveTarget(resolvedTarget)
            : !resolvedTarget
              ? resolveTarget()
              : { kind: 'file', path: resolvedTarget };

    if (resolved.kind === 'directory') {
        return summarizeTeamTelemetry(resolved.path, opts);
    }

    const filePath = resolved.path;
    if (!existsSync(filePath)) {
        console.error(`Telemetry file not found: ${filePath}`);
        return null;
    }
    const { toolSummary, failureSummary, tools, failureCodes, totalEvents, agent } = await parseTelemetry(filePath);
    const parentDirName = path.basename(path.dirname(filePath));
    const detectedName = agent ?? (parentDirName !== '.agent-state' ? parentDirName : 'GeminiBot');
    const report = buildSingleReport({
        target: filePath,
        agent: detectedName,
        tools,
        failureCodes,
        totalEvents,
        options: opts,
    });

    if (opts.outPath) {
        writeReportFile(report, opts.outPath);
    }

    if (!toolSummary.length) {
        console.log(`No tool telemetry records found in ${filePath}`);
        return { toolSummary, failureSummary, report };
    }

    console.log(`\nTool Summary (${filePath}):`);
    console.table(toolSummary);

    if (failureSummary.length) {
        console.log('\nFailure Breakdown:');
        console.table(failureSummary);
    }
    return { toolSummary, failureSummary, report };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const args = parseTelemetryArgs(process.argv.slice(2));
    if (args.help) {
        console.log(
            'Usage: npm run telemetry -- [target] [--out <filepath>]\n\n' +
                'Summarizes single-agent or team telemetry and optionally exports structured JSON.',
        );
        process.exit(0);
    }
    await summarizeTelemetry(args.target, { outPath: args.outPath });
}
