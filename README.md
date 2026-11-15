<h1 align="center">gemini-minecraft-agent-harness</h1>

<p align="center">Autonomous Google Gemini agents that play Minecraft.</p>

<p align="center">
  <a href="https://github.com/Sandeep-Hipparagi/gemini-minecraft-agent-harness/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Sandeep-Hipparagi/gemini-minecraft-agent-harness/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://github.com/Sandeep-Hipparagi/gemini-minecraft-agent-harness/releases"><img alt="Release" src="https://img.shields.io/github/v/release/Sandeep-Hipparagi/gemini-minecraft-agent-harness"></a>
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

### 1. Clone & Setup

```sh
git clone --branch v0.1.0 https://github.com/Sandeep-Hipparagi/gemini-minecraft-agent-harness.git
cd gemini-minecraft-agent-harness
npm ci
cp .env.example .env
```

Add your Gemini API key to `.env`:

```env
GEMINI_API_KEY=your_gemini_api_key_here
```

### 2. Start the Local Server

Launch the preconfigured local PaperMC development server (`spawn-protection=0`, `online-mode=false`, and bounded memory):

```sh
npm run server
```

### 3. Run a Single Agent

In a separate terminal, launch a Gemini agent:

```sh
npm start -- --objective "Gather wood, craft basic tools, and build a shelter near spawn"
```

The agent connects to the server, explores the spawn area, and streams its thoughts and tool calls to your console. Press `Ctrl+C` to gracefully pause execution.

### 4. Run a Multi-Agent Team

Launch the asymmetric Pro coordinator + Flash workers crew:

```sh
npm run team -- --team examples/team.json
```

Or launch the homogeneous all-Flash crew:

```sh
npm run team -- --team examples/team-flash.json
```

### 5. Run a Timed A/B Benchmark & Compare

Execute fixed-duration benchmark runs and compare side-by-side performance:

```sh
npm run benchmark -- --team examples/team.json --duration 180 --clean --out benchmarks/pro-flash.json
npm run benchmark -- --team examples/team-flash.json --duration 180 --clean --out benchmarks/all-flash.json
npm run compare -- benchmarks/pro-flash.json benchmarks/all-flash.json --out benchmarks/diff.json
```

---

## Telemetry & Benchmarking

The harness includes zero-dependency tools for telemetry analysis, automated benchmark runs, and A/B performance comparison.

### Telemetry Summary

Stream `.agent-state/<name>/telemetry.jsonl` into console tables and export JSON reports:

Single-agent summary:

```sh
npm run telemetry -- GeminiBot --out reports/single.json
```

Cross-agent team summary:

```sh
npm run telemetry -- gemini-crew --out reports/team.json
```

### Timed Multi-Agent Benchmarks

Execute fixed-duration multi-agent runs that terminate cleanly and persist results:

```sh
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

Run the test and verification suite:

```sh
npm run lint
npm run format:check
npm test
npm run check
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines and coding standards.

---

## Author & License

Maintained by **Sandeep Hipparagi**.

Licensed under the [MIT License](LICENSE). Third-party notices and upstream dependencies are documented in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
