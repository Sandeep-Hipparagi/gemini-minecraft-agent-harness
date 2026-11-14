# Running a team

```sh
npx minecraft-agent team examples/team.json
```

A team needs at least two agents. A team file has shared defaults at the top level and one entry per agent. Any option from
[configuration.md](configuration.md) can appear at either level; per-agent values win.

```json
{
  "host": "localhost",
  "port": 25565,
  "model": "google/gemini-2.5-flash",
  "objective": "Build a small shelter near spawn and establish a resource stockpile.",
  "sharedMachine": "local",
  "agents": [
    { "name": "ArchitectPro", "model": "google/gemini-2.5-pro", "thinking": "high" },
    { "name": "GathererFlash", "thinking": "low" },
    { "name": "BuilderFlash", "thinking": "low" }
  ]
}
```

What changes in team mode:

- Every agent knows the others' names and gets `directory` and `directory_search`.
- Agents message each other with `send_dm` and `read_dms`. Unread counts show up in every observation.
- `shared_exec` runs commands on one machine shared by the whole team. Its working directory (`<state-dir>/shared-machine` locally) has `plans/`, `notes/` and `tools/`, and every command is appended to `log` with its author.
- Public chat and the noticeboard are turned off so coordination goes through DMs and the shared machine.

`sharedMachine` can be:

| Value   | Machine                                                                              |
| ------- | ------------------------------------------------------------------------------------ |
| `local` | a directory under the state dir on the host, commands run with `bash` (not isolated) |
| `none`  | no `shared_exec`                                                                     |

Each agent still gets its own private sandbox according to `sandbox`. Agents start a few seconds apart
(`staggerSeconds`, default 3). `Ctrl+C` stops all of them.

See `examples/team.json` (asymmetric Pro coordinator + Flash workers) and `examples/team-flash.json` (all-Flash team) for working configurations.
