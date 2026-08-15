"""Does the structure guard tell a faithful redesign from a broken one?

Run with `python test_structure_guard.py` from this directory. The rooms are
synthetic — flat walls, a door, a window — which is the point: a real render
pair could not say *which* difference the guard reacted to, and these can,
because each case changes exactly one thing.

What is deliberately not claimed here: that the thresholds are right for real
photographs. Synthetic edges are cleaner than a photographed room, so the real
scores will be lower across the board. What these cases pin down is the
ordering and the vetoes — faithful above reshaped, an invented opening caught
whatever else it scored — and the thresholds are env-tunable against the
measurements the engines report from production.
"""
import sys

import cv2
import numpy as np
from PIL import Image

from structure_guard import StructureGuard, seed_ladder

W, H = 1024, 768


def room(window_x=620, extra_window=False, wall_shift=0, wall_colour=210, floor=150):
    """A crude interior: back wall, floor line, a door and one or two windows."""
    img = np.full((H, W, 3), wall_colour, np.uint8)
    # Floor
    cv2.rectangle(img, (0, 560 + wall_shift), (W, H), (floor, floor - 20, floor - 40), -1)
    # Side wall edges
    cv2.line(img, (150 + wall_shift, 0), (150 + wall_shift, H), (90, 90, 90), 3)
    cv2.line(img, (880 - wall_shift, 0), (880 - wall_shift, H), (90, 90, 90), 3)
    # Ceiling line
    cv2.line(img, (0, 120), (W, 120), (90, 90, 90), 3)
    # Door
    cv2.rectangle(img, (220, 220), (330, 560 + wall_shift), (70, 60, 55), -1)
    # Window (bright)
    cv2.rectangle(img, (window_x, 200), (window_x + 190, 430), (255, 255, 255), -1)
    if extra_window:
        cv2.rectangle(img, (380, 200), (560, 430), (255, 255, 255), -1)
    return Image.fromarray(img)


def furnish(img, seed=0):
    """A faithful redesign: same shell, new movable contents and a new palette."""
    rng = np.random.default_rng(seed)
    out = np.asarray(img).copy()
    # Recolour the walls without moving them.
    walls = np.all(np.abs(out.astype(int) - 210) < 12, axis=-1)
    out[walls] = (196, 186, 172)
    # Drop furniture on the floor.
    for _ in range(4):
        x = int(rng.integers(200, 800))
        y = int(rng.integers(580, 700))
        w = int(rng.integers(60, 160))
        h = int(rng.integers(40, 90))
        colour = tuple(int(c) for c in rng.integers(60, 190, 3))
        cv2.rectangle(out, (x, y), (x + w, y + h), colour, -1)
    return Image.fromarray(out)


SOURCE = room()
GUARD = StructureGuard(SOURCE, (W, H))

#: case name -> (candidate, must be accepted, expected veto if any)
CASES = {
    "faithful redesign": (furnish(SOURCE, 1), True, ""),
    "faithful, other seed": (furnish(SOURCE, 2), True, ""),
    "window moved 200px": (furnish(room(window_x=420), 1), False, "invented_opening"),
    "extra window added": (furnish(room(extra_window=True), 1), False, "invented_opening"),
    "room reshaped": (furnish(room(wall_shift=70), 1), False, "structure_moved"),
    "unrelated image": (
        Image.fromarray(np.random.default_rng(0).integers(0, 255, (H, W, 3), dtype=np.uint8)),
        False,
        "structure_moved",
    ),
}


def test_each_failure_is_caught_and_named():
    for name, (candidate, should_accept, expected_veto) in CASES.items():
        report = GUARD.evaluate(candidate)
        assert report["accepted"] == should_accept, (
            f"{name}: accepted={report['accepted']}, expected {should_accept} "
            f"(score {report['score']}, veto {report['veto'] or 'none'})"
        )
        assert report["veto"] == expected_veto, (
            f"{name}: veto={report['veto'] or 'none'}, expected {expected_veto or 'none'}"
        )


