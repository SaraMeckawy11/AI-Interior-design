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
3. **60/30/10 colour.** Giving the model an explicit colour ratio is what stops
   the output from turning into a single-hue wash.
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
        "exterior": "warm limestone cladding, timber accents, charcoal metal detailing, integrated lighting, restrained planting",
    },
    "japandi": {
        "interior": "low natural-linen furniture, pale oak, dark timber accents, handmade ceramics, paper lighting, quiet negative space",
        "exterior": "pale mineral render, vertical timber accents, dark frame finishes, stone paths, sculptural planting",
    },
    "scandinavian": {
        "interior": "clean-lined furniture, pale matte oak, wool, linen, soft white walls, simple black details",
        "exterior": "pale timber cladding, warm white render, black frame finishes, native low-maintenance planting",
    },
    "minimalist": {
        "interior": "low straight-lined furniture, seamless pale oak, smooth plaster, tonal textiles, concealed storage, very few objects",
        "exterior": "seamless mineral finishes, concealed surface details, a limited material palette, precise linear landscaping",
    },
    "modern minimalist": {
        "interior": "low straight-lined furniture, seamless pale oak, smooth plaster, tonal textiles, concealed storage, very few objects",
        "exterior": "seamless mineral finishes, concealed surface details, a limited material palette, precise linear landscaping",
    },
    "classic": {
        "interior": "tailored furniture, herringbone oak, marble, silk and velvet, subtle moulding, antique brass",
        "exterior": "natural limestone, restrained applied trim within existing profiles, dark bronze frame finishes, clipped formal planting",
    },
    "traditional": {
        "interior": "tailored furniture, herringbone oak, marble, silk and velvet, subtle moulding, antique brass",
        "exterior": "natural limestone, restrained applied trim within existing profiles, dark bronze frame finishes, clipped formal planting",
    },
    "industrial": {
        "interior": "cognac leather, reclaimed timber, blackened steel, textured plaster, aged brass, worn neutral textiles",
        "exterior": "dark steel detailing, brick or board-formed concrete finishes, weathered timber, architectural grasses",
    },
    "bohemian": {
        "interior": "relaxed low seating, rattan, layered natural textiles, jute, terracotta, vintage objects, abundant plants",
        "exterior": "limewashed surfaces, handmade tile, timber finish accents, terracotta, layered drought-tolerant planting",
    },
    "mediterranean": {
        "interior": "limewashed plaster, warm stone, aged oak, linen, handmade tile, softly curved forms, aged bronze",
        "exterior": "warm limewashed masonry, natural stone, timber, terracotta, aged metal details, olive planting",
    },
    "mid-century modern": {
        "interior": "walnut casegoods, tapered legs, low-slung seating, wool boucle, ceramic and glass accents, warm ochre and olive",
        "exterior": "warm timber cladding, post-and-beam finish details only where already present, gravel and architectural grasses",
    },
    "contemporary": {
        "interior": "soft-edged furniture, layered neutral textiles, warm timber, matte stone, sculptural lighting",
        "exterior": "mixed render and timber finishes, slim dark frame finishes, integrated lighting, structured contemporary planting",
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
    "building": "refinish the existing facade hierarchy, entrance, openings, base and roofline with coherent material transitions and integrated exterior light",
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


def _palette_names(color_palette) -> tuple[str, str, str] | None:
    """The three colours of a 60/30/10 scheme, or None if the client sent none.

    The app derives the secondary and the accent from the tone a person tapped
    and shows all three as circles before they generate, so naming them here is
    what makes the picture match the swatch. Older builds send only the tone
    name; those fall through to the generic clause below.
    """
    if not isinstance(color_palette, dict):
        return None
    dominant = str(color_palette.get("dominant") or "").strip()
    secondary = str(color_palette.get("secondary") or "").strip()
    accent = str(color_palette.get("accent") or "").strip()
    if not (dominant and secondary and accent):
        return None
    return dominant, secondary, accent


def _color_clause(color_tone: str, color_palette) -> str:
    """The 60/30/10 line, as specific as the client allows it to be."""
    names = _palette_names(color_palette)
    if names:
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

    if mode == "exterior" and preserve_geometry:
        geometry = (
            "THE SOURCE PHOTO IS THE IMMUTABLE GEOMETRY MAP. Keep the building pixel-aligned to it: "
            "preserve the exact footprint, silhouette, massing, story count, floor-to-floor heights, "
            "facade width, roof type and pitch, ridges, eaves, parapets, setbacks and projections. "
            "Preserve the facade bay rhythm and the exact count, position, size, aspect ratio, sill and "
            "head height of every window, door and opening. Preserve the entrance, stairs, balconies, "
            "railings, columns, beams, slabs, boundary walls, driveway and all visible neighbouring context. "
            "Keep the original camera position, crop, lens, perspective, horizon, vanishing points and "
            "foreground occlusion. Do not add, remove, move, enlarge, shrink, cover or merge any "
            "architectural element or change its type; do not add a floor, extension, canopy, balcony, arch or new opening."
        )
    elif mode == "exterior":
        geometry = (
            "Keep the source footprint, silhouette, massing, story count, roof form, facade grid, opening "
            "locations and camera perspective. Allow only shallow, buildable finish-level detailing inside "
            "the existing facade profile; never add floors, extensions, balconies or openings."
        )
    else:
        geometry = (
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
    personal = (
        f"\nCLIENT NOTE (apply only when compatible with the immutable source geometry): {custom_prompt.strip()}"
        if (custom_prompt or "").strip()
        else ""
    )

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
        scope = (
            "PERMITTED CHANGES ONLY: repaint or reclad existing opaque surfaces; change material, colour, "
            "frame finish and exterior fixtures without changing their geometry; add surface-mounted lighting; "
            "and refine paving, loose furniture and planting where they do not hide the facade. Treat the style "
            "vocabulary purely as a finish palette, never as permission to remodel the building. If any design "
            "instruction or client note conflicts with the source layout, follow the source image."
        )
        finish = "credible daylight, accurate facade shadows, realistic sky reflections, 35mm architectural photography"

    return f"""Redesign this real {space_type} as a {design_style} {mode} concept. Produce a photorealistic architecture magazine image, not a collage or illustration.

NON-NEGOTIABLE SPATIAL CONSTRAINT:
{geometry}

DESIGN DIRECTION:
- Program: {program}.
- Style vocabulary: {style_text}; make {material} the hero material.
- {_color_clause(color_tone, color_palette)}
- Lighting: {lighting}. Preserve believable light direction from the source photograph.
- Creative character: {freedom}.
{f'- Exterior edit scope: {scope}' if mode == 'exterior' else ''}

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
    # Three colour words instead of one costs about four tokens and is the
    # difference between a palette and a single-hue wash, so it stays even here.
    names = _palette_names(color_palette)
    palette = (
        f"{names[0].lower()} 60 {names[1].lower()} 30 {names[2].lower()} 10 palette"
        if names
        else f"{color_tone.lower()} 60/30/10 palette"
    )
    return (
        f"photorealistic {design_style.lower()} {space_type.lower()} {mode}, {program}, "
        f"{materials}{hero}, {palette}, {light}, "
        f"{lock}architectural photography, 8k, sharp material detail"
    )
