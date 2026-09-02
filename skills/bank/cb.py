"""Context bank intake and search.

Five commands:
    python cb.py add <url> [--show NAME] [--speaker NAME] [--force]
    python cb.py transcript <slug>
    python cb.py search "<phrase>" [--limit N]
    python cb.py feed "Show=url" ... [--days N]
    python cb.py stale

Raw transcripts live in raw/ and no working session reads one whole. `search` is
the way in and it caps its own output, so a broad query cannot flood a context
window. `transcript` is the one exception and it has exactly one caller: the
agent whose entire job is distilling that episode, whose context dies with it.

The yt-dlp invocation and parse_vtt are lifted from projects/clipfarm/pipeline.py
(retired). Precedence is the same and it is the whole reason this is cheap:
published captions when they exist, whisper only when they do not.
"""
import argparse
import html
import json
import re
import subprocess
import sys
import tempfile
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "raw"

WHISPER_MODEL = "small.en"   # same model the video pipeline uses, already cached locally
LINE_CHARS = 200             # one raw line is one grep hit, so it is also the quote unit
SEARCH_HITS = 12             # hard caps on search output. Do not raise these.
SEARCH_CHARS = 240

TIME_RE = re.compile(r"(\d+):(\d\d):(\d\d)\.(\d\d\d)")


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")


def parse_vtt(path):
    """VTT -> [text]. Collapses YouTube auto-sub rolling duplicates.

    From clipfarm/pipeline.py:58, with the timestamps dropped: the bank quotes
    words, not moments.
    """
    out, seen, in_block = [], None, False
    for raw in Path(path).read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if "-->" in line:
            in_block = bool(TIME_RE.findall(line))
        elif line and in_block and not line.startswith(("WEBVTT", "Kind:", "Language:", "NOTE")):
            # unescape after tag-stripping: captions carry &gt;&gt; as the speaker-turn marker
            text = html.unescape(re.sub(r"<[^>]+>", "", line)).strip()
            if text and text != seen:
                out.append(text)
                seen = text
    return out


def pack(chunks):
    """Fold caption fragments into ~LINE_CHARS lines so one grep hit is one quotable line."""
    lines, buf = [], ""
    for c in chunks:
        buf = f"{buf} {c}".strip()
        if len(buf) >= LINE_CHARS:
            lines.append(buf)
            buf = ""
    if buf:
        lines.append(buf)
    return lines


def slugify(s):
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", s.lower())).strip("-")[:60]


def transcribe(audio):
    from faster_whisper import WhisperModel
    model = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
    # no initial_prompt: priming whisper makes it invent words that were never said
    segs, _ = model.transcribe(str(audio), language="en", vad_filter=True)
    return [s.text.strip() for s in segs if s.text.strip()]


def pick_vtt(paths, manual, auto):
    """Manual track first, then auto, then anything the info.json did not classify."""
    def lang_of(p):
        parts = Path(p).name.split(".")
        return parts[-2] if len(parts) >= 3 else ""
    return sorted(paths, key=lambda p: (lang_of(p) not in manual, lang_of(p) not in auto,
                                        Path(p).name))


def pubdate(up):
    """yt-dlp's upload_date as YYYY-MM-DD, or None. Digits as well as length, because this
    lands in the filename and a crafted value would put the transcript outside raw/."""
    up = str(up or "")
    return f"{up[:4]}-{up[4:6]}-{up[6:]}" if len(up) == 8 and up.isdigit() else None


