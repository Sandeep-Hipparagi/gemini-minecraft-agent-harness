import { startupCommands } from './dev-world.js';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

export function parseProperties(content) {
    if (!content) return {};
    return Object.fromEntries(
        content
            .split('\n')
            .filter(l => l.includes('=') && !l.startsWith('#'))
            .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
    );
}

export function buildServerProperties(existingContent = '', options = {}) {
    const defaults = {
        'spawn-protection': '0',
        difficulty: 'easy',
        'view-distance': '6',
        'simulation-distance': '4',
        'allow-flight': 'true',
        'pause-when-empty-seconds': '0',
        'network-compression-threshold': '512',
        motd: 'minecraft-agent-harness dev server',
        'level-seed': options.seed ?? '2024',
    };
    const current = existingContent
        ? Object.fromEntries(
              Object.entries(parseProperties(existingContent)).filter(([k, v]) => v !== '' || !(k in defaults)),
          )
        : {};
    const rconPassword = options['rcon-password'] ?? options.rconPassword;
    const rconPort = options['rcon-port'] ?? options.rconPort ?? '25575';
    const forced = {
        'online-mode': 'false',
        'server-port': String(options.port ?? '25565'),
        'spawn-protection': '0',
        ...(options.world === 'void' && !options.worldExists
            ? {
                  'level-type': 'minecraft:flat',
                  'generator-settings': JSON.stringify({
                      layers: [{ block: 'minecraft:air', height: 1 }],
                      biome: 'minecraft:the_void',
                  }),
                  'generate-structures': 'false',
              }
            : {}),
        ...(rconPassword
            ? { 'enable-rcon': 'true', 'rcon.port': String(rconPort), 'rcon.password': String(rconPassword) }
            : {}),
    };
    return (
        Object.entries({ ...defaults, ...current, ...forced })
            .map(([k, v]) => `${k}=${v}`)
            .join('\n') + '\n'
    );
}

export function buildJavaArgs({ jar, memory = '3G', minMemory = '2G' } = {}) {
    const args = [`-Xms${minMemory}`, `-Xmx${memory}`];
    if (jar) args.push('-jar', jar);
    args.push('--nogui');
    return args;
}

export function resolveJavaExecutable() {
    if (process.env.JAVA_HOME) {
        const bin = path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
        if (existsSync(bin)) return bin;
    }
    const localJdk = path.join(process.env.USERPROFILE ?? '', '.jdk', 'jdk-21.0.13+9', 'bin', 'java.exe');
    if (process.platform === 'win32' && existsSync(localJdk)) return localJdk;
    return 'java';
}

export function configureServerProperties(dir, options = {}) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'eula.txt'), 'eula=true\n');
    const props = path.join(dir, 'server.properties');
    const worldExists = options.worldExists ?? existsSync(path.join(dir, 'world', 'level.dat'));
    const existingContent = existsSync(props) ? readFileSync(props, 'utf8') : '';
    const content = buildServerProperties(existingContent, { ...options, worldExists });
    writeFileSync(props, content);
    return { propsPath: props, content, worldExists };
}

export async function main(args = process.argv.slice(2)) {
    const { values } = parseArgs({
        args,
        options: {
            'mc-version': { type: 'string', default: process.env.MC_VERSION ?? '1.21.6' },
            port: { type: 'string', default: process.env.MC_PORT ?? '25565' },
            dir: { type: 'string', default: 'server' },
            memory: { type: 'string', default: process.env.MC_MAX_MEMORY ?? process.env.MC_MEMORY ?? '3G' },
            'min-memory': { type: 'string', default: process.env.MC_MIN_MEMORY ?? '2G' },
            seed: { type: 'string', default: process.env.MC_SEED ?? '2024' },
            world: { type: 'string', default: 'normal' },
            'rcon-password': { type: 'string', default: process.env.MC_RCON_PASSWORD },
            'rcon-port': { type: 'string', default: '25575' },
            help: { type: 'boolean', short: 'h' },
        },
    });

    if (values.help) {
        console.log(
            'Usage: npm run server -- [--mc-version 1.21.6] [--port 25565] [--dir server] [--memory 3G]\n' +
                '                         [--min-memory 2G] [--seed 2024] [--world normal|void]\n' +
                '                         [--rcon-password secret] [--rcon-port 25575]',
        );
        console.log(
            'Downloads Paper, accepts the Minecraft EULA on your behalf and starts an offline-mode server for local testing.\n' +
                'New worlds use seed 2024 (forest spawn with trees close by). Every start sets the time to morning.\n' +
                '--world void makes new worlds empty (for arenas built by a script); --rcon-password turns on RCON.',
        );
        process.exit(0);
    }

    if (!['normal', 'void'].includes(values.world)) {
        console.error('--world must be normal or void');
        process.exit(2);
    }
    const version = values['mc-version'];
    const dir = path.resolve(values.dir);
    const jar = path.join(dir, `paper-${version}.jar`);
    mkdirSync(dir, { recursive: true });

    async function download() {
        const res = await fetch(`https://fill.papermc.io/v3/projects/paper/versions/${version}/builds`, {
            headers: { 'user-agent': 'minecraft-agent-harness dev-server' },
        });
        if (!res.ok) throw new Error(`PaperMC has no builds for ${version} (HTTP ${res.status})`);
        const builds = await res.json();
        const build = builds.find(b => b.channel === 'STABLE') ?? builds[0];
        const file = build?.downloads?.['server:default'];
        if (!file) throw new Error(`No server download for Paper ${version}`);
        console.log(`Downloading ${file.name}...`);
        const body = Buffer.from(await (await fetch(file.url)).arrayBuffer());
        const sha = createHash('sha256').update(body).digest('hex');
        if (sha !== file.checksums.sha256) throw new Error(`Checksum mismatch for ${file.name}`);
        writeFileSync(jar, body);
    }

    if (!existsSync(jar)) await download();

    const { worldExists } = configureServerProperties(dir, {
        seed: values.seed,
        port: values.port,
        world: values.world,
        'rcon-password': values['rcon-password'],
        'rcon-port': values['rcon-port'],
    });

    console.log(`Starting Paper ${version} on port ${values.port} (offline mode). Type "stop" to shut down.`);
    if (worldExists)
        console.log(
            `Using the existing world in ${dir}/world. Delete ${dir}/world* to generate a new one from the seed.`,
        );
    const javaArgs = buildJavaArgs({
        jar,
        memory: values.memory,
        minMemory: values['min-memory'],
    });
    const child = spawn(resolveJavaExecutable(), javaArgs, {
        cwd: dir,
        stdio: ['pipe', 'pipe', 'inherit'],
    });
    process.stdin.pipe(child.stdin);
    let morning = false;
    child.stdout.on('data', chunk => {
        process.stdout.write(chunk);
        if (!morning && /Done \(/.test(String(chunk))) {
            morning = true;
            for (const command of startupCommands({ worldExists, world: values.world, seed: values.seed }))
                child.stdin.write(`${command}\n`);
        }
    });
    const forward = signal => () => child.kill(signal);
    process.on('SIGINT', forward('SIGINT'));
    process.on('SIGTERM', forward('SIGTERM'));
    child.on('error', e => {
        console.error(e.code === 'ENOENT' ? 'Java 21+ is required: https://adoptium.net' : e.message);
        process.exit(1);
    });
    child.on('exit', code => process.exit(code ?? 0));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    await main();
}
