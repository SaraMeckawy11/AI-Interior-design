"""Livinai prompt architecture — shared by every AI surface.

This is the Gen-Klein prompt engine that the Livinai web studio uses, ported
here so the mobile app, the Modal service and the RunPod handlers all speak the
same language. The important properties, in order of impact on output quality:

1. **Geometry lock first.** The single biggest failure mode of image-editing
   models on real rooms is silently moving or inventing architecture. The
   geometry clause is stated before anything creative and phrased as a hard
   constraint, not a preference.
2. **Explicit programme.** "Redesign this bedroom" produces a mood board;
   naming the furniture a bedroom must contain produces a room.
3. **Explicit colour count.** Interiors use a named 60/30/10 scheme; exteriors
   use exactly the one, two or three facade colors the user selected.
4. **Placement and quality rules last**, so they act as a final filter over
   everything above.

`build_prompt` is model-agnostic and returns the long-form brief used by
FLUX.2 [klein]. `build_short_prompt` compresses the same brief into CLIP's
77-token budget for the Stable Diffusion + ControlNet path.
"""

from __future__ import annotations

import hashlib

STYLE_SPECS = {
    "modern": {
        "interior": "sculptural furniture, warm oak, honed travertine, boucle, linen, restrained brushed brass",
        "exterior": "clean volumes, large framed openings, warm limestone, timber fins, charcoal metal, restrained planting",
    },
    "japandi": {
        "interior": "low natural-linen furniture, pale oak, dark timber accents, handmade ceramics, paper lighting, quiet negative space",
        "exterior": "calm asymmetrical volumes, pale mineral render, vertical timber, dark slim frames, stone paths, sculptural planting",
    },
    "scandinavian": {
        "interior": "clean-lined furniture, pale matte oak, wool, linen, soft white walls, simple black details",
        "exterior": "simple pitched or crisp volumes, pale timber, warm white render, black frames, native low-maintenance planting",
    },
    "minimalist": {
        "interior": "low straight-lined furniture, seamless pale oak, smooth plaster, tonal textiles, concealed storage, very few objects",
        "exterior": "monolithic volumes, seamless mineral surfaces, concealed details, limited material palette, precise linear landscaping",
    },
    "modern minimalist": {
        "interior": "low straight-lined furniture, seamless pale oak, smooth plaster, tonal textiles, concealed storage, very few objects",
        "exterior": "monolithic volumes, seamless mineral surfaces, concealed details, limited material palette, precise linear landscaping",
    },
    "classic": {
        "interior": "tailored furniture, herringbone oak, marble, silk and velvet, subtle moulding, antique brass",
        "exterior": "balanced classical proportions, natural limestone, refined cornices, dark bronze frames, clipped formal planting",
    },
    "traditional": {
        "interior": "tailored furniture, herringbone oak, marble, silk and velvet, subtle moulding, antique brass",
        "exterior": "balanced classical proportions, natural limestone, refined cornices, dark bronze frames, clipped formal planting",
    },
    "industrial": {
        "interior": "cognac leather, reclaimed timber, blackened steel, textured plaster, aged brass, worn neutral textiles",
        "exterior": "dark steel frames, brick or board-formed concrete, large industrial glazing, weathered timber, architectural grasses",
    },
    "bohemian": {
        "interior": "relaxed low seating, rattan, layered natural textiles, jute, terracotta, vintage objects, abundant plants",
        "exterior": "limewashed surfaces, handmade tile, timber pergolas, woven shade, terracotta, layered drought-tolerant planting",
    },
    "mediterranean": {
        "interior": "limewashed plaster, warm stone, aged oak, linen, handmade tile, softly curved forms, aged bronze",
        "exterior": "warm limewashed masonry, natural stone, arched accents only where architecture allows, timber, terracotta, olive planting",
    },
    "mid-century modern": {
        "interior": "walnut casegoods, tapered legs, low-slung seating, wool boucle, ceramic and glass accents, warm ochre and olive",
        "exterior": "low horizontal volumes, post-and-beam expression, warm timber cladding, clerestory glazing, gravel and grasses",
    },
    "contemporary": {
        "interior": "soft-edged furniture, layered neutral textiles, warm timber, matte stone, sculptural lighting",
        "exterior": "crisp contemporary massing, mixed render and timber, slim dark frames, structured contemporary planting",
    },
}

# Literal prompt programme from C:\Sara\Interior_design\Gen_klein.py.
#
# Keep this separate from STYLE_SPECS: the latter serves the exterior and
# ControlNet paths too, while this table is the exact FLUX.2 Klein room-editing
# recipe the standalone reference script uses.
GEN_KLEIN_STYLE_SPECS = {
    "modern": dict(
        sofa="a sculptural curved sofa with a velvet back and boucle seat",
        table="a round travertine pedestal coffee table",
        floor="wide-plank warm honey oak laid straight",
        rug="a LARGE chunky-woven jute rug",
        curtains="cream double-layer drapery, sheer plus linen panels",
        art="an oversized abstract artwork",
        plants="tall olive trees in matte travertine planters",
        lamp="a brass floor lamp with tapered fabric shade",
        ceiling="ONE wide brass disc pendant close under the ceiling",
        textures="boucle, velvet, travertine, jute and warm oak, subtle brass; warm golden ambience",
    ),
    "classic": dict(
        sofa="a tailored roll-arm sofa with carved wooden legs",
        table="a rectangular marble-top coffee table with carved legs",
        floor="herringbone oak parquet",
        rug="a LARGE bordered wool rug",
        curtains="heavy pleated drapery with elegant tiebacks",
        art="a large framed classical painting",
        plants="sculpted plants in ceramic urns",
        lamp="a column floor lamp with a pleated shade",
        ceiling="ONE crystal chandelier on a short chain, close to the ceiling",
        textures="rich deeper accents; silk, velvet, marble and dark polished wood, antique gold details; stately warm mood",
    ),
    "scandinavian": dict(
        sofa="a clean-lined fabric sofa on tapered wooden legs",
        table="a round pale-wood coffee table",
        floor="pale matte oak boards",
        rug="a LARGE soft wool rug",
        curtains="airy white linen curtains",
        art="simple framed line-art prints",
        plants="a leafy plant in a simple white pot",
        lamp="a minimalist tripod floor lamp",
        ceiling="ONE small dome pendant close to the ceiling",
        textures="muted tone-on-tone accents; wool, linen, pale birch and sheepskin, matte black details; bright airy calm",
    ),
    "boho": dict(
        sofa="a relaxed low sofa with layered patterned cushions",
        table="a round carved-wood or rattan coffee table",
        floor="warm rustic wood boards",
        rug="LAYERED patterned rugs",
        curtains="light flowing natural-cotton curtains",
        art="an eclectic mix of woven and framed wall pieces",
        plants="abundant potted and trailing plants in terracotta and baskets",
        lamp="a woven rattan floor lamp",
        ceiling="ONE woven rattan pendant close to the ceiling",
        textures="earthy playful accents; rattan, macrame, layered woven textiles, jute and terracotta; relaxed sunlit warmth",
    ),
    "japandi": dict(
        sofa="a low clean-lined sofa in natural linen",
        table="a low round dark-wood coffee table",
        floor="light matte wood boards",
        rug="a LARGE flat-woven neutral rug",
        curtains="plain linen panels",
        art="one minimal ink-brush artwork",
        plants="a single sculptural branch arrangement in a stone vessel",
        lamp="a paper-lantern floor lamp",
        ceiling="ONE round paper lantern close to the ceiling",
        textures="quiet deeper accents; linen, pale and dark wood, stone and paper, matte black; serene zen calm",
    ),
    "industrial": dict(
        sofa="a cognac leather sofa",
        table="a rectangular reclaimed-wood and black steel coffee table",
        floor="wide dark wood boards",
        rug="a LARGE worn-look neutral rug",
        curtains="simple dark linen panels",
        art="large monochrome photography prints",
        plants="a tall plant in a black metal planter",
        lamp="a black tripod spotlight floor lamp",
        ceiling="ONE black metal ceiling light close to the ceiling",
        textures="bold contrast accents; leather, black steel, reclaimed wood and aged brass; moody warm light",
    ),
    "minimalist": dict(
        sofa="a low straight-lined sofa in soft neutral fabric",
        table="a low rectangular seamless coffee table",
        floor="seamless pale oak boards",
        rug="a LARGE plain low-pile rug",
        curtains="plain full-height panels near the wall tone",
        art="one single large calm artwork",
        plants="one sculptural plant in a plain pot",
        lamp="a slim unobtrusive floor lamp",
        ceiling="ONE discreet flush ceiling light",
        textures="subtle tone-on-tone accents; smooth plaster, pale wood and soft matte fabric; serene uncluttered light",
    ),
}

