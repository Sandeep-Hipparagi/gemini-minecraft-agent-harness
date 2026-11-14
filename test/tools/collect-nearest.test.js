import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameTools, createActionRunner, failureCode } from '../../src/tools/game-tools.js';

const vector = (x = 0, y = 64, z = 0) => ({
    x,
    y,
    z,
    offset(dx, dy, dz) {
        return vector(x + dx, y + dy, z + dz);
    },
    distanceTo(p) {
        return Math.hypot(x - p.x, y - p.y, z - p.z);
    },
});

function createMockBot(overrides = {}) {
    const calls = [];
    const position = vector(0, 64, 0);
    const mock = {
        calls,
        username: 'MinerBot',
        version: '1.21.4',
        game: { gameMode: 'survival' },
        entity: { id: 1, position, yaw: 0, pitch: 0 },
        entities: {},
        inventory: { items: () => [], slots: new Array(46).fill(null) },
        pathfinder: {
            setMovements: () => calls.push('setMovements'),
            setGoal: () => calls.push('setGoal'),
            stop: () => calls.push('pathfinderStop'),
            goto: async () => calls.push('goto'),
        },
        clearControlStates: () => calls.push('clearControlStates'),
        stopDigging: () => calls.push('stopDigging'),
        canDigBlock: () => true,
        dig: async () => calls.push('dig'),
        blockAt: () => ({ name: 'oak_log', position: vector(1, 64, 1) }),
        ...overrides,
    };
    return mock;
}

function getTool(botInstance, worldInstance) {
    const runner = createActionRunner(botInstance);
    const tools = createGameTools({
        bot: botInstance,
        actionRunner: runner,
        world: worldInstance ?? {
            getNearestBlocks: () => [{ name: 'oak_log', position: vector(1, 64, 1) }],
        },
    });
    const tool = tools.find(t => t.name === 'find_and_collect_nearest');
    assert.ok(tool, 'Tool find_and_collect_nearest must be registered');
    return tool;
}

test('find_and_collect_nearest conforms to Gemini-compatible JSON schema', () => {
    const b = createMockBot();
    const tool = getTool(b);

    assert.equal(tool.name, 'find_and_collect_nearest');
    assert.equal(tool.parameters.type, 'object');
    assert.equal(tool.parameters.additionalProperties, false);
    assert.deepEqual(tool.parameters.required, ['block']);
    assert.equal(tool.parameters.properties.block.type, 'string');
    assert.equal(tool.parameters.properties.max_distance.type, 'integer');
    assert.equal(tool.parameters.properties.timeout_ms.type, 'integer');
});

test('find_and_collect_nearest executes successfully and records actions', async () => {
    const b = createMockBot();
    const tool = getTool(b);

    const res = await tool.execute('call-1', { block: 'oak_log' });
    assert.equal(res.isError, undefined, JSON.stringify(res));

    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.completed, true);
    assert.deepEqual(payload.result, {
        collected: true,
        block: 'oak_log',
        position: { x: 1, y: 64, z: 1 },
    });
    assert.ok(b.calls.includes('dig'));
});

test('find_and_collect_nearest fails with not_found when block does not exist', async () => {
    const b = createMockBot();
    const tool = getTool(b, { getNearestBlocks: () => [] });

    const res = await tool.execute('call-2', { block: 'diamond_ore' });
    assert.equal(res.isError, true);
    assert.equal(failureCode(res), 'not_found');
    assert.match(res.content[0].text, /No diamond_ore found/);
});

test('find_and_collect_nearest fails with missing_item when tool cannot harvest', async () => {
    const b = createMockBot({
        canDigBlock: () => false,
    });
    const tool = getTool(b);

    const res = await tool.execute('call-3', { block: 'oak_log' });
    assert.equal(res.isError, true);
    assert.equal(failureCode(res), 'missing_item');
    assert.match(res.content[0].text, /Missing required tool/);
});

test('find_and_collect_nearest fails with no_path when navigation fails', async () => {
    const b = createMockBot({
        pathfinder: {
            setMovements: () => {},
            setGoal: () => {},
            stop: () => {},
            goto: async () => {
                throw new Error('No route found');
            },
        },
    });
    const tool = getTool(b, {
        getNearestBlocks: () => [{ name: 'oak_log', position: vector(15, 64, 15) }],
    });

    const res = await tool.execute('call-4', { block: 'oak_log' });
    assert.equal(res.isError, true);
    assert.equal(failureCode(res), 'no_path');
    assert.match(res.content[0].text, /Cannot navigate to nearest oak_log/);
});

test('find_and_collect_nearest fails with out_of_reach when block remains too far', async () => {
    const b = createMockBot({
        pathfinder: {
            setMovements: () => {},
            setGoal: () => {},
            stop: () => {},
            goto: async () => {},
        },
    });
    const tool = getTool(b, {
        getNearestBlocks: () => [{ name: 'oak_log', position: vector(20, 64, 20) }],
    });

    const res = await tool.execute('call-5', { block: 'oak_log' });
    assert.equal(res.isError, true);
    assert.equal(failureCode(res), 'out_of_reach');
});

test('find_and_collect_nearest aborts cleanly when pre-aborted signal is given', async () => {
    const b = createMockBot();
    const tool = getTool(b);
    const ac = new AbortController();
    ac.abort();

    const res = await tool.execute('call-6', { block: 'oak_log' }, ac.signal);
    assert.equal(res.isError, true);
    assert.equal(failureCode(res), 'cancellation');
    assert.equal(b.calls.length, 0);
});

test('find_and_collect_nearest stops pathfinder and digging on mid-flight abort', async () => {
    const ac = new AbortController();
    const b = createMockBot({
        targetDigBlock: true,
        dig: async () => {
            await new Promise(r => setTimeout(r, 200));
        },
    });
    const tool = getTool(b);

    const pending = tool.execute('call-7', { block: 'oak_log' }, ac.signal);
    await new Promise(r => setTimeout(r, 50));
    ac.abort();
    const res = await pending;

    assert.equal(res.isError, true);
    assert.equal(failureCode(res), 'cancellation');
    assert.ok(b.calls.includes('pathfinderStop'));
    assert.ok(b.calls.includes('stopDigging'));
});
