"""Architectural fidelity guard for the FLUX.2 [klein] image-editing paths.

The problem this exists for: a redesign that comes back with the room a
different shape, an extra window, or a doorway where a blank wall used to be.
The brief says not to in the strongest words available (see
``prompt_engine._ARCHITECTURE_LOCKS``), and a four-step edit at guidance 1.0
still sometimes does it anyway. A prompt cannot be a guarantee.

The obvious fix — condition the model on a Canny or depth map through a
ControlNet — is not available: FLUX.2 [klein] has no ControlNet, which is the
whole reason the guided floor-plan path is still on SD 1.5. So the structural
signal is used the other way round. Instead of constraining the model before it
draws, this measures what it drew against the source's own architecture and
lets the caller reject it. The engines generate across a small ladder of seeds
and keep the first render that actually preserved the building.

Three measurements, because each catches a failure the others miss:

* **Line recall** — of the long straight segments in the source (walls, sills,
  jambs, worktops, roof edges), how many survive in the candidate? This is the
  strongest single indicator: furniture moves, architecture is straight and
  long. Weighted highest.
* **Edge recall** — the same question over the full Canny map. Coarser and
  noisier, but it catches a room whose whole shell drifted a few degrees.
* **Openings** — windows and glazed doors are the extremes of the luminance
  histogram and are close to rectangular. Comparing the source's opening mask
  against the candidate's catches both directions of the bug users report:
  ``opening_kept`` falls when one is covered or removed, ``opening_added``
  rises when one is invented. The added-area veto is what an exterior render
  that grew a window fails on.

Everything is measured on a candidate *after* it has been produced, so the cost
of a rejection is one more 4-step generation — a few seconds — and the cost of
an acceptance is a few milliseconds of OpenCV. Nothing here touches the
picture: the guard chooses between renders, it never edits one, because a
composite of two diffusion outputs looks worse than either.
"""

from __future__ import annotations

#: Long-edge fraction a segment must span to count as architecture rather than
#: as the edge of a cushion. Walls, sills and worktops clear this comfortably.
_MIN_LINE_FRACTION = 0.12

#: How far a source edge may move and still count as preserved, as a fraction of
#: the long edge. Some tolerance is required: the model re-renders every surface,
#: so an edge that is architecturally identical still lands a pixel or two out.
_EDGE_TOLERANCE_FRACTION = 0.006

#: A candidate at or above this composite score kept the architecture.
#: Calibrated to sit below what a faithful finish-only redesign scores and above
#: what a render that moved a wall scores.
ACCEPT_SCORE = 0.60

#: Fraction of the frame that may become *new* opening before the candidate is
#: rejected whatever else it scored. This is the specific veto for "it added a
#: window that does not exist" — a single invented window in a facade shot is
#: comfortably above this.
MAX_OPENING_ADDED = 0.02

#: Floor on how much of the source's opening area survives, vetoing on its own.
#:
#: The guard shipped without this and had a hole exactly where the complaints
#: were: `opening_added` catches a window that was *invented*, and line recall
#: catches a shell that *moved*, but a window painted over, shrunk, or hidden
#: behind full-height drapery loses area without adding any and without
#: shifting a wall. A render that deleted the only window outright scored 0.839
#: and was accepted. A window is the most valuable thing in a room and the
#: hardest loss to forgive, so losing one is now its own veto.
MIN_OPENING_KEPT = 0.70

#: Floor on line recall alone, vetoing independently of the composite score.
#:
#: Without this a render that reshaped the room still passed: it kept every
#: window intact, and a full-marks opening term plus a quarter of the edge term
#: carried a halved line score over the line. Line recall *is* the architecture
#: measurement — a strong result on the other two cannot mean the walls stayed
#: put — so it gets a veto rather than a vote.
MIN_LINE_RECALL = 0.55


def _threshold(name: str, default: float) -> float:
    """Read one tunable, falling back to the calibrated default.

    These three numbers decide how strict the guard is, and the honest position
    is that they are calibrated against synthetic cases and the first weeks of
    real renders will move them. Env overrides mean that tuning is a config
    change on a running service rather than a redeploy, and every report the
    engines return carries the raw measurements so there is data to tune from.
    """
    import os

    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _cv():
    """OpenCV and numpy, imported lazily.

    Module import has to stay free of both: Modal imports this file when it
    builds the router image and when it resolves the engine images, and only
    some of those carry OpenCV.
    """
    import cv2
    import numpy as np

    return cv2, np


def _prepare(image, size_wh):
    """Grayscale uint8 array of ``image`` at the render size."""
    cv2, np = _cv()
    width, height = size_wh
    gray = np.asarray(image.convert("L"), dtype="uint8")
    if gray.shape[:2] != (height, width):
        gray = cv2.resize(gray, (width, height), interpolation=cv2.INTER_AREA)
    return gray


