# Cortex setup for the Raseen prototype code

[Claude-Cortex](https://github.com/NickCrew/Claude-Cortex) v4.7.0 — multi-model dev orchestration
(agents, skills, rules, hooks) that plugs into Claude Code. Installed and verified in a Cowork
session on 14 Sep 2026.

## Why it's a doc and not an install

A claude.ai Project stores documents, not software. Cortex lives on whichever machine the session
runs on — the ephemeral cloud container, or a laptop. So "connecting it to the project" means this
file: any future session in this project runs the block below and gets the same 28 agents,
140 skills and 5 rules.

## Bootstrap (cloud session — paste to Claude, or run as-is)

```bash
# 1. CLI from PyPI
pipx install claude-cortex        # or: pip install claude-cortex --break-system-packages
export PATH="$HOME/.local/bin:$PATH"

# 2. Bundled content — the PyPI wheel ships ONLY the Python CLI.
#    `cortex install link` fails with "No content directories found" without this step.
mkdir -p "$HOME/.claude/plugins"
git clone --depth 1 https://github.com/NickCrew/Claude-Cortex.git \
  "$HOME/.claude/plugins/claude-cortex"

# 3. Link agents/skills/rules/schemas into ~/.claude
cortex install link
cortex status                     # expect: OPTIMAL
```

Expected result:

```
agents/    28 linked
skills/   140 linked
rules/      5 linked
schemas/    5 linked
settings    5 copied
commands/  41 symlinks from skills
```

## Gotchas

- The wheel has no `agents/` `skills/` `rules/`. `cortex install link` resolves content by walking
  parents of the installed package for a dir holding all three, then falls back to
  `~/.claude/plugins/claude-cortex`. Cloning to that path is what makes it work.
- Homebrew (`brew tap NickCrew/cortex && brew install cortex`) does the symlinking in
  `post_install` and needs none of step 2 — macOS only.
- Cloud containers are reclaimed when the session ends, so step 1–3 repeat each time. On a laptop
  it's a one-off.
- Cortex's own workflow assumes Codex and/or Gemini CLIs are on PATH for cross-model review. With
  only Claude present the review loops fall back to fresh-context same-model review.

## Cortex skills relevant to Raseen

The simulation and any prototype code (`raseen_bgc_sim.py`, the BGC control loop, the twin) can use:

- `agent-loops` — implement → independent review → remediate → re-review, with test and lint gates
- `test-review` — coverage and test-quality audit, useful for the physics assertions in the sim
- `python-testing-patterns`, `python-performance-optimization` — pytest structure, profiling
- `systematic-debugging`, `root-cause-tracing` — when simulated results contradict the physics
- `doc-claim-validator` — checks claims in a doc against the actual code; worth running over the
  v4 team document before the KAPSARC camp, since the pitch cites simulated numbers
- `constructive-dissent` — produced `raseen-v4-dissent.md`; re-run it on v4.1 after F3–F5 are done
- `chart-builder`, `mermaid-diagramming` — figures for the idea file and jury deck
