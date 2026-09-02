"""Self-check: python test_cb.py

Covers the pieces that can silently produce garbage: the VTT parser (rolling
duplicates), the line packer (the grep hit unit), and the search cap. The cap
cases came out of a review that got 87KB back out of `search` by passing
--limit -1, which is the standard "unlimited" idiom and slipped past a min().
"""
import contextlib
import io
import json
import sys
import tempfile
from pathlib import Path

import cb

VTT = """WEBVTT
Kind: captions
Language: en

00:00:01.000 --> 00:00:03.500
the first thing you do

00:00:03.500 --> 00:00:05.000
the first thing you do
is post it three times

00:00:05.000 --> 00:00:07.000
is post it three times
<c>before</c> writing anything new
"""


def corpus(td, text, meta=None):
    cb.RAW = Path(td)
    (cb.RAW / "ep.txt").write_text(text, encoding="utf-8")
    (cb.RAW / "ep.meta.json").write_text(json.dumps(meta or {"speaker": "Nobody"}), encoding="utf-8")


def test_parse_vtt():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "s.en.vtt"
        p.write_text(VTT, encoding="utf-8")
        out = cb.parse_vtt(p)
    assert out == ["the first thing you do",
                   "is post it three times",
                   "before writing anything new"], out
    assert not any("<c>" in line for line in out)


def test_pack():
    lines = cb.pack(["ab cd"] * 100)
    assert all(len(line) >= cb.LINE_CHARS for line in lines[:-1]), [len(x) for x in lines]
    assert " ".join(lines).split() == ["ab", "cd"] * 100
    assert cb.pack([]) == []


def test_search_caps(capture):
    with tempfile.TemporaryDirectory() as td:
        corpus(td, "the word appears here\n" * 50)
        out = capture(lambda: cb.search("word"))
    assert out.count("[Nobody]") == cb.SEARCH_HITS, out.count("[Nobody]")
    assert "50 phrase hits" in out
    # the cap is the whole point of the guardrail: a broad query stays small
    assert len(out) < 4000, len(out)


def test_cap_cannot_be_raised(capture):
    """-1 is the usual 'unlimited' idiom and hits[:-1] is everything but the last line."""
    with tempfile.TemporaryDirectory() as td:
        corpus(td, "the word appears here\n" * 50)
        for bad in (-1, 0, 999, 10 ** 6):
            out = capture(lambda: cb.search("word", bad))
            assert out.count("[Nobody]") <= cb.SEARCH_HITS, (bad, out.count("[Nobody]"))
            assert out.count("[Nobody]") >= 1, (bad, "returned nothing at all")


def test_phrase_beats_all_words(capture):
    """Every doc tells the agent to paste an exact phrase, so a phrase must match as a phrase."""
    with tempfile.TemporaryDirectory() as td:
        corpus(td, "agents guess wrong sometimes\nthe agents will guess\n")
        out = capture(lambda: cb.search("agents guess"))
    assert "ep:1" in out and "ep:2" not in out, out
    assert "Falling back" not in out

    with tempfile.TemporaryDirectory() as td:
        corpus(td, "the agents will guess\n")
        out = capture(lambda: cb.search("agents guess"))
    assert "Falling back" in out and "ep:1" in out, out


def test_empty_query_refuses(capture):
    with tempfile.TemporaryDirectory() as td:
        corpus(td, "anything\n")
        try:
            capture(lambda: cb.search("   "))
        except SystemExit:
            return
    raise AssertionError("empty query returned the corpus instead of refusing")


def test_bad_sidecar_does_not_kill_the_search(capture):
    with tempfile.TemporaryDirectory() as td:
        corpus(td, "the word is here\n")
        (Path(td) / "ep.meta.json").write_text("{not json", encoding="utf-8")
        out = capture(lambda: cb.search("word"))
    assert "ep:1" in out and "[?]" in out, out


def test_search_miss_says_why(capture):
    with tempfile.TemporaryDirectory() as td:
        corpus(td, "nothing relevant\n")
        out = capture(lambda: cb.search("distribution"))
    assert "no hits" in out and "not meaning" in out


def test_slugify():
    assert cb.slugify("My First Million: Ep #123!") == "my-first-million-ep-123"
    assert len(cb.slugify("x" * 200)) <= 60