def _canny(gray):
    """Canny edges with thresholds derived from the image's own median.

    Fixed thresholds do not survive the exposure change a redesign makes — a
    brighter scheme would look like it had lost edges. Deriving them per image
    means both sides of the comparison are measured on their own terms.
    """
    cv2, np = _cv()
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    median = float(np.median(blurred))
    lower = int(max(0, 0.66 * median))
    upper = int(min(255, 1.33 * median))
    if upper <= lower:
        lower, upper = 50, 150
    return cv2.Canny(blurred, lower, upper)


def _line_mask(gray, size_wh):
    """Mask of the long straight segments — the architecture, near enough."""
    cv2, np = _cv()
    width, height = size_wh
    long_edge = max(width, height)
    min_length = int(long_edge * _MIN_LINE_FRACTION)
    mask = np.zeros((height, width), dtype="uint8")
    segments = cv2.HoughLinesP(
        _canny(gray),
        rho=1,
        theta=3.14159265 / 180.0,
        threshold=60,
        minLineLength=min_length,
        maxLineGap=int(long_edge * 0.01),
    )
    if segments is None:
        return mask
    # OpenCV 4 returns (N, 1, 4) here and OpenCV 5 returns (N, 4). The images
    # pin 4.10, but reshaping costs nothing and keeps this working if they move.
    for x1, y1, x2, y2 in np.asarray(segments).reshape(-1, 4):
        cv2.line(mask, (int(x1), int(y1)), (int(x2), int(y2)), 255, 2)
    return mask


def _opening_mask(gray, size_wh):
    """Approximate window and glazed-door mask.

    Openings are the parts of a room or facade that sit at the extremes of the
    luminance histogram — blown-out daylight from inside, dark glazing from
    outside — and they are close to rectangular, which is what separates them
    from a pale wall or a dark shadow. Both extremes are taken because interior
    and exterior shots put openings at opposite ends.

    This is a proxy, not a segmentation model, and it does not need to be more:
    source and candidate are measured with the identical detector, so a
    systematic bias cancels and only the *change* is read.
    """
    cv2, np = _cv()
    width, height = size_wh
    frame_area = float(width * height)
    bright = gray >= np.percentile(gray, 96)
    dark = gray <= np.percentile(gray, 4)

    mask = np.zeros((height, width), dtype="uint8")
    for extreme in (bright, dark):
        candidate = (extreme.astype("uint8")) * 255
        candidate = cv2.morphologyEx(
            candidate, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9))
        )
        contours, _ = cv2.findContours(
            candidate, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
        for contour in contours:
            area = cv2.contourArea(contour)
            # Big enough to be an opening, small enough not to be the sky or a
            # whole wall in shadow.
            if area < frame_area * 0.004 or area > frame_area * 0.45:
                continue
            x, y, w, h = cv2.boundingRect(contour)
            if w * h == 0 or area / float(w * h) < 0.6:
                continue  # Not rectangular enough to be an opening.
            cv2.rectangle(mask, (x, y), (x + w, y + h), 255, -1)
    return mask


def _recall(reference, candidate, size_wh):
    """Fraction of ``reference`` pixels matched within the drift tolerance."""
    cv2, np = _cv()
    width, height = size_wh
    reference_count = int((reference > 0).sum())
    if not reference_count:
        # Nothing to preserve — a blank source cannot be betrayed, so this is a
        # pass rather than a zero that would veto every candidate.
        return 1.0
    radius = max(2, int(max(width, height) * _EDGE_TOLERANCE_FRACTION))
    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (radius * 2 + 1, radius * 2 + 1)
    )
    widened = cv2.dilate(candidate, kernel)
    matched = int(np.logical_and(reference > 0, widened > 0).sum())
    return matched / float(reference_count)