def test_faithful_ranks_above_every_broken_one():
    """The ordering best_of relies on, and the reason it is not raw score.

    An invented window loses none of the source's structure, so it can score a
    clean 1.0 — equal to a faithful render. Only the rank key separates them,
    which is why the search sorts on that and not on the score.
    """
    faithful = GUARD.rank(GUARD.evaluate(CASES["faithful redesign"][0]))
    for name, (candidate, should_accept, _) in CASES.items():
        if should_accept:
            continue
        assert faithful > GUARD.rank(GUARD.evaluate(candidate)), f"{name} outranked a faithful render"


def test_best_of_returns_the_faithful_candidate():
    """A bad first seed must not be what ships."""
    renders = {
        1: furnish(room(extra_window=True), 1),  # first seed invents a window
        2: furnish(SOURCE, 2),                   # second is faithful
    }
    order = []

    def render(seed):
        order.append(seed)
        return renders[1] if len(order) == 1 else renders[2]

    image, report = GUARD.best_of(render, base_seed=1, candidates=2)
    assert report["accepted"], f"best_of shipped an unaccepted render: {report}"
    assert report["candidates"] == 2, "it should have retried after the veto"
    assert image is renders[2]


def test_best_of_stops_at_the_first_good_candidate():
    calls = []

    def render(seed):
        calls.append(seed)
        return furnish(SOURCE, 1)

    _image, report = GUARD.best_of(render, base_seed=99, candidates=3)
    assert len(calls) == 1, "a passing first candidate must not pay for a second"
    assert calls[0] == 99, "the first seed must be the brief's own, so runs reproduce"
    assert report["accepted"]


def test_best_of_ships_the_best_when_nothing_passes():
    """A paid render must never fail because the guard was unhappy."""
    broken = [furnish(room(wall_shift=90), 1), furnish(room(wall_shift=70), 1)]

    def render(seed):
        return broken[min(len(seen), len(broken) - 1)] if (seen.append(seed) or True) else None

    seen = []
    image, report = GUARD.best_of(render, base_seed=5, candidates=2)
    assert image is not None, "best_of must always return a picture"
    assert report["accepted"] is False
    assert report["veto"], "and it must say why it is not accepted"


def test_seed_ladder_is_deterministic_and_well_spread():
    first = seed_ladder(12345, 3)
    assert first == seed_ladder(12345, 3), "same brief must give the same ladder"
    assert first[0] == 12345, "the first seed is the brief's own"
    assert len(set(first)) == 3
    assert all(0 <= seed <= 0x7FFFFFFF for seed in first)
    # Adjacent seeds must not be neighbours, or a retry re-renders the same noise.
    assert all(abs(a - b) > 1000 for a, b in zip(first, first[1:]))


def _report_table():
    print(f"{'case':24s} {'score':>7s} {'line':>7s} {'edge':>7s} {'kept':>7s} {'added':>7s}  verdict")
    for name, (candidate, _accept, _veto) in CASES.items():
        r = GUARD.evaluate(candidate)
        verdict = "ACCEPT" if r["accepted"] else (r["veto"] or "reject")
        print(
            f"{name:24s} {r['score']:7.3f} {r['line_recall']:7.3f} {r['edge_recall']:7.3f} "
            f"{r['opening_kept']:7.3f} {r['opening_added']:7.4f}  {verdict}"
        )
    print()


def _run():
    _report_table()
    tests = [
        (name, value)
        for name, value in sorted(globals().items())
        if name.startswith("test_") and callable(value)
    ]
    failures = []
    for name, test in tests:
        try:
            test()
            print(f"  PASS  {name}")
        except AssertionError as error:
            failures.append(name)
            print(f"  FAIL  {name}\n        {error}")
    print(f"\n{len(tests) - len(failures)}/{len(tests)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(_run())
