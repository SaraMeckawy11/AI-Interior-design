"""Checks on the briefs the image engines are actually sent.

Run with `python test_prompt_engine.py` (or pytest) from this directory. No
model, no GPU and no network: everything here is a property of the strings the
prompt engine produces, which is where the failures these cover came from.

Each test corresponds to a reported failure:

* kitchens came back with armchairs, a coffee table and a rug
* every room type produced near enough the same design
* exterior renders grew a window or a door the building does not have
* the brief must fit Qwen3's 512-token window or the architecture lock at the
  top of it is what gets truncated away
"""

import sys

import prompt_engine as pe

#: Every room the engine has to handle, which is more than the selector offers.
#: Living + Dining, Salon and Salon + Dining have been taken off the picker, but
#: a design saved while they were on it — or a room name typed by hand — still
#: reaches the engine, so their briefs stay covered here.
APP_ROOM_TYPES = [
    "Full Apartment", "Living Room", "Living + Dining", "Salon", "Bedroom",
    "Kitchen", "Bathroom", "Dining Room", "Balcony", "Closet", "Office",
    "Kids Room", "Laundry Room", "Hallway", "Entryway", "Basement",
    "Meditation Corner",
]

#: The living room is served by the pre-change brief on purpose — see
#: prompt_engine._legacy_living_room_brief. It therefore carries none of the
#: rules the current brief does: no window lock, no surfaces rule, no spacing
#: line, no layout or material variation. Every "each room" rule below runs
#: over CURRENT_BRIEF_ROOMS so that exception stays visible instead of being
#: quietly weakened into the rules themselves.
LEGACY_BRIEF_ROOMS = ["Living Room"]

APP_EXTERIOR_TYPES = [
    "Balcony", "Building", "Terrace", "Garden", "Driveway",
    "Swimming Pool Area", "Garage",
]

CURRENT_BRIEF_ROOMS = [r for r in APP_ROOM_TYPES if r not in LEGACY_BRIEF_ROOMS]

STYLES = ["Modern", "Japandi", "Industrial", "Classic"]

#: The longest palette the app sends, used wherever a worst case is wanted.
PALETTE = {
    "colors": [
        {"name": "Warm Vanilla Latte", "hex": "#F3E5AB"},
        {"name": "Sorrell Brown", "hex": "#AB9A61"},
        {"name": "Chambray", "hex": "#354A73"},
    ]
}

#: Qwen3 truncates at 512, and the failure mode is silent — the tail of the
#: brief is dropped without an error, and the tail is where the quality rules
#: live. So this is measured with the model's real tokenizer when it can be
#: reached, and only estimated when it cannot.
#:
#: The word estimate was 1.45 tokens/word, chosen pessimistically before
#: anything had been measured. Against the real tokenizer these briefs run
#: 1.34–1.38, so 1.45 was rejecting briefs that fit; 1.42 keeps a margin over
#: the observed worst case without inventing 5% of phantom length.
#:
#: The chat wrapper is measured rather than guessed too. Rendering the model's
#: own chat_template.jinja for one empty user message gives exactly:
#:
#:     '<|im_start|>user\n<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n'
#:
#: which is 12 tokens. This was 32, invented for safety before it was checked,
#: and those 20 phantom tokens were rejecting briefs that fit — which is what
#: pushed an earlier attempt into cutting real quality rules to make room. 16
#: keeps a margin over the measurement without inflating it threefold.
TOKEN_CEILING = 512
TOKENS_PER_WORD = 1.42
TEMPLATE_OVERHEAD = 16


def _real_tokenizer():
    """The FLUX.2 [klein] tokenizer, or None if it cannot be loaded offline.

    Only the tokenizer JSON is fetched — a few MB, not the 16 GB checkpoint —
    and it is cached after the first run. Falling back to the estimate keeps
    this suite runnable on a machine with no network.
    """
    try:
        from huggingface_hub import hf_hub_download
        from tokenizers import Tokenizer

        return Tokenizer.from_file(
            hf_hub_download("black-forest-labs/FLUX.2-klein-4B", "tokenizer/tokenizer.json")
        )
    except Exception:
        return None


