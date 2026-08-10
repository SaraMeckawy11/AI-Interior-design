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
3. **Named colours, with their hex.** Interiors and exteriors both get exactly
   the one, two or three colours the user picked, each named *and* specified —
   `color-namer` returns things like "Quarter Spanish White", which no image
   model has a reliable idea about, so the hex is the only unambiguous half.
   Which surfaces each share lands on is written in the vocabulary of the mode:
   a room's 30% is its soft furnishings, a facade's is its base course and trim.
4. **Craft rules, then quality rules.** What a senior designer actually decides
   — circulation clearances, light in layers, where a material may change — sits
   between the brief and the photographic finish, so it filters the programme
   above it and is filtered by the quality bar below.

`build_prompt` is model-agnostic and returns the long-form brief used by
FLUX.2 [klein]. `build_short_prompt` compresses the same brief into CLIP's
77-token budget for the Stable Diffusion + ControlNet path.
"""

from __future__ import annotations

#: What the long brief is written to fit inside, in text-encoder tokens.
#:
#: FLUX.2 [klein] reads its prompt with a Qwen3 causal encoder, whose context is
#: far larger than this — but diffusers pipelines have historically defaulted
#: `max_sequence_length` to 512 and silently truncate past it, and a clause that
#: is cut is a clause that was never sent. So the brief is written to fit, with
#: the two things the user actually chose — their colours and their own note —
#: placed high enough that boilerplate is what goes if anything ever does.
#:
#: `estimate_tokens` is a word-count heuristic, not a tokenizer: the point is to
#: keep whoever edits these strings honest, not to be exact.
PROMPT_TOKEN_BUDGET = 512


def estimate_tokens(text: str) -> int:
    """Roughly how many tokens a prompt costs. English prose runs ~1.35/word."""
    return int(len(str(text or "").split()) * 1.35)


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

ROOM_PROGRAMS = {
    "living room": "a coherent conversation group, correctly scaled sofa and lounge chairs, coffee table, grounded rug, media or art focal point",
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
    "building": "resolve the facade hierarchy, entrance, base, roofline, material transitions and integrated exterior light",
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


def _hex(value) -> str:
    """A #RRGGBB string, or "" for anything that is not one."""
    text = str(value or "").strip().upper()
    if not text:
        return ""
    if not text.startswith("#"):
        text = "#" + text
    if len(text) == 4 and all(c in "0123456789ABCDEF" for c in text[1:]):
        return "#" + "".join(c * 2 for c in text[1:])
    if len(text) == 7 and all(c in "0123456789ABCDEF" for c in text[1:]):
        return text
    return ""


def _palette_entries(color_palette) -> tuple[tuple[str, str], ...] | None:
    """The ordered colors the client selected, as (name, hex) pairs, or None.

    Both halves earn their place. The name carries meaning a model already knows
    how to render — "Sage" is a colour *and* a material world — while the hex is
    the only unambiguous part: `color-namer` returns entries like "Quarter
    Spanish White" and "Pale Oyster", which no image model has a reliable idea
    about, and those names were until now the whole of what the palette said.

    New clients send an explicit ``colors`` list and count. Legacy clients send
    dominant/secondary/accent fields, which remain a three-color scheme.
    """
    if not isinstance(color_palette, dict):
        return None
    explicit = color_palette.get("colors")
    if isinstance(explicit, list):
        entries = []
        for entry in explicit[:3]:
            if isinstance(entry, dict):
                name = str(entry.get("name") or "").strip()
                code = _hex(entry.get("hex"))
            else:
                name, code = str(entry or "").strip(), ""
            if name or code:
                entries.append((name or code, code))
        if entries:
            return tuple(entries)

    legacy = tuple(
        (
            str(color_palette.get(key) or "").strip(),
            _hex(color_palette.get(key + "Hex")),
        )
        for key in ("dominant", "secondary", "accent")
    )
    return legacy if all(name for name, _ in legacy) else None


def _palette_names(color_palette) -> tuple[str, ...] | None:
    """Just the names, for the CLIP-budget prompt where a hex is not worth it."""
    entries = _palette_entries(color_palette)
    return tuple(name for name, _ in entries) if entries else None


def _swatch(entry: tuple[str, str]) -> str:
    """One colour, named and specified: ``Sage (#9DC183)``."""
    name, code = entry
    return f"{name} ({code})" if code else name


