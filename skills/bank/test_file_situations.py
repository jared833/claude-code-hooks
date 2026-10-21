"""Self-check: python test_file_situations.py

Builds a throwaway bank with one breakdown and checks that situations.md gets Measured first,
keeps its Conflict: lines across a rebuild, links the right anchor, and flags an unknown tag.
"""
import contextlib
import io
import sys
import tempfile
from pathlib import Path

import file_situations as fs

SIT = """# Situations

Intro line.

## Tags

- `pricing-an-offer`: setting a price
- `cold-calls`: dialing

## pricing-an-offer
old line that must go
Conflict: A says X, B says Y
"""

BD = """# Ep
show: S   speaker: Maria Wendt   host: H   date: 2026-09-29

## Skip the $197 tier

### Price low ticket at $27 to 97
**Situation:** pricing-an-offer, made-up-tag
**Evidence:** Opinion. she thinks so
**Source:** raw/x.txt "a"

### Skip the $197 tier
**Situation:** pricing-an-offer
**Evidence:** **Measured**. she says $1M a month
**Source:** raw/x.txt "b"
"""

with tempfile.TemporaryDirectory() as td:
    td = Path(td)
    (td / "breakdowns").mkdir()
    (td / "breakdowns" / "ep.md").write_text(BD, encoding="utf-8")
    (td / "situations.md").write_text(SIT, encoding="utf-8")
    fs.ROOT, fs.SIT = td, td / "situations.md"
    fs.main()
    fs.main()  # a second rebuild must not duplicate or lose anything
    out = fs.SIT.read_text(encoding="utf-8")
    sec = out.split("## pricing-an-offer\n")[1].split("\n## ")[0]
    lines = sec.splitlines()
    assert "old line" not in out
    # the ## heading of the same text takes the bare anchor, so the play gets -1, as on GitHub
    assert lines[1] == "- [Skip the $197 tier](breakdowns/ep.md#skip-the-197-tier-1) (Maria Wendt, Measured)", lines
    assert lines[2].startswith("- [Price low ticket at $27 to 97](breakdowns/ep.md#price-low-ticket-at-27-to-97)"), lines
    assert out.count("Conflict: A says X, B says Y") == 1
    assert "## cold-calls\ndialing\n" in out
    assert out.startswith("# Situations\n\nIntro line.")
    assert b"\r" not in fs.SIT.read_bytes()
    # a hand note that is not a one-line Conflict would vanish on rebuild, so --check refuses it
    fs.SIT.write_text(out.replace("Conflict: A says X, B says Y", "Conflict: A says X,\n  wrapped tail"),
                      encoding="utf-8", newline="\n")
    sys.argv = ["x", "--check"]
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            fs.main()
        raise AssertionError("--check should exit 1")
    except SystemExit as e:
        assert e.code == 1
    assert "unknown tag 'made-up-tag'" in buf.getvalue(), buf.getvalue()
    assert "hand-written line would be lost" in buf.getvalue(), buf.getvalue()
print("all passed")
