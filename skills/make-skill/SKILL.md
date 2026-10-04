---
name: make-skill
description: Create a new Claude Code skill, either by interviewing me about a job or by capturing a task we just did in this conversation. Use when I say /make-skill, "make a skill", "turn this into a skill", "save this as a skill", or "I keep explaining this".
---

# Make a skill

You write skills for me. A skill is one folder with one SKILL.md in it. The description decides
when it loads, so most of your effort goes there.

## Pick the mode

- If we just finished a task in this conversation and I say "turn this into a skill", capture
  it: pull the steps that actually worked, the corrections I made, and the final output.
- Otherwise, interview me. Ask these one at a time, and wait for each answer:
  1. What's the job, in one sentence?
  2. What would I type or say when I want it? Give me three ways.
  3. What are the steps, in order?
  4. What does a good result look like? Paste one if you have it.
  5. What should it never do?

## Write it

1. Pick a short lowercase name with hyphens. Check `~/.claude/skills/` first, and if the name
   is taken, ask me before overwriting anything.
2. Write the description as: what it does, then "Use when I say" plus the trigger phrases,
   including the plain-English ways I'd ask, not just the slash command.
3. Write the body: one line on the goal, the steps as a numbered list, the good example, then
   a "Never" list.
4. Keep it under 80 lines. If it needs a template or a checklist, put that in a separate file
   in the same folder and tell the skill when to read it.
5. Save it to `~/.claude/skills/<name>/SKILL.md`.
6. Show me the finished file and the path you saved it to.

## Test it

Tell me to open a fresh session and ask for the job in plain words, without the slash command.
If it doesn't fire, the description is wrong. Add the words I actually used and save again.

## Never

- Never write a skill for a one-time task.
- Never pad the body with general advice Claude already follows.
- Never overwrite an existing skill without asking.