GEN_KLEIN_FURNITURE_BY_ROOM = {
    "living room": None,  # Filled from the selected style below.
    "bedroom": (
        "an upholstered bed with layered premium bedding, two nightstands "
        "with warm lamps, and a bench at the foot of the bed"
    ),
    "dining room": (
        "a solid-wood dining table with sculptural chairs and a styled "
        "sideboard"
    ),
    "kitchen": (
        "fitted cabinetry with stone countertops, a breakfast counter with "
        "designer stools, and integrated appliances"
    ),
    "home office": (
        "a wide desk with a refined chair, full bookshelves, and a reading "
        "armchair"
    ),
    "kids room": (
        "a cozy bed with playful bedding, a study desk, a soft rug, and "
        "generous storage"
    ),
    "bathroom": (
        "a floating stone-top vanity with a backlit mirror, a glass shower, "
        "and premium tile"
    ),
}


#: What the render is a render *of*. Interiors reach this engine from two very
#: different surfaces and they fail in opposite directions, so each gets its own
#: geometry lock rather than one wording compromised for both.
PHOTO_SOURCE = "photo"
WALKTHROUGH_SOURCE = "walkthrough"

_ARCHITECTURE_LOCKS = {
    # A photograph of a real room. The model will silently move or invent an
    # opening unless it is told what preserving one means, so this spells it out
    # and claims the only priority marker in the brief.
    #
    # Two things were added after users reported rooms coming back the wrong
    # shape. "Same count" was already here and was still not enough, because the
    # brief never said the *shell* was fixed — so a render could keep three
    # windows and still hand back a wider room with a different ceiling. And the
    # override sentence matters: everything below this block asks for a design,
    # and without it the design and the lock read as peers.
    PHOTO_SOURCE: (
        "ARCHITECTURE - HIGHEST PRIORITY, OVERRIDES EVERYTHING BELOW:\n"
        "- The shell is fixed: every wall, corner, ceiling and floor edge stays on "
        "the same pixels; the room keeps its size, shape and proportions.\n"
        # Windows get their own line because they fail in more ways than doors
        # do, and every one of these was a render somebody was shown: a window
        # widened to suit the new scheme, dropped to the floor as glazing,
        # walled over because the furniture wanted that elevation, or left
        # technically present but buried behind full-height drapery.
        "- WINDOWS ARE UNTOUCHABLE: copy each exactly - same count, position, "
        "outline, width, height, sill and frame bars. Never widen, narrow, "
        "shorten, extend one to the floor, reshape one, make one a door, wall one "
        "over, or hide one behind drapery.\n"
        "- Doors and other openings: same rule, add, remove, move or resize none.\n"
        # The tail of this line is the other half of the shell lock. "Every wall
        # stays on the same pixels" was read as keeping what the wall was *made
        # of*, and rooms came back with the original masonry still on them under
        # new furniture. It is stated in the positive and without naming a
        # single unwanted material: listing the finishes that were surviving, in
        # order to forbid them, only painted them back on.
        # "Evenly, corner to corner" is aimed at the way this actually fails.
        # It is not that a wall keeps its old finish outright — it is that
        # patches of it survive, because a four-step edit leaves high-frequency
        # detail alone unless something pushes it to change. So the instruction
        # is about the finish being continuous, not merely about it being new.
        "- Camera, lens, framing and perspective stay identical. Change finishes "
        "and movable contents only: every surface refinished evenly, corner to corner.\n"
    ),
    # A frame captured out of the 3D walkthrough. Its openings are the user's own
    # plan geometry, already exactly where they asked for them — the problem here
    # is not drift, it is that the source is a crude massing model. Enumerating
    # sill heights and shapes over it held the render to those crude shapes
    # instead of designing the room, so this asks only for what the frame is:
    # the geometry stays, the finishes and contents become a design.
    WALKTHROUGH_SOURCE: (
        "ARCHITECTURE:\n"
        "- Change finishes and movable contents only. Preserve all walls, doors, "
        "windows, balcony openings and camera framing, at the same count and in "
        "the same places, each window keeping its outline and proportions. Add no "
        "opening that is not already there.\n"
    ),
}


def design_seed(
    *,
    space_type: str = "",
    design_style: str = "",
    color_tone: str = "",
    color_palette=None,
    mode: str = "interior",
    variation=0,
) -> int:
    """A stable starting seed that differs for every different brief.

    Both image-editing paths used to pin the seed: interiors to a literal 7,
    exteriors to ``7 + creativity * 97``. Creativity is a fixed 42 for every
    space the app offers except Building, so in practice *every* render in the
    app started from one of two noise fields. That is why a kitchen and a
    bedroom came back as the same arrangement wearing different furniture — the
    prompt changed, the noise did not, and at four steps the noise decides the
    composition.

    Hashing the brief means a bedroom and a kitchen can no longer land on the
    same layout, while the same request twice still reproduces exactly. The
    ``variation`` the client sends is what makes a deliberate re-roll differ.
    """
    palette = ""
    if isinstance(color_palette, dict):
        names = _palette_names(color_palette)
        palette = "|".join(names) if names else ""
    material = "␟".join(
        str(part or "").strip().lower()
        for part in (space_type, design_style, color_tone, palette, mode, variation)
    )
    # 31 bits: torch generators want a non-negative int, and this stays well
    # inside every platform's seed range.
    return int(hashlib.sha256(material.encode("utf-8")).hexdigest()[:8], 16) & 0x7FFFFFFF


def resolve_render_source(source) -> str:
    """``walkthrough`` for a captured 3D frame, ``photo`` for anything else.

    Unrecognised and absent values mean photo, so a client that does not send
    the field — every build before this one — keeps the brief it had.
    """
    value = str(source or "").strip().lower()
    return WALKTHROUGH_SOURCE if value == WALKTHROUGH_SOURCE else PHOTO_SOURCE


#: Space names that mean "a whole home seen from above", not one room seen from
#: inside it. The walkthrough sends this when the render is taken from its plan
#: view rather than from the walking camera.
FLOOR_PLAN_SPACES = {"floor plan", "floorplan", "plan", "3d floor plan"}


def is_floor_plan(space_type) -> bool:
    """Whether the input image is a plan of a home rather than a room photo."""
    return str(space_type or "").strip().lower() in FLOOR_PLAN_SPACES


