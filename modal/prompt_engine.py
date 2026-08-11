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
