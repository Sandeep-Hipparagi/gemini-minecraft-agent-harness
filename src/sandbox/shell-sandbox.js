import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets');
export const cap = (text, max) => (Buffer.byteLength(text) > max ? `${text.slice(0, max)}\n…[truncated]` : text);

export function startPoller({ relayUrl, token, invoke, log, onDead }) {
    const controller = new AbortController();
    void (async () => {
        let backoff = 500,
            streak = 0;
        while (!controller.signal.aborted) {
            try {
                const r = await fetch(`${relayUrl}/next`, {
                    headers: { 'x-token': token },
                    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
                });
                if (r.status === 204) {
                    backoff = 500;
                    streak = 0;
                    continue;
                }
                if (!r.ok) throw new Error(`relay ${r.status}`);
                backoff = 500;
                streak = 0;
                const job = await r.json();
                let out;
                try {
                    out = { id: job.id, ok: true, result: await invoke(job.name, job.args ?? {}) };
                } catch (e) {
                    out = { id: job.id, ok: false, error: String(e?.message ?? e).slice(0, 4000) };
                }
                await fetch(`${relayUrl}/result`, {
                    method: 'POST',
                    headers: { 'x-token': token, 'content-type': 'application/json' },
                    body: JSON.stringify(out),
                    signal: AbortSignal.timeout(10000),
                });
            } catch (e) {
                if (controller.signal.aborted) break;
                log?.(`relay poll error: ${String(e?.message ?? e)}`);
                if (++streak >= 3 && onDead) {
                    streak = 0;
                    try {
                        await onDead();
                        if (controller.signal.aborted) break;
                        log?.('relay restarted');
                        backoff = 500;
                        continue;
                    } catch (e2) {
                        log?.(`relay restart failed: ${String(e2?.message ?? e2)}`);
                    }
                }
                await new Promise(r => setTimeout(r, backoff));
                backoff = Math.min(backoff * 2, 10000);
            }
        }
    })();
    return () => controller.abort();
}

export async function waitHealthy(relayUrl, ms = 15000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        try {
            const r = await fetch(`${relayUrl}/health`, { signal: AbortSignal.timeout(2000) });
            if (r.ok) return;
        } catch {}
        await new Promise(r => setTimeout(r, 250));
    }
    throw new Error('relay did not become healthy');
}

export function createLocalBackend({ workdir, sharedDir }) {
    let relay, token, relayUrl, stopPoll, home;
    return {
        kind: 'local',
        async start({ invoke, tools, log }) {
            token = crypto.randomBytes(16).toString('hex');
            home = workdir;
            await fs.mkdir(path.join(home, 'bin'), { recursive: true });
            const opt = path.join(home, '.harness');
            await fs.mkdir(opt, { recursive: true });
            await fs.copyFile(path.join(ASSETS, 'relay.cjs'), path.join(opt, 'relay.cjs'));
            await fs.writeFile(path.join(opt, 'tools.json'), JSON.stringify(tools));
            const toolCli = (await fs.readFile(path.join(ASSETS, 'tool'), 'utf8')).replaceAll(
                '/opt/harness/tools.json',
                path.join(opt, 'tools.json'),
            );
            await fs.writeFile(path.join(home, 'bin', 'tool'), toolCli, { mode: 0o755 });
            const port = 20000 + Math.floor(Math.random() * 20000);
            relay = spawn(process.execPath, [path.join(opt, 'relay.cjs'), String(port), token], { stdio: 'ignore' });
            relayUrl = `http://127.0.0.1:${port}`;
            await waitHealthy(relayUrl);
            stopPoll = startPoller({ relayUrl, token, invoke, log });
        },
        env() {
            return {
                HOME: home,
                PATH: `${path.join(home, 'bin')}:${sharedDir ? path.join(sharedDir, 'tools') + ':' : ''}${process.env.PATH}`,
                TOOL_API_TOKEN: token,
                TOOL_RELAY_URL: relayUrl,
                SHARED_TOOLS: sharedDir ? path.join(sharedDir, 'tools') : '',
            };
        },
        run(cmd, { timeoutMs, signal, outputBytes }) {
            return new Promise(resolve => {
                const env = this.env();
                const child = spawn('bash', ['-lc', `export PATH=${JSON.stringify(env.PATH)}; ${cmd}`], {
                    cwd: home,
                    env,
                    stdio: ['ignore', 'pipe', 'pipe'],
                });
                let stdout = '',
                    stderr = '',
                    timedOut = false;
                child.stdout.on('data', d => {
                    stdout += d;
                });
                child.stderr.on('data', d => {
                    stderr += d;
                });
                const timer = setTimeout(() => {
                    timedOut = true;
                    child.kill('SIGKILL');
                }, timeoutMs);
                const onAbort = () => child.kill('SIGKILL');
                signal?.addEventListener('abort', onAbort, { once: true });
                child.on('close', code => {
                    clearTimeout(timer);
                    signal?.removeEventListener('abort', onAbort);
                    resolve({
                        exitCode: timedOut ? 124 : (code ?? -1),
                        timedOut,
                        stdout: cap(stdout, outputBytes),
                        stderr: cap(stderr, outputBytes),
                    });
                });
            });
        },
        async writeFile(rel, content) {
            const p = path.join(home, rel);
            await fs.mkdir(path.dirname(p), { recursive: true });
            await fs.writeFile(p, content);
        },
        close() {
            stopPoll?.();
            relay?.kill('SIGKILL');
            return Promise.resolve();
        },
    };
}
