# Skills (reusable tasks)

**Skills** are reusable, task-oriented capabilities—like “connect to GitHub”, “deploy to production”, “run the test suite in CI”—not roles or personas.

- **Sub-agents** (Backend, Frontend, QA) = roles defined in `.cursor/agents/`. They have identity and rules (e.g. “you are a Senior Backend Developer”).
- **Skills** = tasks any sub-agent (or the Lead) can **use** when the work requires that capability. Cursor loads them by name/description when relevant.

## How a sub-agent uses a skill

When the Backend agent’s task involves “deploy to production”, the Backend agent applies the **deploy** skill from `.cursor/skills/deploy/`. When the task involves opening a PR or talking to GitHub, the agent applies the **GitHub** skill. Same for Frontend or QA: whoever is doing the work uses the skill that matches the task.

## Adding a skill

1. Create a folder: `.cursor/skills/<task-name>/`
2. Add `SKILL.md` with YAML frontmatter:
   - `name`: short id (e.g. `deploy`, `connect-github`)
   - `description`: when to use it (e.g. “Use when deploying to production or running a release.”)
3. In the body, write step-by-step instructions for that task.

Example skills you might add: `deploy`, `connect-github`, `run-ci`, `release`.
