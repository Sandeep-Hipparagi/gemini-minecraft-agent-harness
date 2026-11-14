import { abortError, failWith } from './failures.js';
import { untilAbort } from './runtime.js';
import { integer, name } from './schema.js';

export function createCollectNearest(ctx) {
    const { add, body, pathfinderModule, pickupDrops, withDeadline, world } = ctx;

    add(
        'find_and_collect_nearest',
        'Find the nearest block of a given type within range, navigate to it, mine it with the appropriate tool, and collect the resulting item drops.',
        {
            block: name,
            max_distance: integer(1, 64),
        },
        async (args, { bot: active, signal }) => {
            if (signal?.aborted) throw signal.reason ?? abortError('Tool cancelled');

            const onAbort = () => {
                try {
                    active.pathfinder?.setGoal?.(null);
                    active.pathfinder?.stop?.();
                } catch {}
                try {
                    if (active.targetDigBlock) active.stopDigging?.();
                } catch {}
            };
            signal?.addEventListener('abort', onAbort, { once: true });

            try {
                const range = args.max_distance ?? 32;
                let target = null;
                if (world && typeof world.getNearestBlocks === 'function') {
                    target = world.getNearestBlocks(active, [args.block], range, 1)[0] ?? null;
                } else if (typeof active.findBlock === 'function') {
                    target = active.findBlock({
                        matching: b => b?.name === args.block,
                        maxDistance: range,
                    });
                }

                if (!target) {
                    throw failWith('not_found', `No ${args.block} found within ${range} blocks.`, {
                        block: args.block,
                        max_distance: range,
                    });
                }

                if (typeof active.canDigBlock === 'function' && !active.canDigBlock(target)) {
                    throw failWith('missing_item', `Missing required tool to harvest ${args.block}.`, {
                        block: args.block,
                    });
                }

                const dist = active.entity?.position ? active.entity.position.distanceTo(target.position) : Infinity;

                let goals = null;
                if (typeof pathfinderModule === 'function') {
                    const pf = await pathfinderModule();
                    goals = pf.goals;
                    if (dist > 4.5 && active.pathfinder?.setMovements && pf.Movements) {
                        try {
                            active.pathfinder.setMovements(new pf.Movements(active));
                        } catch {}
                    }
                }

                if (dist > 4.5 && active.pathfinder?.goto && goals?.GoalLookAtBlock) {
                    try {
                        const goal = new goals.GoalLookAtBlock(target.position, active.world, { reach: 4.5 });
                        if (typeof withDeadline === 'function') {
                            await withDeadline(active, active.pathfinder.goto(goal), 40000);
                        } else {
                            await untilAbort(active.pathfinder.goto(goal), signal);
                        }
                    } catch (err) {
                        if (signal?.aborted) throw signal.reason ?? abortError('Tool cancelled');
                        throw failWith(
                            'no_path',
                            `Cannot navigate to nearest ${args.block} at ${target.position.x},${target.position.y},${target.position.z}: ${err?.message ?? err}`,
                            {
                                target: { x: target.position.x, y: target.position.y, z: target.position.z },
                            },
                        );
                    }
                }

                const finalDist = active.entity?.position ? active.entity.position.distanceTo(target.position) : 0;
                if (finalDist > 6) {
                    throw failWith(
                        'out_of_reach',
                        `The ${args.block} at ${target.position.x},${target.position.y},${target.position.z} is out of reach.`,
                        {
                            target: { x: target.position.x, y: target.position.y, z: target.position.z },
                        },
                    );
                }

                const currentBlock = active.blockAt ? active.blockAt(target.position) : target;
                if (!currentBlock || currentBlock.name !== args.block) {
                    throw failWith(
                        'not_found',
                        `The ${args.block} at ${target.position.x},${target.position.y},${target.position.z} is no longer present.`,
                        {
                            target: { x: target.position.x, y: target.position.y, z: target.position.z },
                        },
                    );
                }

                if (typeof active.pathfinder?.bestHarvestTool === 'function') {
                    try {
                        const harvestTool = active.pathfinder.bestHarvestTool(currentBlock);
                        if (harvestTool && active.equip) {
                            await active.equip(harvestTool, 'hand');
                        }
                    } catch {}
                }

                if (signal?.aborted) throw signal.reason ?? abortError('Tool cancelled');

                try {
                    if (active.dig) {
                        await untilAbort(active.dig(currentBlock), signal);
                    }
                } catch (err) {
                    if (signal?.aborted) throw signal.reason ?? abortError('Tool cancelled');
                    throw failWith('action_failed', `Failed to dig ${args.block}: ${err?.message ?? err}`, {
                        target: { x: target.position.x, y: target.position.y, z: target.position.z },
                    });
                }

                if (typeof pickupDrops === 'function' && goals) {
                    try {
                        await pickupDrops(active, target.position, goals, signal, { radius: 4, ms: 3000 });
                    } catch {}
                }

                return {
                    collected: true,
                    block: args.block,
                    position: { x: target.position.x, y: target.position.y, z: target.position.z },
                };
            } finally {
                signal?.removeEventListener('abort', onAbort);
            }
        },
        { ...body, required: ['block'] },
    );

    return {};
}