TOKENIZER = _real_tokenizer()


def estimated_tokens(prompt):
    if TOKENIZER is not None:
        return len(TOKENIZER.encode(prompt).ids) + TEMPLATE_OVERHEAD
    return int(len(prompt.split()) * TOKENS_PER_WORD) + TEMPLATE_OVERHEAD


def interior(room, style="Modern", variation=0, palette=PALETTE, source="photo"):
    return pe.build_gen_klein_interior_prompt(
        space_type=room,
        design_style=style,
        color_tone="Warm Vanilla Latte",
        color_palette=palette,
        source=source,
        variation_index=variation,
    )


def test_every_brief_fits_the_token_window():
    # 9 covers both variation axes: layout rotates every step, material every
    # third, so a shorter layout can hide a longer material and vice versa.
    for room in APP_ROOM_TYPES:
        for style in STYLES:
            for variation in range(9):
                prompt = interior(room, style, variation)
                tokens = estimated_tokens(prompt)
                assert tokens <= TOKEN_CEILING, (
                    f"{room}/{style}/v{variation} is ~{tokens} tokens, over {TOKEN_CEILING}"
                )


def test_compact_brief_is_shorter_and_keeps_the_lock():
    """The fallback for an over-long custom room name must still be safe."""
    for room in CURRENT_BRIEF_ROOMS:
        full = interior(room)
        compact = pe.build_gen_klein_interior_prompt(
            space_type=room,
            design_style="Modern",
            color_tone="Warm Vanilla Latte",
            color_palette=PALETTE,
            compact=True,
        )
        assert len(compact.split()) < len(full.split())
        # The parts a render cannot be correct without survive compaction.
        assert "ARCHITECTURE - HIGHEST PRIORITY" in compact
        assert "WINDOWS ARE UNTOUCHABLE" in compact
        assert "Doors and other openings" in compact
        assert pe.room_brief(room)["forbid"] in compact
        assert pe.room_brief(room)["programme"] in compact


#: Rooms that must never be briefed for lounge furniture, and the words that
#: would mean they had been. This is the kitchen-with-chairs bug, generalised:
#: the old brief asked every room to "group seating around a correctly sized
#: rug" and to light it with "one floor lamp beside seating".
_NO_LOUNGE_ROOMS = ["Kitchen", "Bathroom", "Laundry Room", "Closet", "Hallway"]
_LOUNGE_WORDS = ["sofa", "armchair", "coffee table", "cushions", "throw"]


def test_service_rooms_are_never_briefed_for_lounge_furniture():
    for room in _NO_LOUNGE_ROOMS:
        for variation in range(3):
            prompt = interior(room, variation=variation)
            # Split off the exclusion sentence: naming a sofa in order to forbid
            # it is the point, so only the instruction half is searched.
            forbid = pe.room_brief(room)["forbid"]
            instructions = prompt.replace(forbid, "")
            lowered = instructions.lower()
            for word in _LOUNGE_WORDS:
                assert word not in lowered, (
                    f"{room} brief still asks for '{word}':\n{instructions}"
                )
            # And the exclusion must actually be stated.
            assert forbid in prompt


def test_kitchen_forbids_the_furniture_that_turned_up_in_it():
    forbid = pe.room_brief("Kitchen")["forbid"].lower()
    for word in ("sofa", "armchair", "coffee table", "dining table", "area rug"):
        assert word in forbid, f"kitchen exclusions do not mention {word}"
    # Counter stools are the one seating exception, and only at an island.
    assert "counter stools" in forbid and "island" in forbid


def test_rooms_that_should_have_no_rug_do_not_ask_for_one():
    for room in ("Kitchen", "Bathroom", "Laundry Room"):
        prompt = interior(room)
        instructions = prompt.replace(pe.room_brief(room)["forbid"], "").lower()
        assert "rug" not in instructions, f"{room} brief still asks for a rug"


