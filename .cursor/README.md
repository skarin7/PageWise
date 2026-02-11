# Cursor agents and rules

## Where is `master_plan.md`?

It lives at **`docs/master_plan.md`**. The lead-architect rule refers to this file for context and updates (e.g. `/plan`).

## Sub-agents vs skills

| Concept | Where | What |
|--------|--------|------|
| **Sub-agents** | `.cursor/agents/` | **Roles** (Backend, Frontend, QA). Identity + rules: “You are a Senior Backend Developer…”. The Lead assigns work to these roles. |
| **Skills** | `.cursor/skills/` | **Reusable tasks** (e.g. deploy, connect to GitHub, run CI). Any sub-agent uses a skill when the task needs that capability. |

So: Backend is a **sub-agent** (a role). “Deploy to production” or “connect to GitHub” are **skills** (tasks). The Backend agent might *use* the deploy skill when the user asks for a release.

## Sub-agents (`.cursor/agents/`)

- **backend.mdc** – Core, utils, APIs, server.
- **frontend.mdc** – Extension UI (popup, sidebar, options).
- **qa.mdc** – Tests, coverage, Vitest.

The Lead Architect assigns work to one of these roles and applies that agent’s rules.

## Skills (`.cursor/skills/`)

Add task-oriented skills here (e.g. `deploy/SKILL.md`, `connect-github/SKILL.md`). See `.cursor/skills/README.md` for how to add one. When a sub-agent’s task requires that task, the agent applies the skill.

## Orchestration

You do **not** need to @mention each role. The Lead decides who does what, acts as that sub-agent, and has that agent use skills from `.cursor/skills/` when the task requires it.
