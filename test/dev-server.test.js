import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    buildJavaArgs,
    buildServerProperties,
    configureServerProperties,
    parseProperties,
    resolveJavaExecutable,
} from '../scripts/dev-server.js';

test('buildServerProperties includes spawn-protection=0 and lightweight multi-agent defaults when fresh', () => {
    const content = buildServerProperties('', { port: '25565', seed: '2024' });
    const props = parseProperties(content);

    assert.equal(props['spawn-protection'], '0');
    assert.equal(props['online-mode'], 'false');
    assert.equal(props['server-port'], '25565');
    assert.equal(props['difficulty'], 'easy');
    assert.equal(props['view-distance'], '6');
    assert.equal(props['simulation-distance'], '4');
    assert.equal(props['allow-flight'], 'true');
    assert.equal(props['pause-when-empty-seconds'], '0');
    assert.equal(props['network-compression-threshold'], '512');
    assert.equal(props['motd'], 'minecraft-agent-harness dev server');
    assert.equal(props['level-seed'], '2024');
});

test('buildServerProperties updates spawn-protection to 0 and preserves custom properties', () => {
    const existing = [
        '# Minecraft server properties',
        'difficulty=hard',
        'motd=Custom Gemini Arena',
        'spawn-protection=16',
        'view-distance=10',
        'simulation-distance=8',
        'allow-flight=false',
        'pause-when-empty-seconds=60',
        'network-compression-threshold=256',
        'pvp=false',
        'max-players=50',
    ].join('\n');

    const content = buildServerProperties(existing, { port: '25565' });
    const props = parseProperties(content);

    assert.equal(props['spawn-protection'], '0');
    assert.equal(props['difficulty'], 'hard');
    assert.equal(props['motd'], 'Custom Gemini Arena');
    assert.equal(props['view-distance'], '10');
    assert.equal(props['simulation-distance'], '8');
    assert.equal(props['allow-flight'], 'false');
    assert.equal(props['pause-when-empty-seconds'], '60');
    assert.equal(props['network-compression-threshold'], '256');
    assert.equal(props['pvp'], 'false');
    assert.equal(props['max-players'], '50');
    assert.equal(props['online-mode'], 'false');
});

test('buildServerProperties appends spawn-protection=0 when missing from existing content', () => {
    const existing = ['difficulty=normal', 'motd=Vanilla World'].join('\n');

    const content = buildServerProperties(existing);
    const props = parseProperties(content);

    assert.equal(props['spawn-protection'], '0');
    assert.equal(props['difficulty'], 'normal');
    assert.equal(props['motd'], 'Vanilla World');
    assert.equal(props['view-distance'], '6');
    assert.equal(props['simulation-distance'], '4');
    assert.equal(props['allow-flight'], 'true');
    assert.equal(props['pause-when-empty-seconds'], '0');
    assert.equal(props['network-compression-threshold'], '512');
    assert.equal(props['online-mode'], 'false');
});

test('configureServerProperties creates eula.txt and fresh server.properties on disk', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-server-fresh-'));
    try {
        const { propsPath, content } = configureServerProperties(tmpDir, {
            seed: '9999',
            port: '25565',
        });

        assert.equal(propsPath, path.join(tmpDir, 'server.properties'));
        const eulaContent = await fs.readFile(path.join(tmpDir, 'eula.txt'), 'utf8');
        assert.equal(eulaContent, 'eula=true\n');

        const fileContent = await fs.readFile(propsPath, 'utf8');
        assert.equal(fileContent, content);

        const props = parseProperties(fileContent);
        assert.equal(props['spawn-protection'], '0');
        assert.equal(props['online-mode'], 'false');
        assert.equal(props['level-seed'], '9999');
        assert.equal(props['view-distance'], '6');
        assert.equal(props['simulation-distance'], '4');
        assert.equal(props['allow-flight'], 'true');
        assert.equal(props['pause-when-empty-seconds'], '0');
        assert.equal(props['network-compression-threshold'], '512');
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
    }
});

test('configureServerProperties updates existing server.properties on disk without clobbering', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-server-existing-'));
    try {
        const propsPath = path.join(tmpDir, 'server.properties');
        const initial = [
            'spawn-protection=32',
            'difficulty=peaceful',
            'view-distance=12',
            'motd=Existing Server',
            'white-list=true',
        ].join('\n');
        await fs.writeFile(propsPath, initial);

        configureServerProperties(tmpDir, { port: '25565' });

        const updated = await fs.readFile(propsPath, 'utf8');
        const props = parseProperties(updated);

        assert.equal(props['spawn-protection'], '0');
        assert.equal(props['difficulty'], 'peaceful');
        assert.equal(props['view-distance'], '12');
        assert.equal(props['motd'], 'Existing Server');
        assert.equal(props['white-list'], 'true');
        assert.equal(props['online-mode'], 'false');
        assert.equal(props['allow-flight'], 'true');
        assert.equal(props['simulation-distance'], '4');
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
    }
});

test('buildJavaArgs defaults to -Xms2G -Xmx3G and supports custom memory options', () => {
    assert.deepEqual(buildJavaArgs({ jar: 'paper-1.21.6.jar' }), [
        '-Xms2G',
        '-Xmx3G',
        '-jar',
        'paper-1.21.6.jar',
        '--nogui',
    ]);
    assert.deepEqual(buildJavaArgs({ jar: 'custom.jar', memory: '4G', minMemory: '1G' }), [
        '-Xms1G',
        '-Xmx4G',
        '-jar',
        'custom.jar',
        '--nogui',
    ]);
    assert.deepEqual(buildJavaArgs(), ['-Xms2G', '-Xmx3G', '--nogui']);
});

test('resolveJavaExecutable returns executable string', () => {
    const javaBin = resolveJavaExecutable();
    assert.equal(typeof javaBin, 'string');
    assert.ok(javaBin.length > 0);
});