def test_no_floor_lamp_where_there_is_no_seating():
    for room in ("Kitchen", "Bathroom", "Laundry Room", "Closet"):
        limits = pe.room_brief(room)["limits"].lower()
        assert "no floor lamp" in limits, f"{room} does not rule out a floor lamp"


def test_every_room_type_gets_a_distinct_brief():
    """The 'every room looks the same' bug, at the level this engine controls."""
    prompts = {room: interior(room) for room in APP_ROOM_TYPES}
    assert len(set(prompts.values())) == len(prompts), "two room types share a brief"

    # Distinct is not enough — they have to differ in the parts that decide the
    # furniture, not only in the room's name.
    programmes = {pe.room_brief(room)["programme"] for room in APP_ROOM_TYPES}
    heroes = {pe.room_brief(room)["hero"] for room in APP_ROOM_TYPES}
    assert len(programmes) >= len(APP_ROOM_TYPES) - 1
    assert len(heroes) >= len(APP_ROOM_TYPES) - 1


def test_variation_changes_the_layout_asked_for():
    for room in CURRENT_BRIEF_ROOMS:
        layouts = {interior(room, variation=index) for index in range(3)}
        assert len(layouts) == 3, f"{room} renders the same layout every time"


def test_seed_differs_per_room_and_per_variation():
    seeds = {
        room: pe.design_seed(
            space_type=room, design_style="Modern",
            color_tone="Warm Vanilla Latte", color_palette=PALETTE,
        )
        for room in APP_ROOM_TYPES
    }
    assert len(set(seeds.values())) == len(seeds), "two rooms hash to one seed"

    for room in APP_ROOM_TYPES:
        rolls = {
            pe.design_seed(
                space_type=room, design_style="Modern",
                color_tone="Warm Vanilla Latte", color_palette=PALETTE,
                variation=index,
            )
            for index in range(5)
        }
        assert len(rolls) == 5, f"{room} re-rolls to the same seed"

    # Same brief, same seed: a repeat of one request still reproduces.
    twice = [
        pe.design_seed(space_type="Kitchen", design_style="Modern", color_tone="Neutral")
        for _ in range(2)
    ]
    assert twice[0] == twice[1]

    # Style and palette are part of the brief and so part of the seed.
    assert pe.design_seed(space_type="Kitchen", design_style="Modern", color_tone="Neutral") != \
        pe.design_seed(space_type="Kitchen", design_style="Japandi", color_tone="Neutral")


#: A television is a piece of programme, not decoration, and a senior designer
#: puts one in some rooms and refuses it in others. These are the rooms it
#: belongs in — everywhere else has to rule it out explicitly, because silence
#: is what let one turn up in a salon.
_TV_ROOMS = ["Living Room", "Living + Dining", "Basement", "Full Apartment"]
#: The same list without the living room, which no longer reads ROOM_BRIEFS.
_TV_ROOMS_CURRENT = [r for r in _TV_ROOMS if r not in LEGACY_BRIEF_ROOMS]
_NO_TV_ROOMS = [
    "Salon", "Salon + Dining", "Bedroom", "Kitchen", "Bathroom", "Dining Room",
    "Balcony", "Closet", "Office", "Kids Room", "Laundry Room", "Hallway",
    "Entryway",
]


def test_rooms_that_should_have_a_tv_ask_for_one_with_a_unit():
    for room in _TV_ROOMS_CURRENT:
        programme = pe.room_brief(room)["programme"].lower()
        assert "tv" in programme, f"{room} does not ask for a TV"
        # A TV with nothing under it renders as a floating black rectangle.
        assert "media unit" in programme, f"{room} asks for a TV with no unit under it"
        assert "tv" not in pe.room_brief(room)["forbid"].lower()


