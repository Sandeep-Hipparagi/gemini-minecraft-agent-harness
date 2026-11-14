import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolveConfig, readConfigFile, fromEnv, DEFAULTS } from './config.js';
import { EXIT, checkModel } from './startup.js';

const BIN = fileURLToPath(new URL('../bin/minecraft-agent.js', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const RUN_OPTIONS = {
    team: { type: 'string' },
    config: { type: 'string', short: 'c' },
    host: { type: 'string', short: 'H' },
    port: { type: 'string', short: 'p' },
    auth: { type: 'string' },
    'mc-version': { type: 'string' },
    name: { type: 'string', short: 'n' },
    objective: { type: 'string', short: 'o' },
    'game-mode': { type: 'string' },
    model: { type: 'string', short: 'm' },
    thinking: { type: 'string' },
    sandbox: { type: 'string' },
    'docker-image': { type: 'string' },
    vision: { type: 'boolean' },
    'tick-rate': { type: 'string' },
    'state-dir': { type: 'string' },
    duration: { type: 'string' },
    'no-respawn': { type: 'boolean' },
    'allow-flight': { type: 'boolean' },
    personality: { type: 'string' },
    'soul-file': { type: 'string' },
    'tools-module': { type: 'string' },
    quiet: { type: 'boolean', short: 'q' },
    'no-reconnect': { type: 'boolean' },
    all: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
};

const FLAG_TO_KEY = {
    host: 'host',
    port: 'port',
    auth: 'auth',
    'mc-version': 'minecraftVersion',
    name: 'name',
    objective: 'objective',
    'game-mode': 'gameMode',
    model: 'model',
    thinking: 'thinking',
    sandbox: 'sandbox',
    'docker-image': 'dockerImage',
    vision: 'vision',
    'tick-rate': 'tickRate',
    'state-dir': 'stateDir',
    duration: 'durationMinutes',
    'allow-flight': 'allowFlight',
    personality: 'personality',
    'soul-file': 'soulFile',
    'tools-module': 'toolsModule',
};

const HELP = `minecraft-agent ${pkg.version}
Run a Gemini language-model agent on a Minecraft server.

Usage
  minecraft-agent [run] [options]      start one agent
  minecraft-agent team <team.json>     start several agents that share a machine
  minecraft-agent models               list available Gemini models

Server
  -H, --host <host>          Minecraft server host            (MC_HOST, default ${DEFAULTS.host})
  -p, --port <port>          Minecraft server port            (MC_PORT, default ${DEFAULTS.port})
      --auth <mode>          offline | microsoft              (MC_AUTH, default ${DEFAULTS.auth})
      --mc-version <ver>     protocol version or "auto"       (MC_VERSION, default ${DEFAULTS.minecraftVersion})

Agent
  -n, --name <name>          in-game username                 (AGENT_NAME, default ${DEFAULTS.name})
  -o, --objective <text>     what the agent should do         (AGENT_OBJECTIVE, required)
      --game-mode <mode>     survival | creative              (AGENT_GAME_MODE, default ${DEFAULTS.gameMode})
      --personality <text>   private disposition for the agent
      --soul-file <path>     markdown persona loaded into the prompt
      --duration <minutes>   stop after this long             (default: run until stopped)
      --no-respawn           permanent death
      --allow-flight         let creative-mode agents fly
      --tick-rate <tps>      server tick rate if it runs below 20
      --no-reconnect         exit instead of reconnecting after a kick or disconnect
  -q, --quiet                no per-tool activity lines on the console      (AGENT_QUIET)

Model
  -m, --model <id>           Gemini model id or google/<id>   (GEMINI_MODEL / AGENT_MODEL, default ${DEFAULTS.model})
      --thinking <level>     off | minimal | low | medium | high | xhigh (default ${DEFAULTS.thinking})

Sandbox
      --sandbox <kind>       none | local | docker            (AGENT_SANDBOX; default docker if Docker is running, else local)
      --docker-image <ref>   image for --sandbox docker       (AGENT_DOCKER_IMAGE, default node:22-bookworm)
      --state-dir <dir>      sessions, notes and logs         (AGENT_STATE_DIR, default ${DEFAULTS.stateDir})

  -c, --config <file>        JSON config file; flags override env, env overrides the file
  -h, --help                 show this help
  -v, --version              print the version

Examples
  minecraft-agent --objective "Build a small oak cabin next to spawn"
  minecraft-agent -H localhost -n Builder -m gemini-2.5-flash -o "Mine iron and craft a full set of armor"
  minecraft-agent team examples/team.json
`;

function loadDotEnv(cwd) {
    const file = path.join(cwd, '.env');
    if (existsSync(file)) process.loadEnvFile(file);
}

function flagsToConfig(values) {
    const out = {};
    for (const [flag, key] of Object.entries(FLAG_TO_KEY)) if (values[flag] !== undefined) out[key] = values[flag];
    if (values['no-respawn']) out.respawn = false;
    if (values['no-reconnect']) out.reconnect = false;
    if (values.quiet) out.quiet = true;
    return out;
}

export async function main(argv = process.argv.slice(2)) {
    const cwd = process.cwd();
    loadDotEnv(cwd);
    const command = ['run', 'team', 'models'].includes(argv[0]) ? argv.shift() : 'run';
    let parsed;
    try {
        parsed = parseArgs({ args: argv, options: RUN_OPTIONS, allowPositionals: true, strict: true });
    } catch (e) {
        console.error(`minecraft-agent: ${e.message}\nRun minecraft-agent --help for usage.`);
        return EXIT.usage;
    }
    const { values, positionals } = parsed;
    if (values.version) {
        console.log(pkg.version);
        return EXIT.ok;
    }
    if (values.help) {
        console.log(HELP);
        return EXIT.ok;
    }
    if (command === 'models') return listModels();
    if (command === 'team') return runTeam(positionals[0] ?? values.team ?? values.config, cwd);
    let config;
    try {
        const file = values.config ? readConfigFile(path.resolve(cwd, values.config)) : {};
        config = resolveConfig([file, fromEnv(), flagsToConfig(values)], { cwd });
    } catch (e) {
        if (e.code !== 'INVALID_CONFIG' && e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e;
        console.error(`minecraft-agent: ${e.message}\nRun minecraft-agent --help for usage.`);
        return EXIT.usage;
    }
    if (process.env.MINECRAFT_AGENT_WORKER === '1') {
        if (process.env.MINECRAFT_AGENT_DEADLINE_AT) config.deadlineAt = process.env.MINECRAFT_AGENT_DEADLINE_AT;
        return runWorker(config);
    }
    const problem = await checkModel(config);
    if (problem) {
        console.error(`minecraft-agent: ${problem}`);
        return EXIT.error;
    }
    if (config.reconnect === false) return runWorker(config);
    return supervise(argv, config);
}

const sleep = (ms, signal) =>
    new Promise(resolve => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
    });

export function reconnectDelay(attempt) {
    return Math.min(60000, 5000 * 2 ** Math.max(0, attempt - 1));
}

export const MAX_RECONNECTS = 8;

async function supervise(argv, config) {
    const say = message => process.stdout.write(`[${config.name}] ${message}\n`);
    const stop = new AbortController();
    let child = null;
    const onSignal = () => {
        stop.abort();
        child?.kill('SIGTERM');
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    let attempt = 0;
    try {
        for (;;) {
            const startedAt = Date.now();
            child = spawn(process.execPath, [BIN, 'run', ...argv], {
                stdio: 'inherit',
                env: {
                    ...process.env,
                    MINECRAFT_AGENT_WORKER: '1',
                    MINECRAFT_AGENT_ATTEMPT: String(attempt),
                    ...(config.deadlineAt ? { MINECRAFT_AGENT_DEADLINE_AT: config.deadlineAt } : {}),
                },
            });
            const code = await new Promise(resolve => {
                child.once('exit', (c, signal) => resolve(c ?? (signal ? EXIT.error : EXIT.ok)));
                child.once('error', () => resolve(EXIT.error));
            });
            child = null;
            if (stop.signal.aborted || code !== EXIT.reconnect) return code;
            if (config.deadlineAt && Date.parse(config.deadlineAt) - Date.now() < 30000) return EXIT.ok;
            if (Date.now() - startedAt > 120000) attempt = 0;
            attempt++;
            if (attempt > MAX_RECONNECTS) {
                say(`giving up after ${MAX_RECONNECTS} reconnect attempts`);
                return EXIT.error;
            }
            const delay = reconnectDelay(attempt);
            say(`reconnecting in ${delay / 1000}s (attempt ${attempt}/${MAX_RECONNECTS})`);
            await sleep(delay, stop.signal);
            if (stop.signal.aborted) return EXIT.ok;
        }
    } finally {
        process.off('SIGINT', onSignal);
        process.off('SIGTERM', onSignal);
    }
}

async function runWorker(config) {
    const { startAgent } = await import('./index.js');
    const where = `${config.host}:${config.port}`;
    const say = message => process.stdout.write(`[${config.name}] ${message}\n`);
    say(
        `connecting to ${where} as ${config.name} with ${config.model.provider}/${config.model.id} (sandbox: ${config.sandbox.kind})`,
    );
    await startAgent(config, {
        attempt: Number(process.env.MINECRAFT_AGENT_ATTEMPT ?? 0),
        onSession: info =>
            say(
                info.resumed
                    ? `resumed session ${path.basename(info.file ?? '')} (${info.messages} messages${info.interrupted ? ', picking up an interrupted turn' : ''})`
                    : `new session ${path.basename(info.file ?? '')}`,
            ),
        onReady: ({ tools, position }) =>
            say(
                `spawned${position ? ` at ${position}` : ''}; ${tools.length} tools ready. Logs: ${path.join(config.stateDir, config.name, 'telemetry.jsonl')}`,
            ),
        onActivity: config.quiet ? undefined : line => say(line),
        onStop: (reason, message) => {
            const line = `stopping (${reason})${message ? `: ${message}` : ''}`;
            if (['startup_error', 'connection_failed', 'model_error', 'kicked_fatal', 'unsafe_action'].includes(reason))
                process.stderr.write(`[${config.name}] ${line}\n`);
            else say(line);
        },
    });
    return EXIT.ok;
}

async function listModels() {
    const { ModelRuntime } = await import('@earendil-works/pi-coding-agent');
    const runtime = await ModelRuntime.create({ allowModelNetwork: false });
    const hasKey = Boolean(process.env.GEMINI_API_KEY) || runtime.hasConfiguredAuth('google');
    const models = runtime.getModels('google');
    if (!models.length) {
        console.error('minecraft-agent: no Gemini models found in catalog.');
        return EXIT.error;
    }
    console.log(`google${hasKey ? '' : ' (no GEMINI_API_KEY set)'}`);
    for (const m of models) console.log(`  google/${m.id}`);
    return EXIT.ok;
}

async function runTeam(file, cwd) {
    if (!file) {
        console.error('minecraft-agent team: pass a team config file, see examples/team.json');
        return 2;
    }
    const team = readConfigFile(path.resolve(cwd, file));
    const { agents = [], sharedMachine = 'local', staggerSeconds = 3, ...common } = team;
    if (!Array.isArray(agents) || agents.length < 2) {
        console.error('minecraft-agent team: "agents" must list at least two agents');
        return 2;
    }
    const names = agents.map(a => a.name);
    const stateDir = path.resolve(
        cwd,
        common.stateDir ??
            fromEnv().stateDir ??
            (typeof common.team === 'string' ? path.join(DEFAULTS.stateDir, common.team) : DEFAULTS.stateDir),
    );
    mkdirSync(path.join(stateDir, 'shared'), { recursive: true, mode: 0o700 });
    const configs = agents.map(agent => ({
        ...common,
        ...agent,
        stateDir,
        team: true,
        peers: names.filter(n => n !== agent.name),
    }));
    const childEnv = { ...process.env };
    for (const key of ['AGENT_NAME', 'AGENT_OBJECTIVE', 'AGENT_PERSONALITY']) delete childEnv[key];
    try {
        for (const c of configs) resolveConfig([c, fromEnv(childEnv)], { cwd });
    } catch (e) {
        if (e.code !== 'INVALID_CONFIG') throw e;
        console.error(`minecraft-agent team: ${e.message}`);
        return 2;
    }
    let server = null;
    let sharedRoot = '/shared';
    const socketPath =
        process.platform === 'win32'
            ? `\\\\.\\pipe\\minecraft-agent-${path.basename(stateDir)}-shared-machine`
            : path.join(stateDir, 'shared-machine.sock');
    if (sharedMachine === 'local') {
        const { startLocalSharedMachine } = await import('./shared-machine/local.js');
        sharedRoot = path.join(stateDir, 'shared-machine');
        server = await startLocalSharedMachine({ socketPath, root: sharedRoot, peers: names });
    } else if (sharedMachine !== 'none') {
        console.error('sharedMachine must be local or none');
        return 2;
    }
    if (server) console.log(`[team] shared machine (${sharedMachine}) listening`);
    const children = [];
    let stopping = false;
    const stopAll = () => {
        if (stopping) return;
        stopping = true;
        for (const c of children) c.kill('SIGTERM');
    };
    process.on('SIGINT', stopAll);
    process.on('SIGTERM', stopAll);
    for (const c of configs) {
        if (stopping) break;
        const file = path.join(stateDir, `${c.name}.config.json`);
        writeFileSync(
            file,
            JSON.stringify(
                {
                    ...c,
                    ...(server
                        ? {
                              sharedMachineSocket: socketPath,
                              sharedMachinePath: sharedRoot,
                              sharedMachineVm: false,
                          }
                        : {}),
                },
                null,
                2,
            ),
            {
                mode: 0o600,
            },
        );
        const child = spawn(process.execPath, [BIN, 'run', '--config', file], { stdio: 'inherit', env: childEnv });
        children.push(child);
        await new Promise(r => setTimeout(r, staggerSeconds * 1000));
    }
    await Promise.all(children.map(c => new Promise(r => c.once('exit', r))));
    server?.close();
    return 0;
}