def build_floor_plan_prompt(*, design_style: str, color_rule: str) -> str:
    """Return the brief for a plan-view render of a whole home.

    The plan is the picture. Everything else is negotiable, and this is the
    wording that keeps it.

    Read the history here before changing it, because it has been round this
    loop twice and both detours failed the same way.

    The first brief asked, in detail, for every room to be furnished — seating
    and rugs, beds and nightstands, fitted kitchen runs. Over a four-step edit
    at guidance 1.0 that reads as "produce this scene", and the layout is what
    gets spent producing it.

    The second tried to have both: keep the architecture, but rebuild the
    furniture, on the reasoning that the blocks the walkthrough draws are
    crude. It opened as a caption rather than an instruction to edit
    ("Photorealistic architectural visualisation of this apartment, designed
    by a senior interior designer"), called the contents "placeholders", and
    said "replace every placeholder block". Every one of those is a licence to
    redraw the frame, and the plan went with it.

    That is not a wording problem, it is the shape of the tool. A four-step
    image edit cannot build furniture that is not in the input without being
    allowed to redraw the input, and redrawing the input loses the walls. So
    this asks only for what an edit can actually give: the same model, made of
    real materials instead of flat colour. Crude furniture rendered honestly is
    a far better picture than a beautiful room that is not the person's home.

    If the furniture itself needs to be better — and it does — that is work in
    the exporter's own geometry, not in this string.
    """
    style = design_style or "Modern"
    return (
        "Re-render this image as a photorealistic architectural model. It is a "
        "3D cutaway model of one apartment with the ceilings removed, seen from "
        "above, and it is already finished: every wall, room and piece of "
        "furniture is where it belongs.\n\n"
        "COPY THE MODEL EXACTLY - HIGHEST PRIORITY:\n"
        "- Same layout: the same outline, the same walls in the same places, "
        "the same rooms at the same sizes and proportions, the same doors and "
        "windows in the same openings.\n"
        "- Same contents: every piece of furniture stays the same piece, in the "
        "same place, at the same size and the same angle. Add nothing, remove "
        "nothing, move nothing, resize nothing.\n"
        "- Same view: keep the camera, angle, framing, scale and orientation "
        "identical. Do not rotate, re-centre, crop or level it. No roof and no "
        "ceilings — every room stays open from above.\n\n"
        "CHANGE THE SURFACES, AND ONLY THE SURFACES:\n"
        f"- Give the flat model shapes real materials in a refined {style} "
        "style: believable floors, painted walls, upholstery, timber, stone, "
        "metal and glass, with visible weave, grain and edge detail.\n"
        f"- COLOR: {color_rule} — lightest over floors and walls, mid-tones on "
        "upholstery and rugs, the deepest color in a few small touches.\n"
        "- Light it like a photographed architectural model: soft even daylight "
        "from above, a contact shadow under every object, no hard sun.\n"
        "- No text, labels, dimensions, arrows, people, watermark, and no "
        "second copy of the plan anywhere in the frame."
    )