def test_pick_vtt_prefers_manual_then_auto():
    # yt-dlp writes auto captions to the same s.<lang>.vtt name as a manual track, so the
    # info.json decides. An unclassified track used to sort above the real English auto one.
    paths = ["s.zz.vtt", "s.en.vtt", "s.de.vtt"]
    assert cb.pick_vtt(paths, manual={"de"}, auto={"en"})[0] == "s.de.vtt"
    assert cb.pick_vtt(paths, manual=set(), auto={"en"})[0] == "s.en.vtt"


def test_pubdate_rejects_a_crafted_value():
    # This lands in the output filename. Length alone is not enough.
    assert cb.pubdate("20260826") == "2026-08-26"
    assert cb.pubdate("../../x.") is None
    assert cb.pubdate(None) is None
    assert cb.pubdate("2026") is None


def test_resolve_slug_reuses_the_same_url_and_suffixes_a_collision():
    with tempfile.TemporaryDirectory() as td:
        cb.RAW = Path(td)
        assert cb.resolve_slug("ep", "http://a") == "ep"          # nothing there yet

        (cb.RAW / "ep.txt").write_text("x", encoding="utf-8")
        (cb.RAW / "ep.meta.json").write_text('{"url": "http://a"}', encoding="utf-8")
        assert cb.resolve_slug("ep", "http://a") == "ep"          # re-add overwrites itself
        assert cb.resolve_slug("ep", "http://b") == "ep-2"        # a collision does not

        (cb.RAW / "ep-2.txt").write_text("x", encoding="utf-8")
        (cb.RAW / "ep-2.meta.json").write_text('{"url": "http://b"}', encoding="utf-8")
        assert cb.resolve_slug("ep", "http://b") == "ep-2"        # re-add finds the suffix
        assert cb.resolve_slug("ep", "http://c") == "ep-3"        # and does not stop at -2

        (cb.RAW / "ep-3.meta.json").write_text("{not json", encoding="utf-8")
        assert cb.resolve_slug("ep", "http://d") == "ep-3"        # a bad sidecar is not fatal


def playbooks(td, files):
    cb.ROOT = Path(td)
    (cb.ROOT / "playbooks").mkdir()
    for name, second_line in files.items():
        (cb.ROOT / "playbooks" / name).write_text(f"# t\n{second_line}\n", encoding="utf-8")


def test_stale_flags_what_it_cannot_read(capture):
    with tempfile.TemporaryDirectory() as td:
        playbooks(td, {
            "a.md": "checked: 2026-09-01   ttl: 90d",
            "b.md": "checked: not-a-date   ttl: 90d",
            "c.md": "checked: 2026-09-01   ttl: 42y",   # unknown ttl reported ok forever
            "d.md": "no checked line here",
            "e.md": "checked: 2000-01-01   ttl: 7d",
            "f.md": "checked: 2000-01-01",              # no ttl reported ok forever
        })
        out = capture(cb.stale)
    assert "UNREADABLE" in out                  # and does not kill the rest of the report
    assert "UNKNOWN ttl" in out
    assert "NO checked: LINE" in out
    assert out.count("STALE") == 1              # only e.md
    assert out.count("UNKNOWN ttl") == 2        # unknown AND missing
    assert len(out.strip().splitlines()) == 6   # every playbook reported


def test_feed_takes_rows_off_the_command_line(capture):
    """The approved list lives in a Notion table now, so a session pastes rows in as NAME=URL.
    A row with no URL must be reported, not silently dropped."""
    called = []

    class R:
        returncode, stderr = 0, ""
        stdout = json.dumps({"upload_date": "20260901", "title": "an episode", "url": "u"})

    real_run, cb.run = cb.run, lambda cmd, **kw: called.append(cmd[-1]) or R()
    try:
        out = capture(lambda: cb.feed(["MFM=https://youtube.com/@mfm",
                                       "Pasted=[MFM](https://youtube.com/@x)",
                                       "https://youtube.com/watch?v=abc",
                                       "Nothing useful here"]))
    finally:
        cb.run = real_run
    assert called == ["https://youtube.com/@mfm", "https://youtube.com/@x",
                      "https://youtube.com/watch?v=abc"], called
    # a bare URL carries "=" in its query string and is not a NAME= prefix, so the whole
    # URL is the label rather than the fragment in front of the "="
    assert "https://youtube.com/watch?v=abc  20260901" in out, out
    assert "MFM  20260901" in out, out
    assert "Nothing useful here: no URL" in out, out


