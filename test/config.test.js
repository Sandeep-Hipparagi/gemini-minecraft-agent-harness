import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSandbox, resolveConfig, parseModelRef } from '../src/config.js';

test('default sandbox prefers docker when available, then local', () => {
    assert.equal(
        defaultSandbox({}, () => true),
        'docker',
    );
    assert.equal(
        defaultSandbox({}, () => false),
        'local',
    );
});

test('explicit sandbox and docker settings flow into the resolved config', () => {
    const config = resolveConfig([{ objective: 'x', sandbox: 'docker', dockerImage: 'img:1', dockerMemory: '4g' }], {
        env: {},
        probeDocker: () => false,
    });
    assert.equal(config.sandbox.kind, 'docker');
    assert.equal(config.sandbox.image, 'img:1');
    assert.equal(config.sandbox.memory, '4g');
});

test('unknown sandbox kinds are rejected', () => {
    assert.throws(
        () => resolveConfig([{ objective: 'x', sandbox: 'vm' }], { env: {}, probeDocker: () => false }),
        /sandbox must be one of none, local, docker/,
    );
});

test('Gemini model names are parsed with google provider defaulted', () => {
    assert.deepEqual(parseModelRef('gemini-2.5-flash'), { provider: 'google', id: 'gemini-2.5-flash' });
    assert.deepEqual(parseModelRef('google/gemini-2.5-pro'), { provider: 'google', id: 'gemini-2.5-pro' });
});

test('non-Gemini model providers are rejected', () => {
    assert.throws(
        () => resolveConfig([{ objective: 'x', model: 'openai/gpt-4o' }], { env: {}, probeDocker: () => false }),
        /Only Google Gemini models are supported/,
    );
});