#: Everything that is true of one room type and not of the others.
#:
#: This table exists because the brief used to state most of it once, for every
#: room. "Group seating around a correctly sized rug", "one floor lamp beside
#: seating" and "mid-tones on upholstery, curtains and rugs" were sent to the
#: model whether it was designing a living room or a kitchen — which is exactly
#: why kitchens came back with armchairs and a rug on the floor. A room's brief
#: now names its own furniture, its own lighting, its own styling, and, most
#: importantly, what it must never contain.
#:
#: Each entry carries:
#:   programme — the functions the room must resolve
#:   hero      — the one piece the room is judged on, and its honest materials
#:   decor     — styling appropriate to this room and no other
#:   limits    — how much lighting and greenery this room type may have
#:   forbid    — the furniture that does not belong here, stated as a negative
#:   layouts   — credible arrangements, one picked per render (see below)
#:
#: `layouts` is the other half of the "every room looks the same" fix. A single
#: arrangement sentence shared by every render made every living room the same
#: living room; rotating through a few genuinely different, equally valid plans
#: means two runs of the same room diverge in structure and not just in colour.
ROOM_BRIEFS = {
    "living room": dict(
        # The everyday sitting room, so it gets the television — named as a
        # wall-mounted set over a low unit, because "a TV" on its own is
        # rendered as a floating black rectangle with nothing under it.
        # Counted, and stated as a positive. "Sofa and complementary seating"
        # left the number open and the model filled it with a second sofa, which
        # then had to stand somewhere — usually against the media wall, in front
        # of the television. Saying "one sofa and one or two lounge chairs"
        # fixes the count without ever writing the words "no second sofa": a
        # diffusion text encoder reads the nouns and barely the negation, so
        # forbidding a sofa by name is a good way to get another one.
        # The chairs are given a form of their own. A designer does not repeat
        # the sofa in miniature: the chairs are a lighter, distinct shape that
        # answers it, which is also what stops them reading as spare seating
        # pushed in from the edge of the room.
        programme=(
            "one sofa and two lounge chairs of a lighter, distinct shape facing "
            "a wall-mounted TV on a low media unit"
        ),
        hero=(
            "The coffee table is the hero piece: one sculptural low table in "
            "{material}, centred on the rug"
        ),
        materials=(
            "honed travertine",
            "solid walnut with a softened edge",
            "slim blackened steel and glass",
        ),
        decor=(
            "layered cushions, a folded throw, one large artwork at eye level, one "
            "tight group per surface - books, a tray, a ceramic"
        ),
        limits="one ceiling fixture, one floor lamp beside the seating, one potted floor plant",
        forbid="no bed, no desk, no dining table, no kitchen cabinetry, no sanitaryware",
        # The first of these caused the reported failure outright: the longest
        # solid wall is the media wall, so "set the sofa square to the longest
        # solid wall" is an instruction to put the sofa where the television is.
        # The second offered "a console table behind the sofa", which merges
        # with the media console. All three now seat the sofa by where the TV
        # is, which is how the arrangement is actually decided.
        # Where the chairs sit in *depth* matters as much as where they sit in
        # plan. A pair of chairs standing together in the near foreground fills
        # the bottom of the frame and reads as furniture pushed at the camera,
        # so wherever they are paired they belong at the far end of the room.
        # "Far corners" was not enough on its own — a corner can be the near one.
        layouts=(
            "Set the sofa on the wall facing the TV, both chairs angled in from the corners furthest from the camera, rug under every front leg.",
            "Float the sofa off the wall facing the TV, the chairs together at the room's far end, away from the camera.",
            "Run an L-shaped sofa into the corner that faces the TV, the chairs beyond it at the far end from the camera.",
        ),
    ),
    "living + dining": dict(
        programme=(
            "one room zoned twice - one sofa facing a wall-mounted TV on a low "
            "media unit, a dining table and chairs beyond it"
        ),
        hero=(
            "The dining table is the hero piece: one {material} table with "
            "matched chairs, answered by a coffee table"
        ),
        materials=("solid oak", "honed stone", "stained ash"),
        decor=(
            "cushions and a folded throw on the seating, one artwork per zone at "
            "eye level, one low centrepiece on the table"
        ),
        limits="one pendant over the dining table, one floor lamp beside the seating, one potted floor plant",
        forbid="no bed, no desk, no kitchen cabinetry, no sanitaryware",
        layouts=(
            "Put the dining zone nearest the window and the seating nearest the solid wall.",
            "Back the sofa onto the dining zone so it divides the room, a chair's depth clear round the table.",
            "Run both zones along the room's long axis, each on its own rug, sharing one route to the door.",
        ),
    ),
    "salon": dict(
        # A salon is for receiving people, not for watching anything. Ruling out
        # the media unit as well as the TV matters: told only "no TV", the model
        # renders the console and leaves the wall above it bare, which reads as
        # a living room with the television switched off.
        programme=(
            "a formal reception room: matched seating in facing pairs around an "
            "open centre, occasional tables within reach of every seat, no media wall"
        ),
        hero=(
            "The seating suite is the hero piece: matched tailored sofas and chairs "
            "in one fabric, facing each other across the rug"
        ),
        decor=(
            "matched cushions, one large artwork at eye level, one group on each "
            "occasional table - a ceramic, a tray, candles"
        ),
        limits="one ceiling fixture, matched table or floor lamps in pairs, one potted floor plant",
        forbid=(
            "no TV, no media unit, no dining table, no bed, no desk, no kitchen "
            "cabinetry, no sanitaryware"
        ),
        layouts=(
            "Face two matched sofas across the rug, with the occasional tables at the ends.",
            "Line the seating along three walls around an open centre, leaving the fourth for the entrance.",
            "Set a symmetrical suite on the room's centre line, anchored on the fireplace or largest solid wall.",
        ),
    ),
    "salon + dining": dict(
        programme=(
            "a formal reception room that also dines: perimeter seating round an "
            "open centre at one end, a dining table and chairs at the other"
        ),
        hero=(
            "The dining table is the hero piece: one formal {material} table with "
            "matched chairs, answered by a seating suite"
        ),
        materials=("polished walnut", "veined marble", "lacquered ebony"),
        decor=(
            "matched cushions on the suite, one large artwork at eye level, one low "
            "centrepiece on the table"
        ),
        limits="one pendant over the dining table, matched lamps in pairs beside the seating, one potted floor plant",
        forbid="no TV, no media unit, no bed, no desk, no kitchen cabinetry, no sanitaryware",
        layouts=(
            "Put the table nearest the window and the seating suite around the open centre at the far end.",
            "Line the seating along three walls and set the table on the room's centre line beyond it.",
            "Run both zones along the long axis, symmetrical about one centre line, sharing a route to the door.",
        ),
    ),
    "bedroom": dict(
        programme="a restful sleeping area, useful bedside surfaces and calm closed storage",
        hero=(
            "The bed is the hero piece: a well-proportioned headboard in "
            "{material}, crisp layered bedding and two matched nightstands"
        ),
        materials=("upholstered wool boucle", "channel-tufted linen", "soft-edged leather"),
        decor=(
            "one large artwork above the headboard, a folded throw across the foot "
            "of the bed, and one small group on each nightstand"
        ),
        limits="one ceiling fixture, two matched bedside lights, one potted floor plant",
        forbid="no sofa, no TV, no dining table, no kitchen cabinetry, no sanitaryware",
        layouts=(
            "Centre the headboard on the largest solid wall, with the rug running past both sides of the bed.",
            "Face the bed towards the window wall and put the closed storage on the wall behind the door.",
            "Set the bed against the solid wall off-centre, and give the freed corner a bench or a reading chair.",
        ),
    ),
    # The room the whole complaint was about. `forbid` is deliberately the
    # longest in the table and names the pieces that actually turned up:
    # armchairs, a coffee table, a rug. Counter stools are allowed, but only
    # against an island the worktop really forms — otherwise "stools" is read as
    # licence for loose seating again.
    "kitchen": dict(
        programme=(
            "fitted floor and wall cabinetry on the existing walls, a continuous "
            "worktop, sink, hob, integrated appliances, under-cabinet task light"
        ),
        hero=(
            "The cabinetry run is the hero piece: {material} worktops, flush "
            "handleless fronts, one considered splashback"
        ),
        materials=("honed stone", "veined marble", "matte composite"),
        decor="one counter group - a board, a bowl, a ceramic - and clear worktop elsewhere",
        limits=(
            "one ceiling fixture, or pendants over an island the room can hold; "
            "no floor lamp or plant"
        ),
        forbid=(
            "no sofa, armchair, coffee table, dining table, bed, desk, TV or area "
            "rug; seating only as counter stools at an island"
        ),
        layouts=(
            "Keep the sink, hob and fridge within one easy triangle and the floor between them clear.",
            "Run the tall units and appliances along one wall and keep the opposite run low and unbroken.",
            "Wrap the worktop into an L and leave the route to the door at full width.",
        ),
    ),
    "bathroom": dict(
        programme=(
            "a vanity with basin and mirror, a bathing or shower zone on the "
            "existing plumbing wall, storage and damp-safe lighting"
        ),
        hero=(
            "The vanity is the hero piece: a well-proportioned stone top, honest "
            "cabinetry and one considered mirror and light"
        ),
        decor="folded towels, one framed piece at eye level, a small tray with a ceramic and a candle",
        limits="one ceiling fixture and one mirror light; no floor lamp; at most one small plant on a surface",
        forbid=(
            "no sofa, armchair, bed, desk, TV, dining furniture, kitchen cabinetry "
            "or area rug; seating only as one compact stool"
        ),
        layouts=(
            "Leave every fitting on the wall it already stands on and keep the door swing clear.",
            "Run the vanity along the longest wall and glaze the shower into the far corner.",
            "Face the vanity and the bathing zone across the room from each other, with a clear walkway between.",
        ),
    ),
    "dining room": dict(
        programme=(
            "a correctly scaled dining group, room to pull every chair out, and a "
            "sideboard only where circulation allows"
        ),
        hero=(
            "The dining table is the hero piece: one well-proportioned {material} "
            "table with matched sculptural chairs"
        ),
        materials=("solid oak", "honed stone", "warm walnut"),
        decor=(
            "one large artwork at eye level, a linen runner, and one low centrepiece "
            "group - a bowl, a ceramic and candles"
        ),
        limits="one pendant or one matched row centred over the table, one potted floor plant; no floor lamp",
        forbid="no bed, no sofa, no desk, no TV, no media unit, no kitchen cabinetry, no sanitaryware",
        layouts=(
            "Centre the table under the light with at least a chair's depth clear on every side.",
            "Set the table to one side of the room and run a low sideboard along the opposite wall.",
            "Lay the table's long axis along the room's long axis, with a bench on the window side.",
        ),
    ),
    "balcony": dict(
        programme=(
            "a weather-safe floor finish, compact outdoor seating and a small table, "
            "and planting that blocks neither the door nor the drainage"
        ),
        hero=(
            "The seating is the hero piece: one weatherproof pair of chairs or a "
            "bench in teak, powder-coated metal or rope, with a small table"
        ),
        decor="outdoor cushions, one lantern, grouped planters against the railing",
        limits="one wall or ceiling light and one string of warm outdoor lighting; two or three planters",
        forbid=(
            "no indoor upholstery, bed, desk, TV, dining suite, kitchen cabinetry "
            "or sanitaryware; nothing blocking the door or railing"
        ),
        layouts=(
            "Set the seating against the solid wall facing out, planters along the railing.",
            "Tuck the seating into one end and keep the rest of the floor clear to the railing.",
            "Face two chairs across a small table at the outward corner, planting behind them.",
        ),
    ),
    "office": dict(
        programme="an ergonomic work area, closed and open storage, and layered task light",
        hero=(
            "The desk is the hero piece: one well-proportioned solid-topped desk "
            "with a refined chair and aligned shelving"
        ),
        decor=(
            "one artwork at eye level, a short row of books, and one small group on "
            "the desk - a tray, a ceramic, a lamp"
        ),
        limits="one ceiling fixture, one task lamp on the desk, one potted floor plant",
        forbid="no bed, no TV, no dining table, no kitchen cabinetry, no sanitaryware",
        layouts=(
            "Set the desk square to the window so the light falls across it, not into the screen.",
            "Face the desk into the room with full-height shelving on the wall behind it.",
            "Run the desk along the longest wall and put a single reading chair in the far corner.",
        ),
    ),
    "kids room": dict(
        programme=(
            "a safe sleeping zone, a study surface, clear floor to play on, and "
            "storage a child can reach"
        ),
        hero=(
            "The bed is the hero piece: a well-proportioned frame in honest timber "
            "with calm bedding and one playful accent"
        ),
        decor=(
            "two or three small framed pieces hung at child height, a soft rug, and "
            "a few tidy toys in open baskets"
        ),
        limits="one ceiling fixture, one bedside light and one desk lamp; no floor lamp",
        forbid="no sofa, no TV, no dining table, no kitchen cabinetry, no sanitaryware, no adult formal furniture",
        layouts=(
            "Put the bed against the solid wall and the desk under the window, with the play floor between them.",
            "Tuck the bed into the corner furthest from the door and run the storage along the opposite wall.",
            "Set the bed and desk on the same wall, leaving the whole opposite side as clear play floor.",
        ),
    ),
    "closet": dict(
        programme=(
            "full-height hanging, shelving and drawer stacks, a mirror, and even "
            "shadow-free light"
        ),
        hero=(
            "The hanging run is the hero piece: aligned rails, matched shelving and "
            "honest timber or lacquered fronts"
        ),
        decor="neatly folded stacks, a few matched boxes, and one small tray of accessories",
        limits="one ceiling fixture and integrated shelf lighting; no floor lamp; no plant",
        forbid=(
            "no bed, no sofa, no desk, no TV, no dining table, no kitchen "
            "cabinetry, no sanitaryware; seating only as one compact island bench"
        ),
        layouts=(
            "Run hanging along both long walls with the drawers between them and the mirror on the end wall.",
            "Line one wall with full-height hanging and face it with open shelving and a bench.",
            "Wrap the storage into a U and keep the centre of the floor completely clear.",
        ),
    ),
    "laundry room": dict(
        programme=(
            "washer and dryer side by side or stacked, a folding surface, a sink "
            "where the plumbing allows, and closed storage"
        ),
        hero=(
            "The worktop over the appliances is the hero piece: one durable "
            "continuous top with matched cabinetry above and below"
        ),
        decor="one basket, folded linen, and a single small group on the worktop",
        limits="one ceiling fixture and under-cabinet task light; no floor lamp; no floor plant",
        forbid=(
            "no sofa, no armchair, no bed, no desk, no TV, no dining table, no "
            "coffee table and no area rug"
        ),
        layouts=(
            "Run the appliances and worktop along one wall with tall storage at the end.",
            "Stack the appliances into a tall bay and give the rest of the wall a folding counter.",
            "Face the appliance run with a narrow counter, leaving a full-width walkway between.",
        ),
    ),
    "hallway": dict(
        programme=(
            "an unobstructed route, a durable continuous floor, restrained wall art "
            "and even lighting"
        ),
        hero=(
            "The floor is the hero piece: one continuous, well-laid finish running "
            "the length of the space"
        ),
        decor="a small run of framed pieces at eye level and one narrow runner",
        limits="one ceiling fixture or a matched row; no floor lamp; at most one potted plant against a wall",
        forbid=(
            "no sofa, no bed, no dining table, no desk, no TV, no kitchen "
            "cabinetry, no sanitaryware; nothing that narrows the walkway"
        ),
        layouts=(
            "Keep the full width of the floor clear and hang the art in one aligned run.",
            "Put a single narrow console against the longest blank wall and leave everything else open.",
            "Light the route evenly from the ceiling and let the floor finish carry the whole space.",
        ),
    ),
    "entryway": dict(
        programme=(
            "a console or bench, a mirror, concealed coat and shoe storage, and a "
            "durable floor finish"
        ),
        hero=(
            "The console or bench is the hero piece: one well-proportioned piece "
            "in {material} with a mirror above it"
        ),
        materials=("solid oak", "honed stone", "lacquered timber"),
        decor="a tray for keys, one ceramic, and a single framed piece or mirror at eye level",
        limits="one ceiling fixture, one wall light or table lamp, one potted floor plant",
        forbid="no sofa, no bed, no dining table, no desk, no TV, no kitchen cabinetry, no sanitaryware",
        layouts=(
            "Set the console against the wall facing the door with the storage beside it.",
            "Run a bench along one wall with hooks and closed shoe storage above and below.",
            "Keep the floor clear to the door and put every piece on the one wall that allows it.",
        ),
    ),
    "basement": dict(
        programme=(
            "a zoned multipurpose room: one sofa facing a wall-mounted TV over a "
            "low media unit, warm layered light, moisture-tolerant finishes"
        ),
        hero=(
            "The seating group is the hero piece: one generous sofa in {material} "
            "with a low table on a grounded rug"
        ),
        materials=("hard-wearing wool", "brushed cotton canvas", "worn leather"),
        decor="layered cushions, a folded throw, one large artwork, and one tight group per surface",
        limits="one ceiling fixture, one floor lamp beside the seating, one potted floor plant",
        forbid="no bed, no dining suite, no kitchen cabinetry, no sanitaryware",
        layouts=(
            "Set the seating against the longest wall facing the media zone, with storage behind it.",
            "Zone the room in two - seating at one end, a games or work surface at the other.",
            "Float the seating on a rug in the middle and line the walls with low closed storage.",
        ),
    ),
    # Not one room: a whole flat seen from inside it. The brief has to say that
    # explicitly, because every other entry in this table is written for one room
    # and the model will happily furnish an open plan as a single living room.
    "full apartment": dict(
        programme=(
            "each zone for its own use - sitting with one sofa facing a "
            "wall-mounted TV over a media unit, dining, cooking, circulation"
        ),
        hero=(
            "Give each zone one hero piece, and let one flooring and one wall finish "
            "run continuously between them"
        ),
        decor="one large artwork per zone at eye level, and one tight group per surface",
        limits="one ceiling fixture per zone, one floor lamp beside the seating, one potted floor plant per zone",
        forbid=(
            "no bed in a sitting, cooking or dining zone; no sanitaryware outside a "
            "bathroom; nothing standing in the route between zones"
        ),
        layouts=(
            "Put the cooking zone on its existing wall, dining beside it, and seating furthest from the door.",
            "Back the sofa onto the dining zone so the furniture itself divides the plan.",
            "Run the zones along one axis with a single clear route past all of them.",
        ),
    ),
}

