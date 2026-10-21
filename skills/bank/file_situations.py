"""Rebuild the per-tag sections of situations.md from every breakdowns/*.md.

Keeps the file's intro and its `## Tags` list as written, and keeps every `Conflict:` line
already under a tag (those are judgment, not data). A Conflict is ONE line, however long:
anything else hand-written under a tag would be lost, so --check refuses it. Everything else
under a tag is regenerated: one linked line per play, Measured first, then Reported, then Opinion.

    python file_situations.py --check  # problems only, exit 1 if any. Run before a rebuild.
    python file_situations.py          # rewrite situations.md
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent
SIT = ROOT / "situations.md"
ORDER = {"Measured": 0, "Reported": 1, "Opinion": 2}


def slug(title):
    """GitHub-style heading anchor, before the -1/-2 suffix for repeats."""
    t = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", title.strip().lower())  # [x](y) -> x
    t = re.sub(r"[^\w\- ]|_", "", t)
    return t.replace(" ", "-")


def speaker_of(text):
    # the header puts show, speaker and host on one line: "show: X   speaker: Y   host: Z"
    m = re.search(r"\bspeaker:[ \t]*(.*?)(?:[ \t]{2,}\w+:|$)", text, re.M)
    who = re.sub(r"\s*\(.*?\)", "", m.group(1)).strip() if m else ""
    return who or "unknown"


def plays(path):
    text = path.read_text(encoding="utf-8")
    who = speaker_of(text)
    seen, h3 = {}, []
    for level, h in re.findall(r"^(#{1,6}) (.+)$", text, re.M):  # GitHub numbers repeats across all levels
        s = slug(h)
        n = seen.get(s, 0)
        seen[s] = n + 1
        if level == "###":
            h3.append(s if n == 0 else f"{s}-{n}")
    h3 = iter(h3)
    for block in re.split(r"^### ", text, flags=re.M)[1:]:
        title = block.splitlines()[0].strip()
        tags = re.search(r"^\*\*Situation:\*\*[ \t]*(.+)$", block, re.M)
        ev = re.search(r"^\*\*Evidence:\*\*[ \t]*\**(\w+)", block, re.M)
        yield {
            "title": title,
            "tags": [t.strip().strip("`") for t in tags.group(1).split(",")] if tags else [],
            "label": ev.group(1) if ev else "",
            "who": who,
            "link": f"breakdowns/{path.name}#{next(h3, slug(title))}",
        }


def main():
    if set(sys.argv[1:]) - {"--check"}:  # --help or a typo must never rewrite the file
        sys.exit(__doc__)
    text = SIT.read_text(encoding="utf-8")
    head, _, rest = text.partition("\n## Tags\n")
    taglist, _, _ = rest.partition("\n## ")
    desc = dict(re.findall(r"^- `([^`]+)`:?[ \t]*(.*)$", taglist, re.M))
    known = list(desc)

    conflicts, bad = {}, []
    for sec in re.split(r"^## ", text, flags=re.M)[1:]:
        name, *body = sec.splitlines()
        name = name.strip()
        if name == "Tags":
            continue
        conflicts[name] = [l for l in body if l.startswith("Conflict:")]
        for l in body[1:]:
            if l.strip() and not l.startswith(("- ", "Conflict:")):
                bad.append(f"situations.md ## {name}: hand-written line would be lost: {l[:60]!r}")
        if conflicts[name] and name not in desc:
            bad.append(f"situations.md ## {name}: tag no longer listed, its Conflict lines would be lost")

    by_tag = {t: [] for t in known}
    for f in sorted((ROOT / "breakdowns").glob("*.md")):
        for p in plays(f):
            if p["label"] not in ORDER or not p["tags"]:
                bad.append(f"{p['link']}: label={p['label']!r} tags={p['tags']}")
            if re.search(r"[\[\]*`]", p["title"]):
                bad.append(f"{p['link']}: markdown in the title breaks its link")
            for t in p["tags"]:
                if t not in by_tag:
                    bad.append(f"{p['link']}: unknown tag {t!r}")
                    continue
                by_tag[t].append(p)

    if "--check" in sys.argv:
        print("\n".join(bad) or "ok")
        sys.exit(1 if bad else 0)

    out = [head.rstrip("\n"), "", "## Tags", "", taglist.strip("\n"), ""]
    for t in known:
        out += [f"## {t}", desc[t]]
        for p in sorted(by_tag[t], key=lambda p: (ORDER.get(p["label"], 3), p["who"], p["title"])):
            out.append(f"- [{p['title']}]({p['link']}) ({p['who']}, {p['label']})")
        out += conflicts.get(t, []) + [""]
    SIT.write_text("\n".join(out), encoding="utf-8", newline="\n")
    total = sum(len(v) for v in by_tag.values())
    print(f"{total} lines filed across {len(known)} tags; {len(bad)} problems")
    for b in bad:
        print("  " + b)


if __name__ == "__main__":
    main()
