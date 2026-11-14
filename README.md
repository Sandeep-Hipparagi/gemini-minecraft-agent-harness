<h1 align="center">gemini-minecraft-agent-harness</h1>

<p align="center">Autonomous Google Gemini agents that play Minecraft.</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="Node.js 22.19+" src="https://img.shields.io/badge/node-%E2%89%A522.19-339933?logo=node.js&logoColor=white">
  <img alt="Minecraft Java 1.21.6" src="https://img.shields.io/badge/minecraft-java%201.21.6-62B47A">
  <img alt="Google Gemini" src="https://img.shields.io/badge/model-Google%20Gemini-4285F4?logo=google&logoColor=white">
</p>

<p align="center">
  <img src="docs/images/hero.jpg" alt="Agents fishing together at a shoreline camp, gathering around a farm, and holding a bridge in Bed Wars" width="100%">
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> ·
  <a href="docs/configuration.md">Configuration</a> ·
  <a href="docs/tools.md">Tools</a> ·
  <a href="docs/multi-agent.md">Teams</a> ·
  <a href="#telemetry--benchmarking">Benchmarking</a> ·
  <a href="examples/bedwars/README.md">Bed Wars</a>
</p>

**gemini-minecraft-agent-harness** runs autonomous AI agents powered natively by Google Gemini (`gemini-2.5-flash` and `gemini-2.5-pro`) on Minecraft Java Edition servers. Agents interact through [Mineflayer](https://github.com/PrismarineJS/mineflayer) and manage persistent reasoning sessions using [@earendil-works/pi-coding-agent](https://github.com/earendil-works/pi).

### Key Features

- **Native Google Gemini**: Built for `google/gemini-2.5-flash` (low-latency execution) and `google/gemini-2.5-pro` (high-reasoning coordination), with configurable thinking budgets.
- **Robust Action Runner**: Every Mineflayer body tool observes an `AbortSignal`, guarantees clean world-action drain before settling, and emits structured `withFailureCode` classifications.
- **Persistent Sessions**: Sessions survive restarts. Stopping an agent and re-launching under the same name immediately restores state, notes, and context from `.agent-state/<name>/`.
- **Integrated Tool Shell**: Each agent gets a persistent sandbox (Docker or local workspace) equipped with an HTTP tool relay so agents can script complex loops using `tool <name> '<json>'`.
- **Multi-Agent Teams**: Coordinate asymmetric crews from a single JSON configuration with direct-message mailboxes, shared blueprints, and non-blocking directory lookups.
- **Built-In Benchmarking Suite**: Automated telemetry streaming, timed benchmark runners, and side-by-side A/B diff tooling (`npm run telemetry`, `npm run benchmark`, `npm run compare`).

---

## Quickstart

### Prerequisites

- Node.js 22.19 or newer
- Java 21 (for the bundled Paper development server)
- A Google Gemini API key ([Google AI Studio](https://aistudio.google.com/))

### 1. Setup & Environment

```sh
npm ci
cp .env.example .env
```

Add your Gemini API key to `.env`:

```env
GEMINI_API_KEY=your_gemini_api_key_here
```

### 2. Start the Local Server

Launch the preconfigured local PaperMC development server (sets `spawn-protection=0`, `online-mode=false`, and multi-agent memory limits):

```sh
npm run server
```

### 3. Run an Agent

In a separate terminal, launch an agent:

```sh
npm start -- --objective "Gather wood, craft basic tools, and build a shelter near spawn"
```

The agent connects, explores the spawn area, and streams its thoughts and tool calls to your console. Press `Ctrl+C` to gracefully pause execution.

---

## Multi-Agent Teams

Coordinate multiple Gemini agents working toward shared objectives:

```sh
# Launch the asymmetric Pro coordinator + Flash workers crew
npm run team -- --team examples/team.json

# Launch the homogeneous All-Flash crew
npm run team -- --team examples/team-flash.json
```

- **Coordinator** (`ArchitectPro`): Runs `gemini-2.5-pro` with `"thinking": "high"`, surveying the world, writing plans to the shared workspace, and dispatching tasks over DMs.
- **Workers** (`GathererFlash`, `BuilderFlash`): Run `gemini-2.5-flash` with `"thinking": "low"` for rapid harvesting and construction.

---

## Telemetry & Benchmarking

The harness includes zero-dependency tools for telemetry analysis, automated benchmark runs, and A/B performance comparison.

### Telemetry Summary

Stream `.agent-state/<name>/telemetry.jsonl` into console tables and export JSON reports:

```sh
# Single-agent summary
npm run telemetry -- GeminiBot --out reports/single.json

# Cross-agent team summary
npm run telemetry -- gemini-crew --out reports/team.json
```

### Timed Multi-Agent Benchmarks

Execute fixed-duration multi-agent runs that terminate cleanly and persist results:

```sh
# Run a 3-minute benchmark starting from a clean state
npm run benchmark -- --team examples/team.json --duration 180 --clean --out benchmarks/pro-flash.json
npm run benchmark -- --team examples/team-flash.json --duration 180 --clean --out benchmarks/all-flash.json
```

### A/B Comparison Diff

Compare two benchmark JSON reports to see side-by-side deltas in calls, success rates, latencies, and failure codes:

```sh
npm run compare -- benchmarks/pro-flash.json benchmarks/all-flash.json --out benchmarks/diff.json
```

---

## World-Action Tools

In addition to standard navigation and placement tools, the harness provides optimized compound actions such as `find_and_collect_nearest`:

- **Single-Step Harvesting**: Locates the nearest target block, computes reachable pathing, harvests with the optimal tool, and collects item drops.
- **Structured Failure Codes**: Yields actionable, machine-readable failure reasons (`not_found`, `no_path`, `missing_item`, `cancelled`).
- **Prompt Guidance**: The Gemini system prompt guides agents to prioritize compound tools for efficient resource gathering.

See [docs/tools.md](docs/tools.md) for the full tool reference.

---

## Development & Testing

```sh
npm run lint          # ESLint checks
npm run format:check  # Prettier formatting verification
npm test              # node:test test suite
npm run check         # Full verification gate (lint + format:check + test)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines and coding standards.

---

## Author & License

Maintained by **Sandeep Hipparagi**.

Licensed under the [MIT License](LICENSE). Third-party notices and upstream dependencies are documented in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