#: Names the app or a user may send for a room this table already describes.
ROOM_BRIEF_ALIASES = {
    "home office": "office",
    "study": "office",
    "guest room": "bedroom",
    "master bedroom": "bedroom",
    "kids bedroom": "kids room",
    "children room": "kids room",
    "walk-in closet": "closet",
    "wardrobe": "closet",
    "dressing room": "closet",
    "laundry": "laundry room",
    "utility room": "laundry room",
    "corridor": "hallway",
    "foyer": "entryway",
    "hall": "entryway",
    "living and dining": "living + dining",
    "living dining": "living + dining",
    "salon and dining": "salon + dining",
    "salon dining": "salon + dining",
    "reception": "salon",
    "open plan": "full apartment",
    "whole apartment": "full apartment",
    "studio": "full apartment",
    "sitting room": "living room",
    "lounge": "living room",
    "terrace": "balcony",
    "sunroom": "balcony",
    "attic": "basement",
    "powder room": "bathroom",
    "toilet": "bathroom",
    "wc": "bathroom",
}

#: What an unrecognised room type gets. A user can type any room name they like
#: into the selector, so this has to be a usable brief and not a placeholder —
#: but it must not smuggle in a sofa, which is what made every custom room read
#: as a living room.
_GENERIC_ROOM_BRIEF = dict(
    programme="the essential functions this room type actually needs, and nothing from another room",
    hero="Give the room one well-proportioned hero piece in an honest material and let everything else support it",
    decor="one artwork at eye level and one tight group per surface at varied heights",
    limits="one ceiling fixture, at most one additional lamp, at most one potted floor plant",
    forbid="nothing that belongs to a different room type",
    layouts=(
        "Arrange the furniture square to the room's own walls and keep the centre of the floor open.",
        "Anchor the main pieces on the longest solid wall and leave the window wall clear.",
        "Zone the room around its one focal point and keep every route through it unobstructed.",
    ),
)