def test_rooms_that_should_not_have_a_tv_forbid_one():
    for room in _NO_TV_ROOMS:
        brief = pe.room_brief(room)
        # Two shapes of exclusion list are in use: "no TV, no bed, ..." and the
        # compressed "no sofa, armchair, ..., TV or area rug". Both rule it out.
        assert "tv" in brief["forbid"].lower(), f"{room} does not rule out a TV"
        assert "tv" not in brief["programme"].lower(), f"{room} asks for a TV"
        prompt = interior(room)
        instructions = prompt.replace(brief["forbid"], "").lower()
        assert " tv" not in instructions, f"{room} still mentions a TV outside its exclusions"


def test_formal_reception_rooms_also_refuse_the_media_unit():
    """Told only 'no TV', the model renders the console and leaves the wall bare."""
    for room in ("Salon", "Salon + Dining", "Dining Room"):
        assert "media unit" in pe.room_brief(room)["forbid"].lower(), (
            f"{room} rules out the TV but not the unit it sits on"
        )


_LEGACY_LIVING_ROOM = "\n".join((
    'Redesign this Living Room in a refined Modern style, using the input photo as the architectural base.',
    '',
    'ARCHITECTURE:',
    '- Edit finishes, furniture and decor only. Retain the existing walls, doors, windows, balcony openings and camera framing as they appear; do not redesign the architecture.',
    '',
    'SENIOR DESIGN DIRECTION:',
    '- Create one cohesive, professionally resolved room with balanced proportions, clear circulation, visual rhythm, a focal point and layered lighting.',
    '- Resolve a complete conversation group with sofa, complementary seating, coffee table, correctly sized anchoring rug, and a TV centred above a media console on an available solid wall. Choose the layout, furniture count and scale from the visible space.',
    '- Arrange furniture as related groups, not isolated objects. Anchor the main group with a correctly sized rug and maintain realistic clearances.',
    '- Establish a clear focal hierarchy; align art, lighting and casework with nearby furniture and architectural lines. Use ambient, task and accent lighting.',
    '- Select flooring, rugs, curtains, furniture, lighting, art, materials and finishes together as one coordinated scheme. Do not force a predetermined material or object color.',
    '- Repeat key colors, forms and finishes across separated elements so the room feels intentionally composed, not assembled from unrelated pieces.',
    '- COLOR: Use Neutral as the overall color direction. Distribute it naturally across the whole room as anchors, not rigid paint matches: light or muted variants on large fields, mid-tones for depth, and the strongest or darkest color sparingly.',
    '- Keep undertones consistent and repeat key colors in two or three separated details. Preserve realistic wood, stone and metal with balanced contrast; avoid a flat wash, muddy neutrals, oversaturation or equal color weight.',
    '- Keep every opening and walkway visible and usable. Avoid clutter, mismatched pieces and repeated objects.',
    '- Photorealistic editorial interior, natural light, believable scale and contact shadows.',
))


def test_living_room_brief_is_the_12_august_one_word_for_word():
    built = pe.build_gen_klein_interior_prompt(
        space_type="Living Room", design_style="Modern", color_tone="Neutral",
    )
    assert built == _LEGACY_LIVING_ROOM, (
        "the living room brief has drifted from the 5f8e267 original:\n"
        + "\n".join(
            line for line in __import__("difflib").unified_diff(
                _LEGACY_LIVING_ROOM.splitlines(), built.splitlines(),
                fromfile="5f8e267", tofile="built", lineterm="",
            )
        )
    )


def test_living_room_brief_never_varies():
    """That version predated render-source locks and variation axes alike."""
    briefs = {
        pe.build_gen_klein_interior_prompt(
            space_type="Living Room", design_style="Modern",
            color_tone="Neutral", source=source, variation_index=index,
        )
        for source in ("photo", "walkthrough")
        for index in range(9)
    }
    assert len(briefs) == 1, "the legacy brief should not vary at all"