def test_add_refuses_a_url_already_in_the_bank(capture):
    """Sweeps overlap by construction, so this is the only thing stopping a re-transcribe and
    a second ~110K token distillation of the same episode on every run."""
    with tempfile.TemporaryDirectory() as td:
        cb.RAW = Path(td)
        (cb.RAW / "ep.txt").write_text("x", encoding="utf-8")
        (cb.RAW / "ep.meta.json").write_text('{"url": "http://a"}', encoding="utf-8")
        (cb.RAW / "bad.meta.json").write_text("{not json", encoding="utf-8")
        assert cb.sidecar_urls() == {"http://a": "ep"}, cb.sidecar_urls()

        boom = lambda *a, **k: (_ for _ in ()).throw(AssertionError("ingest ran anyway"))
        real_run, cb.run = cb.run, boom
        err = io.StringIO()
        try:
            with contextlib.redirect_stderr(err):
                out = capture(lambda: cb.add("http://a"))
        finally:
            cb.run = real_run
    # boom not firing is the real assertion. The notice goes to stderr like every other
    # non-result message in cb.py, so stdout stays clean for a caller piping it.
    assert "already in the bank as ep" in err.getvalue(), err.getvalue()
    assert out == "", out


def test_transcript_prints_whole_and_refuses_a_missing_slug(capture):
    """The distilling agent's only way in. raw/ is guarded, so this must actually work."""
    with tempfile.TemporaryDirectory() as td:
        cb.RAW = Path(td)
        (cb.RAW / "ep.txt").write_text("a line" + chr(10) + "another line", encoding="utf-8")
        assert "another line" in capture(lambda: cb.transcript("ep"))
        # RAW / "C:/x" discards RAW and "../x" walks out, so a slug that resolves outside
        # raw/ must be refused whether or not the file happens to exist. Put a real file at
        # each target: a missing-file exit would pass for the wrong reason.
        outside = Path(td).parent / "canary.txt"
        outside.write_text("CANARY", encoding="utf-8")
        try:
            for bad in ("../canary", "..\\canary", str(outside)[:-len(".txt")], "missing"):
                try:
                    out = capture(lambda: cb.transcript(bad))
                except SystemExit:
                    continue
                raise AssertionError(f"{bad!r} printed instead of refusing: {out[:60]}")
        finally:
            outside.unlink()


def test_cli_wires_up_transcript_and_force(capture):
    """The tests above call the functions directly, so a deleted argparse branch would not
    show up in any of them."""
    import subprocess
    h = subprocess.run([sys.executable, str(Path(cb.__file__).parent / "cb.py"), "--help"],
                       capture_output=True, text=True).stdout
    assert "transcript" in h, h
    a = subprocess.run([sys.executable, str(Path(cb.__file__).parent / "cb.py"), "add", "--help"],
                       capture_output=True, text=True).stdout
    assert "--force" in a, a


def test_a_sidecar_that_is_valid_json_but_not_an_object(capture):
    """`null` and a bare string used to raise AttributeError out of both sidecar readers."""
    with tempfile.TemporaryDirectory() as td:
        cb.RAW = Path(td)
        for bad in ("null", '"a string"', "[1,2]", "{not json"):
            (cb.RAW / "ep.meta.json").write_text(bad, encoding="utf-8")
            assert cb.url_of(cb.RAW / "ep.meta.json") is None, bad
            assert cb.sidecar_urls() == {}, bad
            assert cb.resolve_slug("ep", "http://a") == "ep", bad


def test_add_re_ingests_when_the_transcript_was_deleted(capture):
    """Deleting a bad transcript to redo it must not be answered with "nothing to do"."""
    with tempfile.TemporaryDirectory() as td:
        cb.RAW = Path(td)
        (cb.RAW / "ep.meta.json").write_text('{"url": "http://a"}', encoding="utf-8")
        ran = []
        real_run, cb.run = cb.run, lambda *a, **k: ran.append(1) or (_ for _ in ()).throw(
            SystemExit("stopped after the skip check"))
        try:
            capture(lambda: cb.add("http://a"))
        except SystemExit:
            pass
        finally:
            cb.run = real_run
        assert ran, "an orphan sidecar skipped the ingest instead of redoing it"


if __name__ == "__main__":
    import io
    import contextlib

    def capture(fn):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            fn()
        return buf.getvalue()

    real_raw, real_root = cb.RAW, cb.ROOT
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn(capture) if fn.__code__.co_argcount else fn()
            cb.RAW, cb.ROOT = real_raw, real_root
            print(f"ok  {name}")
    print("all passed")
