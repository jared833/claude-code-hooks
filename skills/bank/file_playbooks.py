"""Append every breakdown play that is not in a playbook yet to the playbook its topic belongs in.

    python file_playbooks.py --check  # list what would be appended, write nothing
    python file_playbooks.py          # append

A play is "already in" when any playbooks/*.md carries its `**Breakdown:** breakdowns/<file>#<anchor>`
link, so a rerun appends only new plays, and a play an agent linked by hand is never copied twice.
Append-only on purpose: a `**Tried:**` line added to a play later must never be regenerated away.

The topic is the play's first Situation tag (TOPIC below). New plays go to `<playbook>-<tag>.md`,
one file per subtopic, so the original playbook keeps its own plays untouched. Past 32KB the next
play opens `<playbook>-<tag>-2.md`, and so on. hooks.md and editing.md are rebuilt weekly from live
research, so a hooks-and-editing play files under its next tag, or only in its breakdown.

A play is copied through the first blank line after its Source line, so a breakdown keeps a blank
line between its last play and any prose that follows. Editing a filed breakdown so that a play's
anchor changes (a new heading with the same text above it) makes the next run copy it again.
"""
import re
import sys
from datetime import date
from pathlib import Path

import file_situations as fs

ROOT = Path(__file__).parent
CAP = 32 * 1024
TOPIC = {
    "finding-leads": "leads", "cold-outreach": "leads",
    "cold-calls": "calls", "booking-the-call": "calls",
    "running-a-sales-call": "calls", "handling-objections": "calls",
    "pricing-an-offer": "pricing",
    "building-an-offer": "offers", "choosing-a-niche-and-focus": "offers",
    "retention-and-upsell": "money-models", "launching-a-product": "money-models",
    "community-and-membership": "money-models",
    "landing-pages": "landing-pages",
    "storytelling": "story",
    "content-cadence": "attention", "content-ideas-and-formats": "attention",
    "measuring-content": "attention", "turning-followers-into-buyers": "attention",
    "positioning-and-brand": "attention", "email-list": "attention", "paid-ads": "attention",
    "ai-agents-and-automation": "systems", "hiring-and-delegating": "systems",
    "time-and-focus": "systems",
    "difficult-people-and-politics": "people",
}


def blocks(path):
    """Yield (play, text) for each play: its lines from the title through the Source line."""
    text = path.read_text(encoding="utf-8")
    for p, raw in zip(fs.plays(path), re.split(r"^### ", text, flags=re.M)[1:]):
        lines = raw.splitlines()
        out = [f"## {lines[0].strip()}"]
        src = False
        for l in lines[1:]:
            if src and (not l.strip() or l.startswith("#")):
                break
            out.append(l)
            src = src or l.startswith("**Source:**")
        if not src:
            yield p, None
            continue
        out.append(f"**Breakdown:** {p['link']} ({p['who']})")
        yield p, "\n".join(out)


def main():
    if set(sys.argv[1:]) - {"--check"}:
        sys.exit(__doc__)
    pb = ROOT / "playbooks"
    have = set()
    for f in pb.glob("*.md"):
        have |= set(re.findall(r"^\*\*Breakdown:\*\*[ \t]*(\S+)", f.read_text(encoding="utf-8"), re.M))
    desc = dict(re.findall(r"^- `([^`]+)`:?[ \t]*(.*)$", fs.SIT.read_text(encoding="utf-8"), re.M))

    todo, bad = [], []
    for f in sorted((ROOT / "breakdowns").glob("*.md")):
        for p, text in blocks(f):
            if p["link"] in have:
                continue
            tag = next((t for t in p["tags"] if t in TOPIC), None)
            if text is None:
                bad.append(f"{p['link']}: no Source line, not filed")
            elif tag:
                todo.append((tag, p, text))
            elif set(p["tags"]) - {"hooks-and-editing"}:
                bad.append(f"{p['link']}: no tag in TOPIC {p['tags']}, add the tag to TOPIC")
    # Measured first inside each subtopic, then Reported, then Opinion; stable by episode otherwise
    todo.sort(key=lambda x: (x[0], fs.ORDER.get(x[1]["label"], 3)))

    if "--check" in sys.argv:
        for tag, p, _ in todo:
            print(f"{TOPIC[tag]} / {tag}: {p['link']}")
        print(f"{len(todo)} plays to append")
        print("\n".join(bad))
        sys.exit(1 if bad else 0)

    made = []
    for tag, p, text in todo:
        b = TOPIC[tag]
        base = f"{b}-more" if tag == b else tag if tag.startswith(b) else f"{b}-{tag}"
        n = 1
        while True:
            dest = pb / (f"{base}.md" if n == 1 else f"{base}-{n}.md")
            if not dest.exists():
                head = (f"# {tag.replace('-', ' ').capitalize()}{'' if n == 1 else f', part {n}'}\n"
                        f"checked: {date.today().isoformat()}   ttl: timeless\n\n"
                        f"{desc.get(tag, tag)[:1].upper()}{desc.get(tag, tag)[1:]}. Plays filed from the breakdowns by file_playbooks.py, "
                        "one per play, with a link to the full episode breakdown."
                        + (f" Subtopic of playbooks/{TOPIC[tag]}.md." if (pb / f"{TOPIC[tag]}.md").exists() else "")
                        + "\n")
                dest.write_text(head, encoding="utf-8", newline="\n")
                made.append(dest.name)
            # an empty part takes the play however big, or one oversized play would loop forever
            if (dest.stat().st_size + len(text.encode()) + 2 <= CAP
                    or "\n## " not in dest.read_text(encoding="utf-8")):
                break
            n += 1
        with dest.open("a", encoding="utf-8", newline="\n") as fh:
            fh.write("\n" + text + "\n")
    print(f"{len(todo)} plays appended; new files: {', '.join(made) or 'none'}")
    for b in bad:
        print("  " + b)


if __name__ == "__main__":
    main()