def test_living_room_is_the_one_brief_that_mentions_curtains():
    """Curtains could not be added to the current brief without costing the
    architecture — twice tried, twice reverted. This version carries them
    already, inside a coordinated-scheme line rather than as a decor
    instruction, which is very likely why they work here and nowhere else."""
    assert "curtains" in interior("Living Room").lower()
    for room in CURRENT_BRIEF_ROOMS:
        assert "curtain" not in interior(room).lower(), f"{room} asks for curtains"


def test_living_room_has_no_item_limits():
    """Part of why its rooms read as designed rather than rationed."""
    built = interior("Living Room").lower()
    assert "item limits" not in built
    assert "exactly one ceiling fixture" not in built


def test_salon_and_living_room_are_opposites_about_the_tv():
    """The reported case, pinned directly."""
    salon = pe.room_brief("Salon")
    living = pe.room_brief("Living Room")
    assert "no tv" in salon["forbid"].lower()
    assert "tv" in living["programme"].lower() and "media unit" in living["programme"].lower()
    assert "no tv" not in living["forbid"].lower()


def test_window_lock_is_explicit_and_unmissable():
    """A window must survive at its exact size, shape and position."""
    prompt = interior("Bedroom", source="photo")
    lowered = prompt.lower()
    assert "windows are untouchable" in lowered
    for rule in ("same count", "position", "outline", "width", "height", "sill"):
        assert rule in lowered, f"window lock does not pin {rule}"
    # The ways a window actually gets lost, each named.
    for failure in ("widen", "narrow", "shorten", "reshape", "wall one over", "drapery"):
        assert failure in lowered, f"window lock does not forbid '{failure}'"
    # And it has to be read before anything asks for a design.
    assert lowered.index("windows are untouchable") < lowered.index("senior design direction")


def test_walkthrough_lock_also_holds_window_shape():
    prompt = interior("Bedroom", source="walkthrough").lower()
    assert "window" in prompt
    assert "outline and proportions" in prompt


#: Materials that were surviving from the source photo onto the redesigned
#: walls. An earlier attempt listed these *in the brief* in order to forbid
#: them, and the renders got worse: the text encoder reads the nouns and barely
#: the negation around them, so naming a material is a way of asking for it.
#: The repainting instruction must stay positive.
_UNWANTED_WALL_MATERIALS = ["brick", "raw concrete", "exposed stone", "old paint"]


def test_tv_rooms_count_the_sofa_positively():
    """Two sofas appeared, the second one over the media unit.

    The fix is the count, stated as a positive. Writing "no second sofa" would
    put the word 'sofa' into an exclusion the encoder mostly reads as 'sofa'.
    """
    for room in _TV_ROOMS_CURRENT:
        programme = pe.room_brief(room)["programme"].lower()
        assert "one sofa" in programme, f"{room} does not count the sofa"
        forbid = pe.room_brief(room)["forbid"].lower()
        assert "sofa" not in forbid, (
            f"{room} forbids a sofa by name, which tends to summon one: {forbid}"
        )


def test_living_room_seats_the_sofa_by_the_television():
    """The variant that caused the bug aimed the sofa at the media wall.

    'Set the sofa square to the longest solid wall' is an instruction to put
    the sofa exactly where the TV and its unit go, because the longest solid
    wall is the media wall.
    """
    for layout in pe.room_brief("Living Room")["layouts"]:
        lowered = layout.lower()
        assert "longest solid wall" not in lowered, f"still seats the sofa on the media wall: {layout}"
        # "a console table behind the sofa" merged with the media console.
        assert "console" not in lowered, f"layout mentions a console: {layout}"
        assert "tv" in lowered, f"layout does not place the seating by the TV: {layout}"


def test_walls_are_repainted_without_naming_what_to_avoid():
    prompt = interior("Bedroom")
    lowered = prompt.lower()
    # Positive instruction, in the architecture block and again where colour is
    # actually assigned.
    assert "every surface refinished evenly, corner to corner" in lowered
    assert "across every wall, ceiling and floor" in lowered
    # And the brief must not recite the materials it is trying to get rid of.
    for material in _UNWANTED_WALL_MATERIALS:
        assert material not in lowered, (
            f"the brief names '{material}', which asks for it rather than removing it"
        )