def _exterior_palette_entries(color_tone: str, color_palette) -> tuple[tuple[str, str], ...]:
    """Exterior colors, treating legacy auto-expanded palettes as one choice."""
    entries = _palette_entries(color_palette)
    if isinstance(color_palette, dict):
        if isinstance(color_palette.get("colors"), list) and entries:
            return entries
        try:
            count = int(color_palette.get("colorCount"))
        except (TypeError, ValueError):
            count = 0
        if entries and 1 <= count <= 3:
            return entries[:count]
    # Old exterior clients selected one tone but sent three automatically
    # derived fields. The user's actual choice is color_tone, not those extras.
    return ((str(color_tone or "Neutral").strip(), ""),)


def _exterior_palette_names(color_tone: str, color_palette) -> tuple[str, ...]:
    return tuple(name for name, _ in _exterior_palette_entries(color_tone, color_palette))


def _color_clause(color_tone: str, color_palette, mode: str) -> str:
    """Write a mode-appropriate rule for exactly the selected color count.

    Both modes get the same discipline and different vocabulary, because the
    surfaces are not the same surfaces. A room's 30% is its soft furnishings; a
    facade's 30% is its base course, its trim and its frames. Naming the wrong
    ones is how an exterior brief ends up asking for cushions.
    """
    natural = "Natural stone, timber, glazing, sky and planting keep their real colors."
    if mode == "exterior":
        selected = _exterior_palette_entries(color_tone, color_palette)
        if len(selected) == 1:
            return (
                f"FACADE COLOR — one pigmented color only, {_swatch(selected[0])}, on the whole "
                f"rendered body. Invent no second paint color. {natural}"
            )
        if len(selected) == 2:
            return (
                f"FACADE COLOR — exactly two, matched to the hex: 70% {_swatch(selected[0])} on the "
                f"body, 30% {_swatch(selected[1])} on base course, trim, fascia and frames. {natural}"
            )
        return (
            f"FACADE COLOR 60/30/10 — these three only, matched to the hex: "
            f"60% {_swatch(selected[0])} on the body and largest wall planes; "
            f"30% {_swatch(selected[1])} on base course, trim, fascia and frames; "
            f"10% {_swatch(selected[2])} on the front door and one deliberate detail. {natural}"
        )

    entries = _palette_entries(color_palette)
    if entries and len(entries) == 3:
        dominant, secondary, accent = entries
        return (
            f"COLOR 60/30/10 — these three only, matched to the hex: "
            f"60% {_swatch(dominant)} on walls and the largest surfaces; "
            f"30% {_swatch(secondary)} on upholstery, curtains, rug and joinery; "
            f"10% {_swatch(accent)} on cushions, art, ceramics and one considered object. {natural}"
        )
    if entries and len(entries) == 2:
        dominant, secondary = entries
        return (
            f"COLOR — exactly two, matched to the hex: 70% {_swatch(dominant)} on walls and the "
            f"largest surfaces, 30% {_swatch(secondary)} on textiles and secondary joinery. {natural}"
        )
    if entries:
        return (
            f"COLOR — one pigmented colour only, {_swatch(entries[0])}, across walls and the largest "
            f"surfaces. Invent no second colour family. {natural}"
        )
    return (
        f"COLOR 60/30/10: 60% {color_tone} dominant field, 30% one harmonizing "
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
    geometry = (
        "THE INPUT BUILDING IS AN IMMUTABLE STRUCTURAL TEMPLATE. Keep its footprint, silhouette, "
        "massing, storey count, roof form, facade proportions, projections, balconies, stairs and "
        "railings exactly as they are; every window and door at the same count, shape, size and sill "
        "height; the camera, crop, perspective and surroundings unchanged. Style it through color, "
        "finish, lighting and non-obscuring landscaping only."
        if is_building and preserve_geometry
        else
        "KEEP THE INPUT GEOMETRY EXACT: preserve every wall, window, door, opening, column, "
        "ceiling or roof edge, level, sill height, camera position, focal length and perspective. "
        "Never add, remove, move, resize, cover or convert an architectural opening. "
        "Change finishes and movable design elements only."
        if preserve_geometry
        else "Keep the same camera and recognisable structure. Small plausible finish-level "
        "architectural refinements are allowed, but do not invent impossible structure."
    )
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
    # High in the brief, not at the end of it. See PROMPT_TOKEN_BUDGET: if
    # anything is ever cut it should be the boilerplate, not the two things the
    # person actually chose — their colours and their own words.
    note = (custom_prompt or "").strip()
    personal = f"\n{personal_label}: {note}\n" if note else ""

    # ── The craft rules ──────────────────────────────────────────────────────
    # What a senior designer actually decides, rather than what a room or a
    # facade contains. The programme clause above says a living room needs a
    # sofa; this is the difference between a sofa in a picture and a sofa a
    # photographer would shoot. Both blocks are deliberately short: they replace
    # the old one-line placement rule rather than adding to it, because the
    # image encoder's budget is finite and a clause that gets truncated is a
    # clause that was never sent.
    if mode == "interior":
        author = "senior interior designer"
        craft = (
            "- Scale: 90 cm walkways, seating close enough to talk across, a rug under the front legs"
            " of every seat, art centred at eye level, a pendant one hand-span above its table.\n"
            "- Light in three layers — ambient, task, accent — never one ceiling flood.\n"
            "- One hero material, two supporting, one metal, each repeated at least twice; mix matte,"
            " soft and reflective.\n"
            "- One focal point. Style in odd-numbered groups, leave surfaces breathing, and give every"
            " piece credible joinery and weight."
        )
        finish = "soft global illumination, realistic contact shadows, subtle reflections"
    else:
        author = "senior residential architect and landscape designer"
        craft = (
            "- Read the facade as base, body and crown. Change material only at structural lines —"
            " floor levels, corners, reveals — never mid-panel, heavier material low.\n"
            "- Emphasise the entrance. Frames slim and identical throughout, reveals deep enough to"
            " shadow, glazing reflecting sky. Consistent fascia, coping and downpipes that drain.\n"
            "- Landscape in layers — tree, shrub, groundcover — credible for this climate, defined"
            " bed edges, correct paving module and falls, nothing covering architecture.\n"
            "- Light only from real fittings: step lights, wall grazers, one entrance light. Keep"
            " paths, steps and vehicle routes usable."
        )
        finish = "credible daylight, accurate facade shadows, realistic sky reflections"

    def assemble(personal_block: str) -> str:
        return _ASSEMBLED.format(
            space_type=space_type, design_style=design_style, mode=mode, author=author,
            geometry=geometry, program=program, style_text=style_text, material=material,
            color=_color_clause(color_tone, color_palette, mode), lighting=lighting,
            freedom=freedom, personal=personal_block, craft=craft, finish=finish,
        ).strip()

    brief = assemble(personal)
    # The one case that can run over: the longest space brief plus a client note
    # at its full length. Trimming whole words off the end of the note is a
    # defined loss; letting the encoder cut wherever 512 lands is not — it would
    # take the quality bar or a craft rule and leave no trace that it had.
    while note and estimate_tokens(brief) > PROMPT_TOKEN_BUDGET:
        words = note.split()
        if len(words) <= 8:
            break
        note = " ".join(words[:-4])
        brief = assemble(f"\n{personal_label}: {note}\n")
    return brief


#: The shape of the long brief. Kept as a template rather than an f-string so it
#: can be assembled more than once — see the budget trim in `build_prompt`.
_ASSEMBLED = """Redesign this real {space_type} as a {design_style} {mode}, to the standard of a {author}. Photorealistic architectural photograph, not a collage or illustration.

NON-NEGOTIABLE SPATIAL CONSTRAINT:
{geometry}

DESIGN DIRECTION:
- Program: {program}.
- Style: {style_text}; {material} is the hero material.
- {color}
- Lighting: {lighting}; keep the source photograph's light direction.
- Creative character: {freedom}.
{personal}
DESIGN CRAFT:
{craft}

QUALITY: resolve every surface — no unfinished patches, warped, duplicated or floating objects, text, people, logos, watermark. Editorial 35mm photograph: {finish}, crisp microtexture, balanced color grading."""


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
    # No hex codes and no craft rules here: CLIP truncates at 77 tokens, a hex is
    # four of them for something the encoder cannot read as a colour anyway, and
    # a rule that arrives after the cut is worse than one that was never written.
    # "professionally designed" is two tokens and buys the same register.
    return (
        f"photorealistic professionally designed {design_style.lower()} {space_type.lower()} {mode}, "
        f"{program}, {materials}{hero}, {palette}, {light}, "
        f"{lock}architectural photography, 8k, sharp material detail"
    )