class StructureGuard:
    """Scores candidate renders against one source image's architecture."""

    def __init__(self, source, size_wh, accept_score=None):
        self.size_wh = size_wh
        self.accept_score = (
            float(accept_score)
            if accept_score is not None
            else _threshold("LIVINAI_STRUCTURE_ACCEPT", ACCEPT_SCORE)
        )
        self.min_line_recall = _threshold("LIVINAI_STRUCTURE_MIN_LINES", MIN_LINE_RECALL)
        self.min_opening_kept = _threshold(
            "LIVINAI_STRUCTURE_MIN_KEPT", MIN_OPENING_KEPT
        )
        self.max_opening_added = _threshold(
            "LIVINAI_STRUCTURE_MAX_ADDED", MAX_OPENING_ADDED
        )
        gray = _prepare(source, size_wh)
        self.source_edges = _canny(gray)
        self.source_lines = _line_mask(gray, size_wh)
        self.source_openings = _opening_mask(gray, size_wh)

    def evaluate(self, candidate) -> dict:
        """Measure one candidate. Returns the report; never raises on content."""
        cv2, np = _cv()
        width, height = self.size_wh
        gray = _prepare(candidate, self.size_wh)
        edges = _canny(gray)
        lines = _line_mask(gray, self.size_wh)
        openings = _opening_mask(gray, self.size_wh)

        edge_recall = _recall(self.source_edges, edges, self.size_wh)
        line_recall = _recall(self.source_lines, lines, self.size_wh)
        opening_kept = _recall(self.source_openings, openings, self.size_wh)

        # Opening area in the candidate with no source opening under it. The
        # source mask is dilated first so a window rendered slightly larger is
        # not counted as an invented one.
        radius = max(2, int(max(width, height) * _EDGE_TOLERANCE_FRACTION))
        kernel = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (radius * 2 + 1, radius * 2 + 1)
        )
        allowed = cv2.dilate(self.source_openings, kernel)
        added = int(np.logical_and(openings > 0, allowed == 0).sum())
        opening_added = added / float(width * height)

        score = 0.45 * line_recall + 0.25 * edge_recall + 0.30 * opening_kept
        # Ordered by how specific the diagnosis is, so the reported veto names
        # the most useful thing that went wrong rather than the first tripped.
        if opening_added > self.max_opening_added:
            veto = "invented_opening"
        elif opening_kept < self.min_opening_kept:
            veto = "lost_opening"
        elif line_recall < self.min_line_recall:
            veto = "structure_moved"
        else:
            veto = ""
        return {
            "score": round(score, 4),
            "line_recall": round(line_recall, 4),
            "edge_recall": round(edge_recall, 4),
            "opening_kept": round(opening_kept, 4),
            "opening_added": round(opening_added, 4),
            # The name of what went wrong, not just that something did — this is
            # the field that says whether the render grew a window or moved a
            # wall, and the two need different fixes.
            "veto": veto,
            "accepted": bool(score >= self.accept_score and not veto),
        }

    def accepts(self, report) -> bool:
        return bool(report.get("accepted"))

    @staticmethod
    def rank(report):
        """Sort key for choosing between candidates. Higher is better.

        Raw score cannot order these on its own, and the reason is worth
        stating: all three measurements are *recall* of the source's structure,
        so a render that invented an extra window loses nothing and can score a
        clean 1.0 — higher than a faithful render that merely re-rendered an
        edge slightly softer. Ranking on score alone therefore picked the
        candidate with the invented window, which is the exact bug the guard
        exists to prevent.

        So acceptance leads, and the score only breaks ties within a group. The
        overshoot penalty then orders the unaccepted group by how badly they
        failed, so "ship the best of a bad set" ships the least invented one.
        """
        overshoot = max(0.0, float(report.get("opening_added") or 0.0) - MAX_OPENING_ADDED)
        return (1 if report.get("accepted") else 0, float(report["score"]) - overshoot * 10.0)

    def best_of(self, render, base_seed: int, candidates: int):
        """Render until one preserves the architecture; return the best seen.

        ``render`` takes a seed and returns an image. The first seed is the
        brief's own, so a request whose first candidate passes — which is what
        should normally happen — costs exactly what it costs today and
        reproduces exactly for the same inputs.

        A rejected candidate is *not* an error. If nothing clears the bar the
        highest-scoring render is returned anyway, flagged as unaccepted. That
        is deliberate: the user paid for this design, the guard's thresholds are
        calibrated rather than proven, and shipping the most faithful of three
        imperfect renders is strictly better than shipping an error. The report
        carries the numbers so a run of unaccepted renders is visible in the
        logs rather than only in the pictures.
        """
        best_image = None
        best_report = None
        attempts = []
        for seed in seed_ladder(base_seed, candidates):
            image = render(seed)
            report = self.evaluate(image)
            report["seed"] = seed
            attempts.append(
                {
                    "seed": seed,
                    "score": report["score"],
                    "veto": report["veto"],
                }
            )
            if best_report is None or self.rank(report) > self.rank(best_report):
                best_image, best_report = image, report
            if self.accepts(report):
                break
        best_report["attempts"] = attempts
        best_report["candidates"] = len(attempts)
        return best_image, best_report


def seed_ladder(base_seed: int, count: int):
    """``count`` well-separated seeds, starting at the brief's own seed.

    The first is always the seed the brief hashes to, so an accepted first
    candidate — the common case — reproduces exactly for the same request. The
    rest are spaced by a large odd constant so a retry lands on genuinely
    different noise rather than on a neighbouring field.
    """
    base = int(base_seed) & 0x7FFFFFFF
    return [(base + index * 0x9E3779B1) & 0x7FFFFFFF for index in range(max(1, int(count)))]


def guard_candidates(default: int = 2) -> int:
    """How many renders a request may spend looking for a faithful one.

    Env-tunable because the right number is an operational trade — each extra
    candidate is a few more GPU-seconds against a lower chance of shipping a
    render that moved a wall — and because it wants to be turnable down without
    a redeploy of the prompt logic. 1 disables the search and leaves the guard
    reporting only.
    """
    import os

    try:
        value = int(os.environ.get("LIVINAI_STRUCTURE_CANDIDATES", default))
    except (TypeError, ValueError):
        return default
    return max(1, min(4, value))