def test_no_room_brief_names_an_unwanted_wall_material():
    """Applies to every room, not just the one that was reported."""
    for room in APP_ROOM_TYPES:
        for variation in range(3):
            lowered = interior(room, variation=variation).lower()
            for material in _UNWANTED_WALL_MATERIALS:
                assert material not in lowered, f"{room} brief names '{material}'"


def test_quality_rules_survive_in_every_brief():
    """The regression that made the reverted attempt worse than the bug.

    Paying for new clauses by deleting these is what turned two specific
    failures into a general drop in quality, so they are pinned here.
    """
    required = [
        "no clutter or duplicates",
        "nothing on the floor",
        "all finishes one scheme",
        "take furniture count and scale from the space",
        "leave most surfaces bare",
        "align art and lighting with the furniture",
    ]
    for room in CURRENT_BRIEF_ROOMS:
        lowered = interior(room).lower()
        for rule in required:
            assert rule in lowered, f"{room} brief lost the quality rule '{rule}'"


def test_variation_moves_layout_and_material_independently():
    """Nine distinguishable rooms per style, not three.

    One axis alone made every render of a room share its materials, which is a
    large part of why the designs read as the same design. Layout and material
    rotate on different divisors so their combinations multiply.
    """
    for room in CURRENT_BRIEF_ROOMS:
        briefs = {interior(room, variation=index) for index in range(9)}
        expected = 3 * len(pe.room_brief(room).get("materials") or (None,))
        assert len(briefs) == expected, (
            f"{room} produces {len(briefs)} briefs across 9 variations, expected {expected}"
        )


def test_hero_names_one_material_not_a_choice():
    """A prompt that lists alternatives gets the model's favourite every time."""
    for room in CURRENT_BRIEF_ROOMS:
        brief = pe.room_brief(room)
        materials = brief.get("materials")
        if not materials:
            continue
        assert "{material}" in brief["hero"], f"{room} has materials but no slot to put them in"
        assert len(set(materials)) == len(materials), f"{room} repeats a material"
        for variation in range(9):
            hero_line = [
                line for line in interior(room, variation=variation).splitlines()
                if "hero piece" in line
            ]
            assert hero_line, f"{room} lost its hero line"
            # Exactly one of the material options may appear in a given render.
            present = [m for m in materials if m in hero_line[0]]
            assert len(present) == 1, (
                f"{room} v{variation} names {len(present)} materials: {hero_line[0]}"
            )


def test_the_living_room_does_not_ask_for_curtains():
    """Curtains were tried twice and taken out twice.

    Both attempts cost the render its architecture — first as "full-height
    curtains" at the head of the decor list, then as slim panels at the tail —
    because the lock above forbids hiding a window behind drapery and a decor
    line asking for drapery argues with it at any weight. This fails if they
    come back, so the third attempt has to be a deliberate decision rather than
    an accident.
    """
    for room in APP_ROOM_TYPES:
        brief = pe.room_brief(room)
        for field in ("programme", "hero", "decor"):
            assert "curtain" not in brief[field].lower(), (
                f"{room} asks for curtains in {field}: {brief[field]}"
            )
    # The lock that made them unaffordable is still there.
    assert "hide one behind drapery" in interior("Bedroom").lower()


def test_seating_rooms_place_their_chairs():
    """Chairs were arriving unplaced, reading as spare seating pushed in."""
    for layout in pe.room_brief("Living Room")["layouts"]:
        assert "chair" in layout.lower(), f"living room layout does not place the chairs: {layout}"
    programme = pe.room_brief("Living Room")["programme"].lower()
    assert "two lounge chairs" in programme
    # And they are a form of their own, not the sofa repeated small.
    assert "distinct shape" in programme or "lighter" in programme