def room_brief(space_type: str) -> dict:
    """The per-room brief for ``space_type``, following aliases."""
    key = str(space_type or "").strip().lower()
    key = ROOM_BRIEF_ALIASES.get(key, key)
    return ROOM_BRIEFS.get(key, _GENERIC_ROOM_BRIEF)


def build_gen_klein_interior_prompt(
    *,
    space_type: str,
    design_style: str,
    color_tone: str,
    color_palette=None,
    source: str = PHOTO_SOURCE,
    variation_index: int = 0,
    compact: bool = False,
) -> str:
    """Return a flexible, whole-room brief that leaves architecture untouched.

    ``compact`` drops the styling and color-distribution detail, which is worth
    roughly 45 words. It exists for one case: a room name long enough — a custom
    one the user typed — to push the brief past Qwen3's 512-token ceiling. The
    engine used to raise there, which turns a paid render into an error; it now
    asks for this version instead. The architecture lock and the room's own
    programme, limits and exclusions survive, because those are the parts a
    render cannot be correct without.
    """
    room_type = space_type or "Living Room"
    style = design_style or "Modern"
    tone = color_tone or "Neutral"

    def swatch(entry, fallback):
        """The swatch name only.

        The hex code used to be appended here. It cost ~29 of the 512 tokens
        this brief is allowed for three swatches while carrying almost nothing
        the text encoder can act on — the name is what it understands — so the
        budget now buys the distribution and decor direction below instead.
        """
        if not isinstance(entry, dict):
            return fallback
        return str(entry.get("name") or fallback).strip()

    selected = color_palette.get("colors") if isinstance(color_palette, dict) else None
    if isinstance(selected, list) and len(selected) >= 3:
        palette = ", ".join(swatch(entry, tone) for entry in selected[:3])
        color_rule = f"the selected palette ({palette})"
    else:
        color_rule = f"{tone} as the overall direction"

    # A plan is not a room. Everything below this line — programme, hero piece,
    # decor, eye-level photography — describes one room seen from inside it,
    # which is the wrong brief for a whole home seen from above.
    if is_floor_plan(room_type):
        return build_floor_plan_prompt(design_style=style, color_rule=color_rule)

    brief = room_brief(room_type)
    # Two independent axes, so the combinations multiply instead of moving in
    # lockstep: three layouts against three material directions is nine
    # distinguishable rooms per style, not three.
    #
    # The material axis is also the answer to a subtler cause of sameness. The
    # hero used to offer the model a choice — "in stone, solid timber or slim
    # metal and glass" — and a prompt that lists alternatives gets the model's
    # favourite one every single time. Naming exactly one material per render
    # is what a designer would do anyway, and it costs fewer tokens than the
    # list it replaces.
    layout = brief["layouts"][variation_index % len(brief["layouts"])]
    hero = brief["hero"]
    materials = brief.get("materials")
    if materials:
        hero = hero.format(
            material=materials[(variation_index // len(brief["layouts"])) % len(materials)]
        )
    styling = (
        f"- COLOR: {color_rule}, lightest over the large fields.\n"
        if compact
        else (
            f"- DECORATE: {brief['decor']}. Leave most surfaces bare; nothing on the floor.\n"
            # "across every wall, ceiling and floor" is the second, cheap half of
            # the repainting fix: it says at the point colour is assigned that
            # the walls are among the things receiving it.
            f"- COLOR: {color_rule} across every wall, ceiling and floor: "
            "lightest over the large fields, mid-tones on "
            "mid-sized surfaces, the deepest in a few touches, each echoed two or "
            "three times. All finishes one scheme.\n"
        )
    )

    # The opening sentence is the wording that holds geometry; "a senior interior
    # designer's finished scheme, built on the input photo's architecture" read as
    # licence to redesign and openings moved. The lock that follows it is chosen
    # by render source — see _ARCHITECTURE_LOCKS. Everything creative stays below
    # both, so the lock is read first.
    return (
        f"Redesign this {room_type} in a refined {style} style on the input "
        "photo's architecture.\n\n"
        f"{_ARCHITECTURE_LOCKS[resolve_render_source(source)]}\n"
        f"THIS IS A {room_type.upper()}, not any other room. It contains "
        f"{brief['forbid']}.\n"
        f"LIMITS: {brief['limits']}; no other lamps or greenery.\n\n"
        "SENIOR DESIGN DIRECTION:\n"
        f"- Resolve {brief['programme']}. Take furniture count and scale from the space.\n"
        f"- Designer furniture, honest materials. {hero}.\n"
        # The spacing rule is scaffold rather than per-room because the failure
        # is general: pieces crowding the front of the frame, too close to each
        # other and to the camera, which reads as a room that was assembled
        # rather than designed.
        f"- LAYOUT: {layout} Space every piece clear of its neighbours, and align "
        "art and lighting with the furniture.\n"
        f"{styling}"
        "- Keep walkways and door swings clear; no clutter or duplicates.\n"
        "- Photorealistic editorial interior, natural light, believable scale, contact shadows."
    )

ROOM_PROGRAMS = {
    "living room": "a coherent conversation group, correctly scaled sofa and lounge chairs, coffee table, grounded rug, media or art focal point",
    "living + dining": "one room zoned twice — a conversation group at one end and a correctly scaled dining table and chairs at the other, with a clear route between them and a single pendant over the table",
    "salon": "a formal reception room: seating arranged around the perimeter so the floor stays open, matched occasional tables, a grounded rug, and no dining table",
    "salon + dining": "a formal reception room that also seats guests at table: perimeter seating around an open centre at one end, a correctly scaled dining table and chairs at the other, one pendant centred above the table",
    "balcony": "weather-safe floor finish, compact outdoor seating and a small table, planting that does not block the door, and an unobstructed outlook",
    "bedroom": "an upholstered bed, two nightstands, layered bedding, a bench or chair where circulation allows, calm storage",
    "dining room": "a correctly scaled dining table and chairs, one pendant centred above, sideboard only where circulation permits",
    "kitchen": "fitted cabinetry, durable worktops, integrated appliances, task lighting, a clear functional work triangle",
    "bathroom": "floating vanity, mirror lighting, premium tile, glass shower or bath only where the existing plumbing layout supports it",
    "office": "ergonomic desk and chair, useful storage, layered task light, one comfortable secondary seat where space permits",
    "home office": "ergonomic desk and chair, useful storage, layered task light, one comfortable secondary seat where space permits",
    "kids room": "safe age-appropriate bed, study surface, soft rug, accessible storage, playful but controlled accents",
    "guest room": "comfortable bed, nightstands, warm reading lights, compact dresser and a luggage surface where space permits",
    "studio": "clearly zoned sleeping, sitting, dining and storage functions without blocking circulation",
    "entryway": "console or bench, mirror, concealed coat and shoe storage, a durable floor finish and a welcoming light",
    "hallway": "an unobstructed circulation route, a runner or durable floor, restrained wall art and even lighting",
    "closet": "full-height hanging and shelving, drawer stacks, a mirror and even, shadow-free lighting",
    "laundry room": "side-by-side or stacked appliances, a folding surface, concealed storage, hard-wearing surfaces",
    "basement": "a clearly zoned multipurpose room with comfortable seating, warm layered lighting and moisture-appropriate finishes",
    "attic": "seating and storage worked into the sloping ceiling, warm timber, low furniture that respects the head height",
    "sunroom": "light lounge seating, abundant planting, weather-tolerant textiles and an unobstructed glazed outlook",
    "floor plan": "every drawn room resolved with the furniture that room type requires, correct scale, and walls kept exactly as drawn",
}

EXTERIOR_PROGRAMS = {
    "building": "resolve the full facade hierarchy, entrance, openings, base, roofline, material transitions and integrated exterior light",
    "balcony": "weather-safe floor finish, compact seating, privacy where useful, planters that do not block doors or drainage",
    "terrace": "outdoor lounge and dining zones, shade structure where structurally plausible, weather-safe lighting and planting",
    "garden": "clear paths, layered planting, a focal seating moment, practical edges and believable local horticulture",
    "driveway": "durable paving, clear vehicle geometry, pedestrian route, drainage logic, subtle planting and safe lighting",
    "swimming pool area": "non-slip deck, clear pool edge, loungers outside circulation, shade, planting and safe low-glare lighting",
    "garage": "durable organised surfaces, concealed storage, task lighting, clear vehicle envelope and uncluttered access",
}

#: Space types that are always treated as exterior briefs, whichever mode the
#: client sends. Balcony appears in both maps, so mode wins for that one.
EXTERIOR_SPACES = set(EXTERIOR_PROGRAMS) - {"balcony"}

#: The architecture an exterior render is standing in front of, and must not
#: edit, stated per space type.
#:
#: Every one of these used to get the generic geometry clause, because the hard
#: lock in `build_prompt` was gated on ``space_type == "building"``. A garden or
#: a driveway brief therefore said "preserve every opening" once, in a sentence
#: mostly about walls and columns, and the model read the house behind the
#: planting as background it was free to redraw — which is exactly how a render
#: came back with a window or a door the house does not have.
#:
#: The point of naming it per type is that the wall behind a driveway is not the
#: subject of the render, and a lock has to say so explicitly to be read.
EXTERIOR_OPENING_LOCKS = {
    "building": (
        "the facade's openings: reproduce every window, door, vent and balcony at "
        "the same count, size, shape and position, sills and heads included"
    ),
    "balcony": (
        "the wall and railing behind: the same doors, windows and balustrade, at "
        "the same count and size. Do not glaze in, open up or wall off anything"
    ),
    "terrace": (
        "the building the terrace belongs to: the same doors and windows onto it, "
        "at the same count and size, and the same parapet"
    ),
    "garden": (
        "every building, wall, fence and gate in shot: the same doors and windows "
        "in the same places. Plant in front of nothing that changes their count"
    ),
    "driveway": (
        "the house and the garage: the same doors, windows and garage openings, at "
        "the same count, width and position"
    ),
    "swimming pool area": (
        "the pool's own outline and every building around it: the same doors and "
        "windows, and the same pool shape, size and edge"
    ),
    "garage": (
        "the garage shell: the same door opening, windows and roof line, at the "
        "same count and size"
    ),
}


def exterior_opening_lock(space_type: str) -> str:
    """The 'do not invent an opening' clause for an exterior space type."""
    key = str(space_type or "").strip().lower()
    return EXTERIOR_OPENING_LOCKS.get(
        key,
        "every building, wall and boundary in shot: the same doors and windows, at "
        "the same count, size and position",
    )

NEGATIVE_PROMPT = (
    "blurry, lowres, distorted, warped geometry, deformed architecture, wrong perspective, "
    "merged rooms, missing walls, floating furniture, duplicated furniture, repeated objects, "
    "unfinished patches, bad lighting, text, watermark, logo, people, artifacts"
)


def resolve_mode(mode: str, space_type: str) -> str:
    """Interior unless the caller says exterior or the space is inherently outdoors."""
    if (mode or "").strip().lower() == "exterior":
        return "exterior"
    if (space_type or "").strip().lower() in EXTERIOR_SPACES:
        return "exterior"
    return "interior"


def _style_text(style: str, mode: str) -> str:
    key = (style or "modern").strip().lower()
    spec = STYLE_SPECS.get(key)
    if spec:
        return spec[mode]
    return f"authentic {style} design using a disciplined, premium and materially coherent palette"


def _program_text(space_type: str, mode: str) -> str:
    key = (space_type or "").strip().lower()
    table = ROOM_PROGRAMS if mode == "interior" else EXTERIOR_PROGRAMS
    return table.get(key, f"the essential functional elements of a premium {space_type or mode}")


def _palette_names(color_palette) -> tuple[str, ...] | None:
    """The exact ordered colors selected by the client, or None.

    New clients send an explicit ``colors`` list and count. Legacy clients send
    dominant/secondary/accent fields, which remain a three-color scheme.
    """
    if not isinstance(color_palette, dict):
        return None
    explicit = color_palette.get("colors")
    if isinstance(explicit, list):
        names = []
        for entry in explicit[:3]:
            value = entry.get("name") if isinstance(entry, dict) else entry
            name = str(value or "").strip()
            if name:
                names.append(name)
        if names:
            return tuple(names)

    legacy = tuple(
        str(color_palette.get(key) or "").strip()
        for key in ("dominant", "secondary", "accent")
    )
    return legacy if all(legacy) else None


def _exterior_palette_names(color_tone: str, color_palette) -> tuple[str, ...]:
    """Exterior colors, treating legacy auto-expanded palettes as one choice."""
    names = _palette_names(color_palette)
    if isinstance(color_palette, dict):
        if isinstance(color_palette.get("colors"), list) and names:
            return names
        try:
            count = int(color_palette.get("colorCount"))
        except (TypeError, ValueError):
            count = 0
        if names and 1 <= count <= 3:
            return names[:count]
    # Old exterior clients selected one tone but sent three automatically
    # derived fields. The user's actual choice is color_tone, not those extras.
    return (str(color_tone or "Neutral").strip(),)


def _color_clause(color_tone: str, color_palette, mode: str) -> str:
    """Write a mode-appropriate rule for exactly the selected color count."""
    names = _palette_names(color_palette)
    if mode == "exterior":
        selected = _exterior_palette_names(color_tone, color_palette)
        if len(selected) == 1:
            return (
                f"Exterior color rule: use exactly one user-selected facade color, {selected[0]}, "
                "as the only painted or pigmented architectural color. Do not invent a secondary "
                "or accent paint color. Natural stone, timber, metal, glass, sky and planting keep "
                "their physically realistic material colors and do not count as extra palette colors."
            )
        if len(selected) == 2:
            return (
                f"Exterior color rule: use exactly two user-selected facade colors and no others: "
                f"70% {selected[0]} and 30% {selected[1]}. Natural material, glazing and landscape "
                "colors remain physically realistic."
            )
        return (
            f"Exterior color 60/30/10: use exactly these three selected facade colors and no others: "
            f"60% {selected[0]}, 30% {selected[1]}, 10% {selected[2]}. Natural material, glazing "
            "and landscape colors remain physically realistic."
        )

    if names and len(names) == 3:
        dominant, secondary, accent = names
        return (
            f"Color 60/30/10: 60% {dominant} on the largest surfaces, "
            f"30% {secondary} on the secondary surfaces and soft furnishings, "
            f"10% {accent} as the single controlled accent. Use no other colour family."
        )
    return (
        f"Color 60/30/10: 60% {color_tone} dominant field, 30% one harmonizing "
        f"secondary tone, 10% one controlled contrasting accent."
    )


def build_prompt(
    *,
    mode: str,
    space_type: str,
    design_style: str,
    color_tone: str,
    material: str = "Natural oak",
    lighting: str = "Natural daylight",
    preserve_geometry: bool = True,
    creativity: int = 42,
    custom_prompt: str = "",
    color_palette=None,
) -> str:
    """The full Gen-Klein brief used by the FLUX.2 [klein] image-editing path."""
    mode = resolve_mode(mode, space_type)
    style_text = _style_text(design_style, mode)
    program = _program_text(space_type, mode)
    creativity = max(10, min(80, int(creativity or 42)))

    is_building = mode == "exterior" and (space_type or "").strip().lower() == "building"
    # Every exterior render stands in front of architecture, not just the
    # Building one — see EXTERIOR_OPENING_LOCKS. The named lock is appended to
    # whichever geometry clause applies so a garden, a driveway or a pool brief
    # can no longer treat the house behind it as redrawable background.
    #
    # Building is excluded because its own clause already enumerates openings
    # down to sill and head heights, and because that brief is the longest one
    # this engine produces: 45 more words would push its closing quality rules
    # past the text encoder's 512-token window, trading a lock it already has
    # for the rules it needs.
    openings = (
        f" THE OPENINGS ARE NOT YOURS TO CHANGE: keep {exterior_opening_lock(space_type)}. "
        "Adding a window, door, gate or opening that is not in the photo, or "
        "removing one that is, is a failed render."
        if mode == "exterior" and preserve_geometry and not is_building
        else ""
    )
    geometry = (
        "THE INPUT BUILDING IS AN IMMUTABLE STRUCTURAL TEMPLATE. Preserve 100% of its visible "
        "architecture and pixel layout: identical footprint, silhouette, massing, story count, "
        "floor heights, roof form and roofline, facade proportions, setbacks, projections, balconies, "
        "columns, beams, slabs, stairs, railings and boundary walls. Keep the exact count, shape, size "
        "and position of every window, door and opening, including sill and head heights. Keep the "
        "camera position, crop, focal length, perspective, horizon and surrounding context unchanged. "
        "Do not add, remove, move, resize, cover, merge or reinterpret any architectural element. "
        "Apply the requested style only through color, surface finish, material finish, lighting and "
        "non-obscuring landscaping; ignore any style or client instruction that would change structure."
        if is_building and preserve_geometry
        else
        "KEEP THE INPUT GEOMETRY EXACT: preserve every wall, window, door, opening, column, "
        "ceiling or roof edge, level, sill height, camera position, focal length and perspective. "
        "Never add, remove, move, resize, cover or convert an architectural opening. "
        "Change finishes and movable design elements only."
        if preserve_geometry
        else "Keep the same camera and recognisable structure. Small plausible finish-level "
        "architectural refinements are allowed, but do not invent impossible structure."
    ) + openings
    freedom = (
        "highly restrained and spatially conservative"
        if creativity < 30
        else "balanced and editorial"
        if creativity < 60
        else "expressive but architecturally credible"
    )
    personal_label = (
        "CLIENT NOTE (finishes only; locked building structure takes priority)"
        if is_building
        else "CLIENT NOTE"
    )
    personal = f"\n{personal_label}: {custom_prompt.strip()}" if (custom_prompt or "").strip() else ""

    if mode == "interior":
        placement = (
            "Keep all doors, windows and walkways clear. Furniture must be correctly scaled and square to the room. "
            "Use generous negative space; never overlap plants and furniture; keep decor off the floor; one clear focal point."
        )
        finish = "soft global illumination, realistic contact shadows, subtle reflections, 35mm architectural photography"
    else:
        placement = (
            "Keep entrances, windows, vehicle paths, drainage, steps and circulation fully usable. "
            "Planting must not cover architecture. All outdoor furniture, finishes and lights must be "
            "weather-credible and correctly scaled."
        )
        finish = "credible daylight, accurate facade shadows, realistic sky reflections, 35mm architectural photography"

    return f"""Redesign this real {space_type} as a {design_style} {mode} concept. Produce a photorealistic architecture magazine image, not a collage or illustration.

NON-NEGOTIABLE SPATIAL CONSTRAINT:
{geometry}

DESIGN DIRECTION:
- Program: {program}.
- Style vocabulary: {style_text}; make {material} the hero material.
- {_color_clause(color_tone, color_palette, mode)}
- Lighting: {lighting}. Preserve believable light direction from the source photograph.
- Creative character: {freedom}.

PLACEMENT AND QUALITY:
- {placement}
- Fully resolve every visible surface. No unfinished patches, warped furniture, repeated objects, floating objects, illegible text, people, logos or watermark.
- Finish as a high-end editorial photograph with {finish}, crisp material microtexture and balanced professional color grading.{personal}
""".strip()


def build_short_prompt(
    *,
    mode: str,
    space_type: str,
    design_style: str,
    color_tone: str,
    material: str = "",
    lighting: str = "",
    preserve_geometry: bool = True,
    color_palette=None,
) -> str:
    """CLIP-budget version of the same brief for the SD 1.5 + ControlNet path.

    CLIP truncates at 77 tokens, so the long-form brief would silently lose its
    quality clauses. This keeps the same priority order — programme, style,
    colour ratio, light, geometry — in roughly 60 tokens.
    """
    mode = resolve_mode(mode, space_type)
    program = _program_text(space_type, mode).split(",")[0]
    style_text = _style_text(design_style, mode).split(",")
    materials = ", ".join(part.strip() for part in style_text[:3])
    hero = f", {material.lower()} hero material" if material else ""
    light = lighting.lower() if lighting else ("soft natural daylight" if mode == "interior" else "credible daylight")
    lock = "same walls windows and camera, " if preserve_geometry else ""
    names = (
        _exterior_palette_names(color_tone, color_palette)
        if mode == "exterior"
        else _palette_names(color_palette)
    )
    if mode == "exterior" and names and len(names) == 1:
        palette = f"exactly one facade color {names[0].lower()}, no extra paint colors"
    elif names and len(names) == 2:
        palette = f"exactly two colors {names[0].lower()} 70 {names[1].lower()} 30"
    elif names and len(names) == 3:
        palette = f"{names[0].lower()} 60 {names[1].lower()} 30 {names[2].lower()} 10 palette"
    else:
        palette = f"{color_tone.lower()} 60/30/10 palette"
    return (
        f"photorealistic {design_style.lower()} {space_type.lower()} {mode}, {program}, "
        f"{materials}{hero}, {palette}, {light}, "
        f"{lock}architectural photography, 8k, sharp material detail"
    )
