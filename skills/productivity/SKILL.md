---
name: Productivity
slug: productivity
version: 1.0.4
homepage: https://clawic.com/skills/productivity
description: "Plan, focus, and complete work with energy management, time blocking, goals, projects, tasks, habits, reviews, priorities, and context-specific productivity systems; use when (1) the user needs help with productivity, focus, time management, planning, priorities, goals, projects, tasks, habits, or reviews; (2) they want a reusable structure or workspace for organizing work; (3) ongoing work should be routed through a dedicated productivity framework."
changelog: Expanded the system with clearer routing, setup, and folders for goals, tasks, habits, planning, and reviews
metadata: {"clawdbot":{"emoji":"⚡","requires":{"bins":[]},"os":["linux","darwin","win32"],"configPaths":["~/productivity/"]}}
---

## When to Use

Use this skill when the user wants a real productivity system, not just one-off motivation. It should cover goals, projects, tasks, habits, planning, reviews, overload triage, and situation-specific constraints in one coherent operating model.

## Architecture

Productivity lives in `~/productivity/`. If `~/productivity/` does not exist yet, run `setup.md`.

```
~/productivity/
├── memory.md
├── inbox/
│   ├── capture.md
│   └── triage.md
├── dashboard.md
├── goals/
│   ├── active.md
│   └── someday.md
├── projects/
│   ├── active.md
│   └── waiting.md
├── tasks/
│   ├── next-actions.md
│   ├── this-week.md
│   ├── waiting.md
│   └── done.md
├── habits/
│   ├── active.md
│   └── friction.md
├── planning/
│   ├── daily.md
│   ├── weekly.md
│   └── focus-blocks.md
├── reviews/
│   ├── weekly.md
│   └── monthly.md
├── commitments/
│   ├── promises.md
│   └── delegated.md
├── focus/
│   ├── sessions.md
│   └── distractions.md
├── routines/
│   ├── morning.md
│   └── shutdown.md
└── someday/
    └── ideas.md
```

The skill should treat this as the user's productivity operating system: one trusted place for direction, commitments, execution, habits, and periodic review.

## Quick Reference

| Topic | File |
|-------|------|
| Setup and routing | `setup.md` |
| Memory structure | `memory-template.md` |
| Productivity system template | `system-template.md` |
| Cross-situation frameworks | `frameworks.md` |
| Common mistakes | `traps.md` |

## Core Rules

### 1. Build One System, Not Five Competing Ones
- Prefer one trusted productivity structure over scattered notes, random task lists, and duplicated plans.
- Route goals, projects, tasks, habits, routines, focus, planning, and reviews into the right folder instead of inventing a fresh system each time.
- If the user already has a good system, adapt to it rather than replacing it for style reasons.

### 2. Start With the Real Bottleneck
- Diagnose whether the problem is priorities, overload, unclear next actions, bad estimates, weak boundaries, or low energy.
- Give the smallest useful intervention first.
- Do not prescribe a full life overhaul when the user really needs a clearer next step.

### 3. Separate Goals, Projects, and Tasks Deliberately
- Goals describe outcomes.
- Projects package the work needed to reach an outcome.
- Tasks are the next visible actions.
- Habits are repeated behaviors that support the system over time.
- Never leave a goal sitting as a vague wish without a concrete project or next action.

### 4. Adapt the System to Real Constraints
- Use the reference files when the user's reality matters more than generic advice.
- Energy, childcare, deadlines, meetings, burnout, and ADHD constraints should shape the plan.
- A sustainable system beats an idealized one that collapses after two days.

### 5. Reviews Matter More Than Constant Replanning
- Weekly review is where the system regains trust.
- Clear stale tasks, rename vague items, and reconnect tasks to real priorities.
- If the user keeps replanning daily without progress, simplify and review instead.

### 6. Save Only Explicitly Approved Preferences
- Store work-style information only when the user explicitly asks you to save it or clearly approves.
- Before writing to `~/productivity/memory.md`, ask for confirmation.
- Never infer long-term preferences from silence, patterns, or one-off comments.

## Scope

This skill ONLY:
- builds or improves a local productivity operating system
- gives productivity advice and planning frameworks
- reads included reference files for context-specific guidance
- writes to `~/productivity/` only after explicit user approval

This skill NEVER:
- accesses calendar, email, contacts, or external services by itself
- monitors or tracks behavior in the background
- infers long-term preferences from observation alone
- writes files without explicit user confirmation
- makes network requests
- modifies its own SKILL.md or auxiliary files

## External Endpoints

This skill makes NO external network requests.

## Data Storage

Local files live in `~/productivity/`.

Create or update these files only after the user confirms they want the system written locally.

## Trust

This skill is instruction-only. It provides a local framework for productivity planning, prioritization, and review. Install it only if you are comfortable storing your own productivity notes in plain text under `~/productivity/`.