def test_every_brief_asks_for_breathing_room():
    for room in CURRENT_BRIEF_ROOMS:
        assert "space every piece clear of its neighbours" in interior(room).lower(), (
            f"{room} brief has no spacing rule"
        )


def test_photo_lock_fixes_both_the_shell_and_the_openings():
    prompt = interior("Bedroom", source="photo")
    lowered = prompt.lower()
    assert "the shell is fixed" in lowered
    assert "doors and other openings: same rule" in lowered
    assert "add, remove, move or resize none" in lowered
    # The lock has to be read before anything creative asks for a redesign.
    assert lowered.index("the shell is fixed") < lowered.index("senior design direction")


def test_every_exterior_type_still_protects_its_openings():
    """Every exterior brief forbids adding or removing an opening.

    A per-type clause naming what each space stands in front of was added on
    top of this and then taken off again: it made the renders worse at holding
    the architecture, which is the one thing it was meant to help. What is
    asserted here is the protection the exterior path has always had — the
    Building clause enumerating every opening, or the general one for the rest.
    """
    for space in APP_EXTERIOR_TYPES:
        prompt = pe.build_prompt(
            mode="exterior", space_type=space, design_style="Modern",
            color_tone="Warm White", material="Natural stone",
        ).lower()
        assert "window" in prompt and "door" in prompt
        assert (
            "keep the exact count, shape, size and position of every window, door" in prompt
            or "never add, remove, move, resize, cover or convert an architectural opening" in prompt
        ), f"{space} exterior brief has no opening protection"


def test_exterior_brief_matches_the_pinned_renderer():
    """The exterior path is a historical implementation kept deliberately fixed.

    `ExteriorGenKlein` is documented as the ad7a9ba renderer and is not a place
    to try things: changes to its prompt and its seed both made the output
    worse and were reverted. This fails if a per-type opening clause is
    reintroduced into the brief.
    """
    assert not hasattr(pe, "exterior_opening_lock")
    assert not hasattr(pe, "EXTERIOR_OPENING_LOCKS")
    for space in APP_EXTERIOR_TYPES:
        prompt = pe.build_prompt(
            mode="exterior", space_type=space, design_style="Modern",
            color_tone="Warm White", material="Natural stone",
        ).lower()
        assert "the openings are not yours to change" not in prompt


def test_exterior_briefs_stay_inside_the_token_window():
    for space in APP_EXTERIOR_TYPES:
        for style in STYLES:
            prompt = pe.build_prompt(
                mode="exterior", space_type=space, design_style=style,
                color_tone="Warm White", material="Natural stone",
                color_palette=PALETTE,
            )
            tokens = estimated_tokens(prompt)
            assert tokens <= TOKEN_CEILING, f"{space}/{style} is ~{tokens} tokens"


def test_floor_plan_still_bypasses_the_room_brief():
    """A plan is a home seen from above, not a room seen from inside it."""
    for name in ("Floor Plan", "floorplan", "3D Floor Plan"):
        prompt = pe.build_gen_klein_interior_prompt(
            space_type=name, design_style="Modern", color_tone="Neutral",
        )
        assert "COPY THE MODEL EXACTLY" in prompt
        assert "hero piece" not in prompt


def test_aliases_reach_a_real_brief():
    for alias, target in pe.ROOM_BRIEF_ALIASES.items():
        assert target in pe.ROOM_BRIEFS, f"alias {alias} points at missing {target}"
        assert pe.room_brief(alias) is pe.ROOM_BRIEFS[target]


def test_unknown_room_does_not_get_a_living_room():
    """A custom room name must not quietly inherit sofa-and-rug styling."""
    brief = pe.room_brief("Meditation Corner")
    for field in ("programme", "hero", "decor"):
        assert "sofa" not in brief[field].lower()
        assert "rug" not in brief[field].lower()


def _run():
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
            failures.append((name, error))
            print(f"  FAIL  {name}\n        {error}")
    print(f"\n{len(tests) - len(failures)}/{len(tests)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(_run())
