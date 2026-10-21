"""Self-check: python test_file_playbooks.py

Builds a throwaway bank and checks that file_playbooks.py appends only plays not yet linked,
skips a hooks-only play, links the right anchor, never touches the original playbook, splits
at the cap, and appends nothing on a rerun.
"""
import tempfile
from pathlib import Path

import file_playbooks as fp
import file_situations as fs

SIT = "# S\n\n## Tags\n\n- `pricing-an-offer`: setting a price\n- `hooks-and-editing`: hooks\n"
PLAY = """### {t}
**Situation:** {tags}
**Do:** x
**Evidence:** Opinion. y
**Source:** raw/ep.txt "z"

Prose after the play that must not be copied.
"""
BD = "# Ep\nshow: S   speaker: Maria Wendt   host: H\n\n## Section\n\n" + "".join([
    PLAY.format(t="Linked already", tags="pricing-an-offer"),
    PLAY.format(t="Hooks only", tags="hooks-and-editing"),
    PLAY.format(t="Skip the 197 tier", tags="hooks-and-editing, pricing-an-offer"),
    PLAY.format(t="Big one", tags="pricing-an-offer").replace("**Do:** x", "**Do:** " + "w" * 20000),
    PLAY.format(t="Bigger one", tags="pricing-an-offer").replace("**Do:** x", "**Do:** " + "w" * 20000),
])
ORIG = "# Pricing\nchecked: 2026-01-01   ttl: timeless\n\n## Old\n**Source:** raw/ep.txt \"a\"\n**Breakdown:** breakdowns/ep.md#linked-already\n"

with tempfile.TemporaryDirectory() as td:
    td = Path(td)
    (td / "breakdowns").mkdir()
    (td / "playbooks").mkdir()
    (td / "breakdowns" / "ep.md").write_text(BD, encoding="utf-8")
    (td / "playbooks" / "pricing.md").write_text(ORIG, encoding="utf-8")
    (td / "situations.md").write_text(SIT, encoding="utf-8")
    fp.ROOT, fs.ROOT, fs.SIT = td, td, td / "situations.md"
    fp.main()
    one = (td / "playbooks" / "pricing-an-offer.md").read_text(encoding="utf-8")
    two = (td / "playbooks" / "pricing-an-offer-2.md").read_text(encoding="utf-8")
    assert (td / "playbooks" / "pricing.md").read_text(encoding="utf-8") == ORIG
    assert "Linked already" not in one + two and "Hooks only" not in one + two
    assert "## Skip the 197 tier" in one
    assert "**Breakdown:** breakdowns/ep.md#skip-the-197-tier (Maria Wendt)" in one
    assert "Prose after" not in one + two
    assert one.splitlines()[1].startswith("checked: ")
    assert "## Big one" in one and "## Bigger one" in two  # the second big play would pass 32KB
    before = sorted(p.read_text(encoding="utf-8") for p in (td / "playbooks").glob("*.md"))
    fp.main()  # a rerun finds every play linked and appends nothing
    assert before == sorted(p.read_text(encoding="utf-8") for p in (td / "playbooks").glob("*.md"))
    assert not list((td / "playbooks").glob("hooks*")) and not list((td / "playbooks").glob("editing*"))
print("all passed")
