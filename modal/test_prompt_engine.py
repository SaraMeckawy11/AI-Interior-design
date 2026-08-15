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

#: Every room the app's selector offers, plus a custom name a user could type.
APP_ROOM_TYPES = [
    "Full Apartment", "Living Room", "Living + Dining", "Salon", "Bedroom",
    "Kitchen", "Bathroom", "Dining Room", "Balcony", "Closet", "Office",
    "Kids Room", "Laundry Room", "Hallway", "Entryway", "Basement",
    "Meditation Corner",
]

APP_EXTERIOR_TYPES = [
    "Balcony", "Building", "Terrace", "Garden", "Driveway",
    "Swimming Pool Area", "Garage",
]

STYLES = ["Modern", "Japandi", "Industrial", "Classic"]

#: The longest palette the app sends, used wherever a worst case is wanted.
PALETTE = {
    "colors": [
        {"name": "Warm Vanilla Latte", "hex": "#F3E5AB"},
        {"name": "Sorrell Brown", "hex": "#AB9A61"},
        {"name": "Chambray", "hex": "#354A73"},
    ]
}

#: Qwen3 truncates at 512. Words are converted at a deliberately pessimistic
#: rate plus the chat template's overhead, because the failure mode of being
#: wrong here is silent: the tail of the brief is dropped without an error.
TOKEN_CEILING = 512
TOKENS_PER_WORD = 1.45
TEMPLATE_OVERHEAD = 32


def estimated_tokens(prompt):
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
    for room in APP_ROOM_TYPES:
        for style in STYLES:
            for variation in range(3):
                prompt = interior(room, style, variation)
                tokens = estimated_tokens(prompt)
                assert tokens <= TOKEN_CEILING, (
                    f"{room}/{style}/v{variation} is ~{tokens} tokens, over {TOKEN_CEILING}"
                )


def test_compact_brief_is_shorter_and_keeps_the_lock():
    """The fallback for an over-long custom room name must still be safe."""
    for room in APP_ROOM_TYPES:
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
        assert "Openings are fixed" in compact
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
    for room in APP_ROOM_TYPES:
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


def test_photo_lock_fixes_both_the_shell_and_the_openings():
    prompt = interior("Living Room", source="photo")
    lowered = prompt.lower()
    assert "the shell is fixed" in lowered
    assert "openings are fixed" in lowered
    assert "add none, remove none, move none, resize none, cover none" in lowered
    # The lock has to be read before anything creative asks for a redesign.
    assert lowered.index("openings are fixed") < lowered.index("senior design direction")


def test_every_exterior_type_locks_its_openings():
    """The bug where a garden or a driveway render grew a window or a door."""
    for space in APP_EXTERIOR_TYPES:
        prompt = pe.build_prompt(
            mode="exterior", space_type=space, design_style="Modern",
            color_tone="Warm White", material="Natural stone",
        ).lower()
        assert "window" in prompt and "door" in prompt
        # Either the per-type lock or Building's own enumerating clause.
        assert (
            "the openings are not yours to change" in prompt
            or "keep the exact count, shape, size and position of every window, door" in prompt
        ), f"{space} exterior brief has no opening lock"
        assert "add" in prompt and "remove" in prompt


def test_exterior_lock_names_what_each_space_stands_in_front_of():
    for space in APP_EXTERIOR_TYPES:
        lock = pe.exterior_opening_lock(space)
        assert lock and "same" in lock.lower()
    # An unknown exterior type still gets a usable lock rather than nothing.
    assert pe.exterior_opening_lock("Roof Deck")


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
