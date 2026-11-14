# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-14

### Overview

**gemini-minecraft-agent-harness** is a standalone, Google Gemini-native autonomous Minecraft agent harness built on [Mineflayer](https://github.com/PrismarineJS/mineflayer) and [@earendil-works/pi-coding-agent](https://github.com/earendil-works/pi). It enables single-agent survival objectives, multi-agent crew orchestration, and quantitative A/B benchmarking across Gemini models (`gemini-2.5-flash` and `gemini-2.5-pro`) with zero external service dependencies.

---

### What's New & Changed

#### Gemini-Native Runtime

- **Standardized Model Provider**: Exclusively supports native Google Gemini models (`google/gemini-2.5-flash` as default and `google/gemini-2.5-pro` for complex reasoning) via `GEMINI_API_KEY`.
- **Configurable Thinking Budgets**: Added `--thinking` support (`low`, `medium`, `high`) directly controlling extended thinking token budgets.
- **Dependency & Surface Pruning**: Stripped legacy multi-provider endpoint routing, cloud VM sandboxing (`e2b`), and headless GL canvas bindings (`prismarine-viewer`), reducing attack surface, memory footprint, and native build failures.

#### Custom World-Action Tool: `find_and_collect_nearest`

- **Single-Step Harvesting**: Combines target search, line-of-sight reachability, automatic tool selection, block mining, and item drop collection into a single compound action.
- **Strict Concurrency & Cancellation**: Adheres to the harness action runner mutex and `AbortSignal` contract; aborting cleans up pathfinding and digging listeners immediately (`pathfinder.stop()`, `stopDigging()`) before settling.
- **Canonical Failure Classification**: Returns structured results wrapped in `withFailureCode` (`not_found`, `missing_item`, `no_path`, `out_of_reach`, `cancelled`).
- **Prompt Guidance**: System prompt instructs Gemini agents to favor `find_and_collect_nearest` over manual sequential `move_to` + `dig` loops for resource gathering.

#### Multi-Agent Crew Orchestration

- **Asymmetric Pro + Flash Preset (`examples/team.json`)**: Splits coordination from physical execution:
  - `ArchitectPro`: `gemini-2.5-pro` with `"thinking": "high"` surveys the spawn area, writes architectural blueprints to the shared workspace, and assigns tasks via DMs.
  - `GathererFlash`: `gemini-2.5-flash` with `"thinking": "low"` harvests required building materials using `find_and_collect_nearest`.
  - `BuilderFlash`: `gemini-2.5-flash` with `"thinking": "low"` clears building footprints and constructs shelters.
- **All-Flash Benchmark Baseline (`examples/team-flash.json`)**: Mirrors the crew configuration with all agents on `gemini-2.5-flash` for isolated A/B model tier evaluation.
- **Shared Coordination**: Team agents communicate via an asynchronous SQLite mailbox (`.agent-state/<team>/shared/mailbox.sqlite`) and share a persistent disk workspace.

#### Observability & Benchmarking Suite

- **Telemetry Streaming CLI (`npm run telemetry`)**: Zero-dependency stream parser that reads `.agent-state/<target>/telemetry.jsonl` into formatted `console.table()` summaries with call counts, success rates, average latencies, and failure code breakdowns. Supports team directory auto-discovery.
- **Timed Benchmark Runner (`npm run benchmark`)**: Executes fixed-duration multi-agent sessions, terminates child process trees cleanly on timeout or signals, and outputs post-run summaries.
- **Side-by-Side Diff CLI (`npm run compare`)**: Compares two benchmark JSON reports, rendering delta tables for overall metrics, per-tool distributions, failure code shifts, and matching per-agent metrics.
- **JSON Report Persistence**: Added `--out <filepath>` export across all CLI tools for offline analysis and continuous integration.

#### Tuned Local PaperMC Server (`npm run server`)

- **Spawn Protection Disabled**: Enforces `spawn-protection=0` and `online-mode=false` in `server.properties` so agents can mine and construct immediately at spawn without permission blocks.
- **Multi-Agent Simulation Defaults**: Applies lightweight server defaults (`view-distance=6`, `simulation-distance=4`, `allow-flight=true`, `pause-when-empty-seconds=0`, `network-compression-threshold=512`).
- **Bounded JVM Heap**: Configures PaperMC spawn arguments to `-Xms2G -Xmx3G` for smooth concurrent 3-agent execution on 16GB host machines.

---

### Quickstart Commands

#### 1. Setup Environment

```sh
npm ci
cp .env.example .env
# Set GEMINI_API_KEY=your_key_here in .env
```

#### 2. Start Local PaperMC Server

```sh
npm run server
```

#### 3. Run Single Agent

```sh
npm start -- --objective "Gather wood and build a shelter near spawn"
```

#### 4. Run Multi-Agent A/B Benchmark & Compare

```sh
# Run 3-minute benchmark on Asymmetric Pro + Flash crew
npm run benchmark -- --team examples/team.json --duration 180 --clean --out benchmarks/pro-flash.json

# Run 3-minute benchmark on All-Flash crew
npm run benchmark -- --team examples/team-flash.json --duration 180 --clean --out benchmarks/all-flash.json

# Compare side-by-side performance deltas
npm run compare -- benchmarks/pro-flash.json benchmarks/all-flash.json --out benchmarks/ab-diff.json
```

---

### Verification Metrics

- **Unit & Integration Tests**: 308 tests total (306 passed, 2 skipped Linux sandbox descriptors) via `node:test`.
- **Formatting & Style**: 100% Prettier verified (`npm run format:check`).
- **Static Analysis**: 0 errors, 0 warnings (`npm run lint`).
- **Continuous Integration**: GitHub Actions CI passing on `ubuntu-latest` with Node.js 22 LTS ([Run 43630762399](https://github.com/Sandeep-Hipparagi/gemini-minecraft-agent-harness/actions/runs/43630762399)).
