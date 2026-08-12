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


def build_gen_klein_interior_prompt(
    *, space_type: str, design_style: str, color_tone: str, color_palette=None
) -> str:
    """Return a flexible, whole-room brief that leaves architecture untouched."""
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

    room_key = room_type.lower().strip()
    programmes = {
        # Coffee table and rug are briefed in detail below, so they are not
        # repeated here: the token budget is tight and Klein weights a
        # once-stated instruction more heavily than a twice-stated one.
        "living room": (
            "a conversation group with sofa and complementary seating, and a TV "
            "centred above a media console on a solid wall"
        ),
        "bedroom": "a restful sleeping area, useful bedside surfaces and calm storage",
        "dining room": "a correctly scaled dining group and practical circulation",
        "kitchen": "functional cabinetry, work surfaces, appliances and task lighting",
        "home office": "an ergonomic work area, storage and layered task lighting",
        "kids room": "safe sleep, study, play and accessible storage zones",
        "bathroom": "a functional vanity, bathing zone, storage and suitable lighting",
    }
    programme = programmes.get(
        room_key,
        f"the essential functions of a well-designed {room_type}",
    )

    # The one piece the room is judged on. Naming it, and naming the materials
    # it may be made from, is what stops Klein from filling the focal slot with
    # a vague low box; the brief is shared by every room type, so the coffee
    # table has to be asked for only where a coffee table belongs.
    heroes = {
        "living room": (
            "The coffee table is the hero piece: one sculptural, well-proportioned "
            "table in stone, solid timber or slim metal and glass, low, centred on the rug"
        ),
        "bedroom": (
            "The bed is the hero piece: a well-proportioned upholstered headboard, "
            "crisp layered bedding and two matched nightstands"
        ),
        "dining room": (
            "The dining table is the hero piece: one well-proportioned solid stone "
            "or timber table with matched sculptural chairs"
        ),
        "kitchen": (
            "The island or run of cabinetry is the hero piece: honest stone tops, "
            "flush hardware and one considered splashback"
        ),
        "home office": (
            "The desk is the hero piece: one well-proportioned solid-topped desk "
            "with a refined chair and aligned shelving"
        ),
        "kids room": (
            "The bed is the hero piece: a well-proportioned frame in honest timber "
            "with calm bedding and one playful accent"
        ),
        "bathroom": (
            "The vanity is the hero piece: a well-proportioned stone top, honest "
            "cabinetry and one considered mirror and light"
        ),
    }
    hero = heroes.get(
        room_key,
        "Give the room one well-proportioned hero piece in an honest material and "
        "let everything else support it",
    )

    # Styling asked for by room, so a bathroom is not briefed for cushions and a
    # book stack. Only the selected line reaches the model, so the specific ones
    # cost nothing against the token ceiling.
    decor = {
        "bathroom": (
            "neatly folded towels, one framed piece at eye level, and a small "
            "tray holding a ceramic and a candle"
        ),
        "kitchen": (
            "one framed piece at eye level and a single restrained counter group "
            "at varied heights - a board, a bowl and a ceramic"
        ),
        "dining room": (
            "one large artwork at eye level, a linen runner, and one low "
            "centrepiece group - a bowl, a ceramic and candles"
        ),
    }.get(
        room_key,
        "layered cushions, a folded throw, one large artwork at eye level, and "
        "one tight group per surface at varied heights - books, a "
        "tray, a ceramic, a sculptural object",
    )

    # The opening sentence and the architecture block are worded as they were
    # before the senior-designer pass: "finished scheme, built on the input
    # photo's architecture" read as licence to redesign, and openings moved.
    # Everything creative stays below them, so the lock is read first.
    return (
        f"Redesign this {room_type} in a refined {style} style, using the input "
        "photo as the architectural base.\n\n"
        "ARCHITECTURE - HIGHEST PRIORITY:\n"
        "- Change finishes and movable contents only. Keep every wall, door, "
        "window and balcony opening exactly as it appears: same count, size, "
        "shape, position and sill height. Never add, remove, move, resize, cover "
        "or reshape an opening.\n"
        "- Keep the camera position, framing and perspective identical.\n\n"
        # Architecture is now the only clause marked as a priority, so the lock
        # does not have to share that emphasis with a decor rule.
        "ITEM LIMITS: one ceiling fixture, one floor lamp beside seating, one "
        "potted floor plant; no other lamps or greenery.\n\n"
        "SENIOR DESIGN DIRECTION:\n"
        "- Design as a senior interior designer: balanced proportions, a mix of "
        "large, medium and small forms, one focal point.\n"
        f"- Resolve {programme}. Choose the layout, furniture count and scale from the visible space.\n"
        f"- Designer furniture, clean silhouettes, honest materials. {hero}.\n"
        "- Group seating around a correctly sized rug; align art and lighting with "
        "the furniture below.\n"
        "- Choose all finishes and furnishings as one scheme; force no "
        "predetermined material or color.\n"
        f"- DECORATE: {decor}. Leave most surfaces bare; nothing on the floor.\n"
        f"- COLOR: {color_rule}, weighted as a designer would: lightest or most "
        "muted over the large fields, mid-tones on upholstery, curtains and rugs, "
        "the deepest color in a few small touches.\n"
        "- Consistent undertones, each color echoed in two or three separated "
        "places; no flat wash, muddy neutrals or oversaturation.\n"
        "- Keep walkways clear; no clutter or duplicates.\n"
        "- Photorealistic editorial interior, natural light, believable scale, contact shadows."
    )

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
