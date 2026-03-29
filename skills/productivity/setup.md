# Setup — Productivity

## Philosophy

This skill should work from minute zero.

Do not make the user complete a productivity migration project before they can get help. Answer the immediate request first, then progressively turn repeated planning work into a trusted local system.

## On First Use

### Priority #1: Answer the Current Productivity Problem

If the user asks to plan, prioritize, review, or recover focus, help immediately.

Only propose setup when it will reduce future friction.

### Priority #2: Offer Lightweight Integration

Ask once, naturally:

> "Want me to set up a local productivity system so goals, projects, tasks, habits, and reviews stop living in random places?"

If yes, create `~/productivity/` and the baseline files.

If no, help anyway and mark integration as declined in `~/productivity/memory.md` only if the user wants memory enabled.

### Priority #3: Tune Activation Briefly

After wiring the default routing, ask one short follow-up:

> "I wired this to trigger for planning, prioritization, goals, projects, tasks, habits, reviews, and overload resets. Want to also trigger it for anything else?"

If the user names extra situations, update the routing snippet instead of inventing separate memory.

## Local Productivity Structure

When the user wants the system installed locally:

```bash
mkdir -p ~/productivity/{inbox,goals,projects,tasks,habits,planning,reviews,commitments,focus,routines,someday}
```

Then create:
- `~/productivity/memory.md` from `memory-template.md`
- `~/productivity/inbox/capture.md` from `system-template.md`
- `~/productivity/inbox/triage.md` from `system-template.md`
- `~/productivity/dashboard.md` from `system-template.md`
- `~/productivity/goals/active.md` from `system-template.md`
- `~/productivity/goals/someday.md` from `system-template.md`
- `~/productivity/projects/active.md` from `system-template.md`
- `~/productivity/projects/waiting.md` from `system-template.md`
- `~/productivity/tasks/next-actions.md` from `system-template.md`
- `~/productivity/tasks/this-week.md` from `system-template.md`
- `~/productivity/tasks/waiting.md` from `system-template.md`
- `~/productivity/tasks/done.md` from `system-template.md`
- `~/productivity/habits/active.md` from `system-template.md`
- `~/productivity/habits/friction.md` from `system-template.md`
- `~/productivity/planning/daily.md` from `system-template.md`
- `~/productivity/planning/weekly.md` from `system-template.md`
- `~/productivity/planning/focus-blocks.md` from `system-template.md`
- `~/productivity/reviews/weekly.md` from `system-template.md`
- `~/productivity/reviews/monthly.md` from `system-template.md`
- `~/productivity/commitments/promises.md` from `system-template.md`
- `~/productivity/commitments/delegated.md` from `system-template.md`
- `~/productivity/focus/sessions.md` from `system-template.md`
- `~/productivity/focus/distractions.md` from `system-template.md`
- `~/productivity/routines/morning.md` from `system-template.md`
- `~/productivity/routines/shutdown.md` from `system-template.md`
- `~/productivity/someday/ideas.md` from `system-template.md`

## Golden Rule

If the skill becomes another productivity project instead of helping the user get clear and move, it failed.
