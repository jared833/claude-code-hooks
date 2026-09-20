---
name: week-plan
description: Plan the week's seven videos on the 3-2-1 mix (2 broad, 4 narrow, 1 chaos) for small businesses and solo operators, using last week's numbers from Engage. Writes the plan for Jared to shoot against and for /vid-batch to read. Use when Jared says /week-plan, "plan the week", "plan the next batch of videos", or before a weekend shoot.
---

# Plan the week: 3-2-1

Adopted 2026-09-19 from a Kallaway episode (`youtube.com/watch?v=lZc30sUfx64`), adapted to
what this setup can measure. Jared films, ports the footage over, and `/vid-batch` cuts it.
This skill only decides WHAT to film. It runs before the shoot.

## The mix

Seven videos a week, in three kinds:

- **2 broad.** Topic sits at the widest ring below. Meant to bring new eyes (a good one is
  tens of thousands of views and a jump in followers). Never wider than the broad ring.
- **4 narrow.** Topic sits one or two rings inside. Fewer views, but every viewer is the person
  the offer is for. This is where trust builds.
- **1 chaos.** Anything: a format never tried, a topic from outside the rings but inside his
  range. A cheap experiment that may earn a bucket next week.

Chunking stays as it is now: one shoot still yields several cuts, hook variants and repurposes
still fill spare slots. Those inherit the parent's bucket. The 3-2-1 plans the NEW shoots.

## The rings (starting hypothesis, the data decides)

Center is the buyer. Audience as of 2026-09-19: small business owners and solo operators.

1. **Solo operators and owner-run businesses of 1 to 10 people** who do the admin themselves.
2. **Small business owners at any size**, any kind of business.
3. **Anyone running a business who wants to use AI in it.** BROAD ceiling: two videos a week live here.
4. **AI and productivity for work in general.** Too wide. Do not post here.
5. **Business, entrepreneurship, making money.** Never. It brings the wrong followers and
   teaches the algorithm the wrong audience.

Narrow = rings 1 and 2. Broad = ring 3. If the data says the rings are wrong, rewrite them here
and say so in the plan, do not quietly drift.

Ideas are filtered, not invented from this: a topic that would not build trust with ring 1 or 2
is dropped even when it would get views. Trades are outside the Role Build target and never
the centerpiece of a video here unless Jared says otherwise.

## Step 1: read last week (verify before you plan)

Pull live state. Do not reuse numbers from a previous plan.

1. `GET http://localhost:3220/api/video?status=scheduled` and `?status=published` (Engage runs
   on localhost:3220, HTTP Basic with any username and the `ENGAGE_AUTH_TOKEN` value from Engage's `.env` as the password). For rows with `published_at`
   in the last 7 days read `topic`, `bucket`, `preset`, `metrics_json.views`. Views is the only
   per-video number stored. Buffer's Instagram follows column is empty, not zero, so do not
   report per-video followers.
2. Account-level follower change over the same window: try the Instagram Graph read through
   Composio (see memory `reference-shortform-reach-levers.md`, connection name inside it). If
   it will not answer, say "follower change not available this run" and go on with views only.
3. Group by bucket, then by topic. State the sample sizes in the plan. Seven videos a week is
   thin: treat every comparison as directional, and never call a bucket a winner or a loser on
   fewer than three posts. Flag any post that was a hook variant, since it repeats its base.

The first run has no bucketed history. Say so, use whatever unbucketed views exist to pick
starting topics, and treat that week as the baseline.

## Step 2: decide

- For each bucket, what got the most views, what got the fewest, and whether followers moved.
- Keep topics that worked, drop ones that did not, on real numbers only. If the numbers are too
  thin to say, do not say it: choose from the ring definitions and mark the pick "untested".
- Broad slots must satisfy the ring 3 ceiling. Check each against the rings, out loud.
- Pull candidates from the Notion Content Bank (menu, never drains). Read it through the
  Notion connector, filter to rows that fit a slot. **Never edit an existing row**: no `Made
  on`, no `Platform`, no `Stage`, no marking anything used. An idea not chosen this week is
  untouched. The one write allowed is ADDING a row for a slot that has no bank row (Step 3.5).
- Prefer a `Stage: Worked up` row for every slot. It already carries the spoken script and shot
  list, so the slot needs no further vetting. Open the row body to confirm it has a `**Script.**`
  section before you count it as worked up; a `Stage` value alone is not evidence.
- Never touch footage, `bank.py`, `cuts.py`, ffmpeg, `post.json` or an EDL. This plans topics,
  it does not cut.
- If a slot needs footage that cannot be filmed at a desk, note it as a pickup for Jared in
  the plan body. Do not create Notion rows for the pickup itself.
- **When Jared changes a slot in chat, write the change into the plan file in the same turn.**
  The plan file is the only record of the week. An edit that lives in chat is recorded nowhere.

## Step 3: write the plan

Add a new dated section at the TOP of `<HOME>/projects/aide-data/memory/week-plan.md`
(create the file with a one-line header the first time). Older sections stay below as history.
Use this shape, plain prose, no dashes as punctuation:

```
## Week of YYYY-MM-DD (planned YYYY-MM-DD)

Last week: <sample sizes, views by bucket, follower change or "not available">. <one or two
honest sentences on what it does and does not show>.

| # | Bucket | Topic | Angle in one line | Bank row id |
|---|--------|-------|-------------------|-------------|
| 1 | broad | ... | ... | Notion page id of the Content Bank row |
... seven rows, 2 broad, 4 narrow, 1 chaos ...

Pickups for Jared: <footage that needs a real camera, or "none">
Untested picks: <which rows had no data behind them>
```

Every row's topic is a short slug that can go in `topic` on the video record. Keep it
consistent week to week for the same subject, since the scheduler spaces posts on it. The topic
slug must describe the ROW, not a past topic it resembles: history under a similar-sounding slug
does not transfer to a different idea.

The last column is the bank row's Notion page id, never a title. `/vid-batch` reads it as the
`bank_page_id` so `Made on` can be recorded once the post ships. Every slot gets one.

## Step 3.5: every slot must have a worked-up bank row

For each of the seven slots:

- Row exists and its body has a `**Script.**` section: nothing to do, record its id.
- Row exists but is Raw or has no script: hand that row to `/idea-vet`, scoped to it alone.
- No row (Jared's own idea, or a chaos slot with no match): ADD one with `notion-create-pages`
  (`Draft` phrased the way he would type it, `icon: "🤖"`, `Stage` blank, a body line naming the
  week and slot), then run `/idea-vet` scoped to that one row and pass "only this row, do not
  touch any other Raw row" in its arguments. Record the new row's id.

Adding rows is the only write this skill makes to the bank. A worked-up row that is not used this
week stays where it is.

## Step 4: tell Jared

Two or three lines: the seven topics by bucket, anything flagged, which rows were added or
vetted this run, where the file is. Depth lives in the file.

## Rules

- One planning agent, this session. Do not spawn subagents.
- Copy rules apply to anything written as copy: no AI-tell words, no dashes, never "file" in
  copy a viewer reads, links are words. The plan file itself is prose for Jared.
- No conversion or email numbers per video exist yet (Jared's call, 2026-09-19: views and
  followers only for now). Do not invent any. If conversion tracking arrives, extend Step 1
  first.
- Do not schedule this. Run it by hand for two weeks, then it can be a routine.