def url_of(meta):
    """The url a sidecar records, or None. A hand-edited sidecar is not a reason to refuse an
    ingest, and valid JSON that is not an object (`null`, a bare string) used to raise here."""
    try:
        d = json.loads(meta.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return d.get("url") if isinstance(d, dict) else None


def resolve_slug(slug, url):
    """Where this transcript goes. Re-adding the same URL overwrites itself, whichever suffix
    it landed on last time. Two different episodes colliding on a 60-char slug must not
    silently destroy the first one."""
    same = [m for m in sorted(RAW.glob(f"{slug}*.meta.json")) if url_of(m) == url]
    if same:
        return same[0].name[: -len(".meta.json")]
    base, n = slug, 1
    while (RAW / f"{slug}.txt").exists():
        n += 1
        slug = f"{base}-{n}"
    return slug


def sidecar_urls():
    """url -> slug for everything already in the bank. The sidecars are readable by design."""
    out = {}
    # sorted so two sidecars carrying the same url resolve the same way resolve_slug does
    for m in sorted(RAW.glob("*.meta.json")):
        u = url_of(m)
        if u:
            out.setdefault(u, m.name[: -len(".meta.json")])
    return out


def transcript(slug):
    """Print one transcript whole, for the ONE agent whose job is distilling it.

    raw/ is guarded because a stray read floods a working session with 25K tokens. A
    distillation agent has to read the whole thing, its context dies with it, and there is no
    other way to get the exact Source: phrases a play needs. So the sanctioned path is a named
    command rather than a hole in the guard: nobody calls this by accident.
    """
    # RAW / "C:/anything" discards RAW entirely, and "../x" walks out, so an unbounded slug
    # turns this into "print any .txt on the machine".
    f = RAW / f"{slug}.txt"
    if f.parent.resolve() != RAW.resolve() or not f.exists():
        sys.exit(f"no transcript named {slug}. Ingest it first with: cb.py add <url>")
    print(f.read_text(encoding="utf-8"))


def add(url, show=None, speaker=None, force=False):
    if not force:
        seen = sidecar_urls().get(url)
        if seen and not (RAW / f"{seen}.txt").exists():
            seen = None  # an orphan sidecar means the transcript was deleted on purpose
        if seen:
            # Sweeps overlap by construction (a 14-day window checked weekly), so without this
            # every episode gets re-transcribed and re-distilled on the next run.
            print(f"already in the bank as {seen}. Nothing to do. Re-run with --force to "
                  f"re-transcribe.", file=sys.stderr)
            return
    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        r = run([sys.executable, "-m", "yt_dlp", "--skip-download",
                 # An explicit list, not "en.*". The wildcard makes yt-dlp ask for every
                 # English variant a source advertises, and a source with dozens of
                 # auto-translated tracks answers that with a 429.
                 "--write-auto-subs", "--write-subs", "--sub-langs", "en,en-orig,en-US,en-GB",
                 "--convert-subs", "vtt", "--write-info-json",
                 "-o", str(td / "s.%(ext)s"), url])
        # Strict on returncode. yt-dlp writes the info.json early and the subtitles later, so
        # a network drop partway through leaves an info.json beside a TRUNCATED vtt. Accepting
        # that would write half a transcript and print the same success line as a whole one.
        if r.returncode != 0:
            sys.exit(f"yt-dlp failed:\n{r.stderr[-800:]}")
        info_files = list(td.glob("*.info.json"))
        info = json.loads(info_files[0].read_text(encoding="utf-8")) if info_files else {}

        # Which track is human-written comes from the info.json, not the filename: yt-dlp
        # writes auto captions to the same s.<lang>.vtt name as a manual track.
        auto = set(info.get("automatic_captions") or {})
        manual = set(info.get("subtitles") or {})
        vtts = pick_vtt(td.glob("*.vtt"), manual, auto)
        if vtts:
            picked = vtts[0].name.split(".")[-2] if vtts[0].name.count(".") >= 2 else ""
            kind = "manual" if picked in manual else ("auto" if picked in auto else "unknown")
            method, chunks = f"captions:{kind}:{vtts[0].name}", parse_vtt(vtts[0])
        else:
            r = run([sys.executable, "-m", "yt_dlp", "-f", "bestaudio/best",
                     "-o", str(td / "a.%(ext)s"), url])
            audio = sorted(td.glob("a.*"))
            if r.returncode != 0 or not audio:
                sys.exit(f"no captions and audio download failed:\n{r.stderr[-800:]}")
            print(f"no captions, transcribing with whisper {WHISPER_MODEL}. This is slow.",
                  file=sys.stderr)
            method, chunks = f"whisper:{WHISPER_MODEL}", transcribe(audio[0])

    if not chunks:
        sys.exit("nothing transcribed")

    title = info.get("title") or url
    published = pubdate(info.get("upload_date"))
    slug = f"{published or date.today().isoformat()}-{slugify(title)}"

    lines = pack(chunks)
    words = sum(len(line.split()) for line in lines)
    # A truncated caption file is the silent failure to fear: it writes cleanly and prints the
    # same success line as a whole one. Speech runs 110-180 words a minute, so anything under
    # 60 is a fragment, not a slow talker.
    dur = info.get("duration")
    if dur and words < dur:  # 60 words per minute is one word per second of audio
        sys.exit(f"transcript looks truncated: {words} words for {round(dur / 60)} minutes of "
                 f"audio. Nothing written. Re-run; if it repeats the source has partial captions.")

    RAW.mkdir(exist_ok=True)
    slug = resolve_slug(slug, url)
    out = RAW / f"{slug}.txt"
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    (RAW / f"{slug}.meta.json").write_text(json.dumps({
        "url": url,
        "title": title,
        "show": show or info.get("channel") or info.get("uploader"),
        "speaker": speaker,
        "published": published,
        "ingested": date.today().isoformat(),
        "method": method,
        "duration_s": info.get("duration"),
        "lines": len(lines),
    }, indent=1), encoding="utf-8")

    print(f"{out}")
    print(f"{len(lines)} lines, ~{words} words, via {method}")
    print("Next: distil it into a playbook. An undistilled transcript is dead weight.")


TTL_DAYS = {"7d": 7, "90d": 90, "180d": 180}


def stale():
    """Age of every playbook against its own ttl.

    Reads the `checked:` line rather than the mtime: this is a git repo, and a clone or a
    checkout stamps every file with the current time, which would report a two-year-old
    playbook as fresh. Lives here rather than as a one-liner in a skill so a missing line is
    a printed warning instead of an IndexError at the top of a pass.
    """
    today = date.today()
    for p in sorted((ROOT / "playbooks").glob("*.md")):
        line = next((l for l in p.read_text(encoding="utf-8").splitlines()
                     if l.startswith("checked:")), None)
        if not line:
            print(f"{p.name:16} NO checked: LINE, treat as stale and rebuild")
            continue
        parts = line.split()
        try:
            age = (today - date.fromisoformat(parts[1])).days
        except (IndexError, ValueError):
            # One malformed line used to raise and kill the report for every playbook after it.
            print(f"{p.name:16} UNREADABLE checked: line, treat as stale and rebuild")
            continue
        # A MISSING ttl is not an implicit "timeless". That reported ok forever, which is the
        # one wrong answer here: the same bug the unknown-ttl branch below was written to close.
        ttl = parts[3] if len(parts) > 3 else "MISSING"
        if ttl != "timeless" and ttl not in TTL_DAYS:
            # An unknown ttl used to report "ok" forever, which is the one wrong answer here.
            print(f"{p.name:16} {age:>4} days   ttl {ttl:<9} UNKNOWN ttl, rebuild before use")
            continue
        limit = TTL_DAYS.get(ttl)
        flag = "STALE, rebuild before use" if limit and age > limit else "ok"
        print(f"{p.name:16} {age:>4} days   ttl {ttl:<9} {flag}")


def _scan(match):
    hits = []
    for f in sorted(RAW.glob("*.txt")):
        meta_path = f.with_name(f.stem + ".meta.json")
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
        except json.JSONDecodeError:
            meta = {}   # one bad sidecar must not take down every other file's hits
        who = meta.get("speaker") or meta.get("show") or "?"
        for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            if match(line.lower()):
                hits.append((f.stem, n, who, line[:SEARCH_CHARS]))
    return hits


def search(query, limit=SEARCH_HITS):
    # The cap lives here, not at the call site: it is the invariant the whole design rests on,
    # and `--limit -1` used to slip past a call-site min() and return the entire corpus.
    limit = max(1, min(limit, SEARCH_HITS))
    # Normalise runs of whitespace on both sides. `pack()` rewraps transcripts, so a phrase
    # copied out of a Source anchor with a newline in it would otherwise never match.
    terms = query.lower().split()
    phrase = " ".join(terms)
    if not terms:
        sys.exit('search needs a phrase. Take one from a playbook\'s Source anchor.')

    # Phrase first, because every doc tells the agent to paste an exact phrase. Falling back to
    # an all-words match silently would fill the 12 slots with loose hits and push the real
    # phrase off the end, so the fallback is announced.
    hits, mode = _scan(lambda low: phrase in " ".join(low.split())), "phrase"
    if not hits and len(terms) > 1:
        hits, mode = _scan(lambda low: all(t in low for t in terms)), "all words"
        if hits:
            print(f"no line contains that phrase. Falling back to lines containing all of "
                  f"{', '.join(terms)}.\n")
    if not hits:
        print(f"no hits for {query!r}. This matches literal characters, not meaning: try the "
              "speaker's "
              "own phrasing from the playbook's Source anchor, or fewer words.")
        return
    shown = hits[:limit]
    for stem, n, who, line in shown:
        print(f"\n{stem}:{n}  [{who}]\n  {line}")
    if len(hits) > len(shown):
        cap = (f"The cap is fixed at {SEARCH_HITS}: narrow the phrase." if limit == SEARCH_HITS
               else f"--limit {limit} asked for fewer; the ceiling is {SEARCH_HITS}.")
        print(f"\n{len(hits)} {mode} hits, {len(shown)} shown. {cap}")


def feed(sources, days=14):
    """List new items from the Show rows of the Notion Context Sources table.

    The approved-source list lives in Notion, not on disk, because Jared updates it there.
    A session reads the table and passes each Show row here as "Name=URL". This lists only.
    A person picks what enters.
    """
    cutoff = (datetime.now() - timedelta(days=days)).strftime("%Y%m%d")
    undated = 0
    for row in sources:
        m = re.match(r"([^=]+)=(?=\S*https?://)", row)
        name = m.group(1).strip() if m else ""
        # A row pasted straight out of Notion can be a markdown link, so pull the URL out
        # rather than dropping it in silence.
        m = re.search(r"https?://[^)\s|]+", row)
        url = m.group(0) if m else None
        if not url:
            print(f"{name or row}: no URL in that row, skipped")
            continue
        name = name or url
        r = run([sys.executable, "-m", "yt_dlp", "--flat-playlist", "--dump-json",
                 "-I", "1:15", "--no-warnings", url])
        if r.returncode != 0:
            print(f"{name}: FAILED {r.stderr.strip()[-200:]}")
            continue
        for line in r.stdout.splitlines():
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            ts = e.get("timestamp") or e.get("release_timestamp")
            up = str(e.get("upload_date") or "")
            if not up and ts:
                up = datetime.fromtimestamp(ts).strftime("%Y%m%d")
            if up and up < cutoff:
                continue
            undated += not up
            print(f"{name}  {up or 'undated':>8}  {(e.get('title') or '?')[:70]}")
            print(f"    {e.get('url', '')}")
    if undated:
        # --flat-playlist often returns no date at all, so --days cannot filter those rows.
        # Saying so beats a list that quietly ignores the flag it was given.
        print(f"\n{undated} rows carry no date, so --days {days} did not filter them. "
              f"Check the episode page before adding one.")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="context bank intake and search")
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("add")
    a.add_argument("url")
    a.add_argument("--show")
    a.add_argument("--speaker")
    a.add_argument("--force", action="store_true", help="re-transcribe a URL already ingested")
    tr = sub.add_parser("transcript")
    tr.add_argument("slug", help="filename in raw/ without .txt. For a distillation agent only.")
    s = sub.add_parser("search")
    s.add_argument("query")
    s.add_argument("--limit", type=int, default=SEARCH_HITS)
    f = sub.add_parser("feed")
    f.add_argument("sources", nargs="+", metavar="NAME=URL",
                   help="Show rows from the Notion Context Sources table")
    f.add_argument("--days", type=int, default=14)
    sub.add_parser("stale")
    args = p.parse_args()
    if args.cmd == "add":
        add(args.url, args.show, args.speaker, args.force)
    elif args.cmd == "search":
        search(args.query, args.limit)
    elif args.cmd == "transcript":
        transcript(args.slug)
    elif args.cmd == "stale":
        stale()
    else:
        feed(args.sources, args.days)
