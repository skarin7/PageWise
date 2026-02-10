# Cursor agents and rules

## Where is `master_plan.md`?

It lives at **`docs/master_plan.md`**. The `docs/` folder and file were missing; they are now created. The lead-architect rule refers to this file for context and updates (e.g. `/plan`).

## Why don’t “other agents” get triggered?

Cursor does **not** run separate AI instances per agent. Here’s how things actually work:

1. **Rules (`.cursor/rules/`)**
   - **Lead architect** (`lead-architect-workflow.mdc`) has `alwaysApply: true`, so it is **always** in context. It tells the single model to “orchestrate” and “assign” work to backend/frontend/QA.

2. **Agents (`.cursor/agents/`)**
   - **backend**, **frontend**, and **qa** all have **`alwaysApply: true`**, so their instructions are always in context.
   - The **Lead Architect** orchestrates them: it assigns work to the right persona and behaves as that agent (backend/frontend/QA) without the user having to @mention anyone.
   - **How to know all agents are used:** The lead rule (`.cursor/rules/lead-architect-workflow.mdc`) contains a **Sub-Agents** table that explicitly lists every agent file. The lead is instructed to apply each when acting as that role. If you add a new agent (e.g. `docs.mdc`), add a row to that table so the Lead uses it.

3. **Orchestration**
   - You do **not** need to mention each agent. The Lead Architect decides who handles each part of a task and acts as that agent, then runs QA before marking work done.
