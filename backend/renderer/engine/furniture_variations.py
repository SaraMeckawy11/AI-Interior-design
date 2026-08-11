"""Deterministic furniture families built from Interior_Plan's original source.

The native renderer already has strong authored procedural furniture. This
module expands those builders into coordinated silhouettes without introducing
another external catalog dependency. A project's room name, type, style and
design seed choose a stable variation, so reopening history never reshuffles
the furniture.
"""

from __future__ import annotations

import hashlib
import math

import numpy as np

from archviz_materials import apply_archviz_material


def _style_family(furnisher) -> str:
    style = str(furnisher.config.get("style", "Modern")).lower()
    if any(word in style for word in ("classic", "traditional")):
        return "classic"
    if any(word in style for word in ("industrial", "loft")):
        return "industrial"
    if any(word in style for word in ("boho", "bohemian")):
        return "boho"
    if any(word in style for word in ("scandinavian", "japandi", "minimal")):
        return "quiet"
    if "mid-century" in style:
        return "midcentury"
    return "modern"


def _variation(furnisher, asset_key: str, count: int) -> int:
    signature = "|".join(
        (
            str(furnisher.config.get("name", "room")),
            str(furnisher.config.get("room_type", "")),
            str(furnisher.config.get("style", "Modern")),
            str(furnisher.config.get("design_seed", "variation-v2")),
            str(round(float(furnisher.poly.area), 2)),
            asset_key,
        )
    )
    return int(hashlib.sha1(signature.encode("utf-8")).hexdigest()[:10], 16) % count


STYLE_VARIANTS = {
    "sofa": {
        "modern": (0, 1, 3, 4, 5, 6, 7),
        "quiet": (1, 3, 4, 5, 6, 9),
        "industrial": (0, 2, 4, 5, 7, 8),
        "boho": (3, 4, 5, 6, 8, 9),
        "classic": (0, 2, 7, 8),
        "midcentury": (0, 1, 3, 8, 9),
    },
    "armchair": {
        "modern": (0, 3, 4, 5),
        "quiet": (0, 4, 5, 7),
        "industrial": (2, 3, 6),
        "boho": (4, 5, 7),
        "classic": (0, 1, 2),
        "midcentury": (3, 5, 6, 7),
    },
    "coffee_table": {
        "modern": (0, 1, 2, 3, 4, 6, 7),
        "quiet": (0, 1, 2, 3, 5, 7),
        "industrial": (0, 4, 6, 8),
        "boho": (1, 2, 5, 7, 8),
        "classic": (0, 4, 6, 8),
        "midcentury": (0, 1, 2, 6, 7),
    },
    "dining_chair": {
        "modern": (0, 1, 3, 5, 6),
        "quiet": (0, 3, 4, 5, 7),
        "industrial": (0, 2, 6),
        "boho": (1, 3, 5, 7),
        "classic": (0, 1, 2, 3),
        "midcentury": (0, 3, 5, 6, 7),
    },
    "bed": {
        "modern": (0, 1, 4, 5, 6),
        "quiet": (1, 2, 4, 5),
        "industrial": (2, 3, 4, 5),
        "boho": (2, 3, 5, 6),
        "classic": (0, 1, 3, 6, 7),
        "midcentury": (1, 2, 4, 5, 7),
    },
    "wardrobe": {
        "modern": (0, 1, 2, 3, 4, 7, 8),
        "quiet": (0, 1, 3, 4, 6),
        "industrial": (1, 2, 4, 7),
        "boho": (3, 4, 6),
        "classic": (0, 2, 5, 6),
        "midcentury": (0, 1, 4, 6, 8),
    },
    "tv_unit": {
        "modern": (0, 1, 2, 3, 4, 5),
        "quiet": (0, 1, 2, 4, 5),
        "industrial": (0, 1, 3, 5),
        "boho": (0, 1, 2, 5),
        "classic": (0, 3, 6),
        "midcentury": (0, 1, 2, 4, 5),
    },
}


def _variant_index(furnisher, asset_key: str, count: int) -> int:
    """Choose only silhouettes that belong to the selected design language."""
    family = _style_family(furnisher)
    allowed = STYLE_VARIANTS.get(asset_key, {}).get(family)
    if not allowed:
        return _variation(furnisher, asset_key, count)
    return allowed[_variation(furnisher, asset_key, len(allowed))]


def _sectional_roomy(furnisher, width: float) -> bool:
    rectangle = list(
        furnisher.poly.minimum_rotated_rectangle.exterior.coords
    )
    edges = [
        float(
            np.linalg.norm(
                np.asarray(rectangle[index + 1])
                - np.asarray(rectangle[index])
            )
        )
        for index in range(min(4, len(rectangle) - 1))
    ]
    minor = min(edges, default=0.0)
    area = float(furnisher.poly.area)
    room_type = str(furnisher.config.get("room_type", "")).lower()
    open_plan = (
        "living" in room_type
        and not furnisher.config.get("_plan_has_dining_room", False)
    )
    has_balcony = bool(getattr(furnisher, "balcony_access_zones", ()))
    requested_sectional = any(
        phrase in str(getattr(furnisher, "brief", "")).lower()
        for phrase in ("sectional", "l-shaped", "l shaped", "chaise sofa")
    )
    balcony_tight = has_balcony and minor < 4.20
    balcony_sectional = has_balcony and not requested_sectional
    return (
        area >= 22.0
        and float(width) >= 2.30
        and minor >= 3.65
        and not balcony_tight
        and not balcony_sectional
        and not (open_plan and area < 42.0)
    )


def _finish(meshes, material, tint, strength=0.42, repeat=0.8):
    for mesh in meshes:
        try:
            apply_archviz_material(
                mesh,
                material,
                tint=tint,
                tint_strength=strength,
                repeat_m=repeat,
            )
        except Exception:
            pass


def _rounded(original, width, depth, height, color, **kwargs):
    return original._rounded_cuboid(
        width,
        depth,
        height,
        color,
        roundness=kwargs.pop("roundness", 0.22),
        **kwargs,
    )


def build_sofa(furnisher, original, palette, w=2.2, d=0.95):
    """Ten style-filtered sofa families, including mirrored sectionals."""
    family = _style_family(furnisher)
    variant = _variant_index(furnisher, "sofa", 10)
    roomy = _sectional_roomy(furnisher, w)
    if variant in (4, 5, 6) and not roomy:
        variant %= 4
    fabric = palette["sofa"]
    dark_fabric = original._shade(fabric, 0.88)
    light_fabric = original._shade(fabric, 1.07)
    timber = palette["wood_dark"]
    metal = palette["metal"]
    low = family in {"quiet", "modern"}
    seat_height = 0.30 if low else 0.36
    lift = 0.08 if low else 0.12
    actual_depth = float(d)
    meshes = []

    if variant in (4, 5, 6):
        # Local +Y is the front. The side sign mirrors the chaise without
        # changing the room-facing convention used by the furnisher.
        side = -1 if variant == 4 else 1
        actual_depth = min(1.78, max(d + 0.58, d * 1.62))
        rear_center = -actual_depth / 2 + d / 2
        chaise_width = min(0.88, max(0.68, w * 0.34))
        chaise_x = side * (w / 2 - chaise_width / 2 - 0.02)
        meshes.extend(
            (
                _rounded(
                    original, w, d, seat_height, fabric,
                    cy=rear_center, z=lift, roundness=0.20,
                ),
                _rounded(
                    original, w, 0.18, 0.66 if low else 0.76,
                    dark_fabric,
                    cy=-actual_depth / 2 + 0.09,
                    z=lift + 0.05,
                    roundness=0.18,
                ),
                _rounded(
                    original, chaise_width, actual_depth - 0.10,
                    seat_height, fabric,
                    cx=chaise_x, cy=0.02, z=lift, roundness=0.22,
                ),
                _rounded(
                    original, chaise_width - 0.10, actual_depth - 0.34,
                    0.14, light_fabric,
                    cx=chaise_x, cy=0.10, z=lift + seat_height,
                    roundness=0.30,
                ),
            )
        )
        arm_x = -side * (w / 2 - 0.09)
        meshes.append(
            _rounded(
                original, 0.18, d, 0.54, dark_fabric,
                cx=arm_x, cy=rear_center, z=lift, roundness=0.20,
            )
        )
        if variant == 6:
            # Modular family: visible seat divisions and a movable ottoman.
            module_width = (w - chaise_width - 0.20) / 2
            for module in (-0.5, 0.5):
                x = -side * (chaise_width / 2 + 0.10 + module_width * (module + 0.5))
                meshes.append(
                    _rounded(
                        original, module_width - 0.05, d - 0.30, 0.14,
                        light_fabric,
                        cx=x, cy=rear_center + 0.08,
                        z=lift + seat_height,
                        roundness=0.30,
                    )
                )
    else:
        arm_width = 0.12 if variant in (1, 9) else 0.18 if variant in (2, 7) else 0.22
        back_height = (
            0.46 if variant == 9
            else 0.62 if variant == 7
            else 0.92 if variant == 8
            else 0.58 if variant == 1
            else 0.82 if variant == 2
            else 0.72
        )
        base_shape = _rounded(
            original,
            w,
            d,
            seat_height,
            fabric,
            z=lift,
            roundness=0.30 if variant == 3 else 0.18,
        )
        back = _rounded(
            original,
            w,
            0.18,
            back_height,
            dark_fabric,
            cy=-(d / 2 - 0.09),
            z=lift + 0.04,
            roundness=0.34 if variant == 3 else 0.18,
        )
        meshes.extend((base_shape, back))
        if variant in (3, 8):
            # Soft curved/barrel profile assembled from angled end modules.
            for side in (-1, 1):
                wing = _rounded(
                    original,
                    w * 0.25,
                    0.22,
                    0.60,
                    dark_fabric,
                    cx=side * w * 0.39,
                    cy=-(d * 0.28),
                    z=lift + 0.04,
                    roundness=0.42 if variant == 3 else 0.30,
                )
                wing.rotate(original._rotz(-side * 0.28), center=(0, 0, 0))
                meshes.append(wing)
        elif variant == 9:
            # Armless daybed silhouette with cylindrical end bolsters.
            #
            # The bolster is as tall as it is wide, which is what makes it read
            # as a cylinder at roundness 0.58. That height was missing entirely,
            # so `dark_fabric` slid into the `height` parameter and `color` was
            # left unfilled — a TypeError raised out of the whole furnishing
            # pass, leaving the room empty. It only showed up on the one sofa
            # seed in ten that picks this variant, and the seed includes the
            # style, so changing style could land on it for the first time and
            # look as though the new furniture had simply not arrived.
            for side in (-1, 1):
                meshes.append(_rounded(
                    original,
                    0.26,
                    d - 0.18,
                    0.26,
                    dark_fabric,
                    cx=side * (w / 2 - 0.15),
                    cy=0.03,
                    z=lift + seat_height + 0.04,
                    roundness=0.58,
                ))
        else:
            for side in (-1, 1):
                meshes.append(
                    _rounded(
                        original,
                        arm_width,
                        d,
                        back_height if variant == 7 else 0.50 if variant == 1 else 0.58,
                        original._shade(fabric, 0.96),
                        cx=side * (w / 2 - arm_width / 2),
                        z=lift,
                        roundness=0.22,
                    )
                )
        cushion_count = 3 if w >= 2.35 else 2
        cushion_width = (w - arm_width * 2 - 0.12) / cushion_count
        for index in range(cushion_count):
            x = -w / 2 + arm_width + 0.06 + cushion_width * (index + 0.5)
            meshes.append(
                _rounded(
                    original,
                    cushion_width - 0.045,
                    d - 0.35,
                    0.14,
                    light_fabric,
                    cx=x,
                    cy=0.07,
                    z=lift + seat_height,
                    roundness=0.30,
                )
            )

    foot_material = metal if family in {"modern", "industrial"} else timber
    for side_x in (-1, 1):
        for side_y in (-1, 1):
            meshes.append(
                original._cyl(
                    0.028,
                    lift,
                    foot_material,
                    cx=side_x * (w / 2 - 0.11),
                    cy=side_y * (actual_depth / 2 - 0.11),
                    res=18,
                )
            )
    _finish(meshes[:-4], "curtain_fabric", fabric, strength=0.68, repeat=0.52)
    return meshes, w, actual_depth


def build_armchair(furnisher, original, palette, w=0.92, d=0.85):
    variant = _variant_index(furnisher, "armchair", 8)
    fabric = palette["sofa"]
    if variant == 0:
        return original.build_armchair(palette, w=w, d=d)
    if variant == 1:
        w, d = max(w, 0.94), max(d, 0.90)
    elif variant in (4, 5):
        w, d = max(w, 0.98), max(d, 0.90)
    elif variant == 6:
        w, d = max(w, 0.90), max(d, 0.92)
    if variant == 6:
        # Industrial/Mid-century sling chair on a slim metal frame.
        meshes = [
            _rounded(original, w - 0.14, d - 0.18, 0.14, fabric, z=0.38, roundness=0.34),
            _rounded(original, w - 0.18, 0.12, 0.58, original._shade(fabric, 0.91), cy=-d * 0.36, z=0.46, roundness=0.36),
        ]
        for side in (-1, 1):
            meshes.extend((
                original._bx(0.035, d * 0.84, 0.56, palette["metal"], cx=side * (w / 2 - 0.08), z=0.02),
                original._bx(0.035, 0.035, 0.78, palette["metal"], cx=side * (w / 2 - 0.08), cy=-d * 0.36, z=0.08),
            ))
        _finish(meshes[:2], "curtain_fabric", fabric, strength=0.66, repeat=0.44)
        return meshes, w, d
    if variant == 7:
        # Cane-frame chair: timber structure, woven back and loose cushion.
        meshes = [
            _rounded(original, w - 0.16, d - 0.18, 0.14, fabric, z=0.39, roundness=0.30),
            original._bx(w - 0.12, 0.045, 0.60, original._shade(palette["wood"], 1.08), cy=-d * 0.39, z=0.44),
        ]
        for x in np.linspace(-w * 0.35, w * 0.35, 7):
            meshes.append(original._bx(0.018, 0.018, 0.47, palette["wood_dark"], cx=float(x), cy=-d * 0.41, z=0.50))
        for side in (-1, 1):
            meshes.append(original._bx(0.06, d * 0.80, 0.58, palette["wood_dark"], cx=side * (w / 2 - 0.07), z=0.06))
        _finish(meshes[:1], "curtain_fabric", fabric, strength=0.66, repeat=0.44)
        return meshes, w, d
    meshes = [
        _rounded(original, w, d, 0.32, fabric, z=0.12),
        _rounded(
            original,
            w - 0.08,
            0.18,
            0.72 + (0.18 if variant == 1 else 0),
            original._shade(fabric, 0.90),
            cy=-(d / 2 - 0.09),
            z=0.18,
            roundness=0.30,
        ),
        _rounded(
            original,
            w - 0.28,
            d - 0.30,
            0.14,
            original._shade(fabric, 1.08),
            cy=0.05,
            z=0.44,
            roundness=0.34,
        ),
    ]
    if variant in (1, 2):
        for side in (-1, 1):
            meshes.append(
                _rounded(
                    original,
                    0.18,
                    d,
                    0.62 if variant == 1 else 0.48,
                    original._shade(fabric, 0.95),
                    cx=side * (w / 2 - 0.09),
                    z=0.12,
                    roundness=0.30,
                )
            )
    if variant == 1:
        for side in (-1, 1):
            meshes.append(
                _rounded(
                    original,
                    0.23,
                    0.20,
                    0.46,
                    original._shade(fabric, 0.86),
                    cx=side * (w / 2 - 0.10),
                    cy=-(d / 2 - 0.12),
                    z=0.70,
                    roundness=0.36,
                )
            )
    if variant in (3, 4, 5):
        meshes.extend(
            (
                original._cyl(0.055, 0.22, palette["metal"], z=0.0, res=24),
                original._cyl(0.27, 0.035, palette["metal"], z=0.0, res=32),
            )
        )
    _finish(meshes[:3], "curtain_fabric", fabric, strength=0.66, repeat=0.44)
    return meshes, w, d


def build_coffee_table(furnisher, original, palette, w=1.1, d=0.6):
    variant = _variant_index(furnisher, "coffee_table", 9)
    timber = palette["table"]
    dark = palette["wood_dark"]
    metal = palette["metal"]
    if variant == 0:
        return original.build_coffee_table(palette, w=w, d=d)
    meshes = []
    if variant == 1:
        diameter = min(w, max(d, 0.72))
        meshes.extend(
            (
                original._cyl(diameter / 2, 0.065, timber, z=0.36, res=52),
                original._cyl(0.075, 0.35, metal, z=0.02, res=28),
                original._cyl(diameter * 0.28, 0.035, metal, z=0.0, res=40),
            )
        )
        w = d = diameter
    elif variant == 2:
        large = min(w * 0.62, 0.78)
        small = large * 0.72
        meshes.extend(
            (
                original._cyl(large / 2, 0.055, timber, cx=-w * 0.16, z=0.35, res=48),
                original._cyl(small / 2, 0.055, original._shade(timber, 1.10), cx=w * 0.25, cy=d * 0.12, z=0.42, res=48),
                original._cyl(0.05, 0.34, metal, cx=-w * 0.16, z=0.02, res=20),
                original._cyl(0.045, 0.41, metal, cx=w * 0.25, cy=d * 0.12, z=0.02, res=20),
            )
        )
    elif variant == 3:
        meshes.extend(
            (
                _rounded(original, w, d, 0.10, timber, z=0.35, roundness=0.36),
                _rounded(original, w * 0.72, d * 0.62, 0.28, dark, z=0.05, roundness=0.28),
            )
        )
    elif variant == 4:
        stone = original._mix_color(palette["wall"], palette["table"], 0.30)
        meshes.append(_rounded(original, w, d, 0.065, stone, z=0.38, roundness=0.24))
        for side in (-1, 1):
            meshes.append(
                original._bx(
                    0.035,
                    d - 0.08,
                    0.38,
                    metal,
                    cx=side * (w / 2 - 0.08),
                )
            )
        _finish(meshes[:1], "marble", stone, strength=0.14, repeat=0.72)
    elif variant == 5:
        meshes.extend(
            (
                original._cyl(min(w, d * 1.5) * 0.48, 0.34, timber, z=0.04, res=56),
                original._cyl(min(w, d * 1.5) * 0.49, 0.055, original._shade(timber, 1.10), z=0.38, res=56),
            )
        )
    elif variant == 6:
        # Clear glass slab over a graphic metal base.
        glass = original._mix_color(palette["wall"], [0.70, 0.84, 0.86], 0.52)
        meshes.append(_rounded(original, w, d, 0.045, glass, z=0.40, roundness=0.22))
        for side in (-1, 1):
            brace = original._bx(w * 0.72, 0.035, 0.40, metal, cy=side * d * 0.34)
            brace.rotate(original._rotz(side * 0.20), center=(0, 0, 0))
            meshes.append(brace)
    elif variant == 7:
        # Sculptural kidney-like composition made from offset rounded volumes.
        meshes.extend((
            _rounded(original, w * 0.72, d, 0.10, timber, cx=-w * 0.14, z=0.36, roundness=0.54),
            _rounded(original, w * 0.58, d * 0.82, 0.10, original._shade(timber, 1.10), cx=w * 0.24, cy=d * 0.08, z=0.42, roundness=0.58),
            _rounded(original, w * 0.58, d * 0.52, 0.30, dark, cx=-w * 0.12, z=0.05, roundness=0.44),
        ))
    else:
        # Square tray table for classic and industrial schemes.
        side = min(w, max(0.68, d))
        meshes.extend((
            _rounded(original, side, side, 0.07, timber, z=0.40, roundness=0.14),
            original._bx(side * 0.78, 0.045, 0.39, metal, z=0.01),
            original._bx(0.045, side * 0.78, 0.39, metal, z=0.01),
        ))
        w = d = side
    _finish(meshes, "warm_oak", timber, strength=0.24, repeat=0.78)
    return meshes, w, d


def build_dining_chair(furnisher, original, palette, w=0.46, d=0.48):
    variant = _variant_index(furnisher, "dining_chair", 8)
    if variant == 0:
        return original.build_chair(palette, w=w, d=d)
    if variant in (1, 2):
        w, d = max(w, 0.49), max(d, 0.51)
    elif variant in (5, 7):
        w, d = max(w, 0.48), max(d, 0.52)
    elif variant == 6:
        w, d = max(w, 0.47), max(d, 0.54)
    timber = palette["wood"]
    fabric = palette["sofa"]
    meshes = [
        _rounded(original, w, d, 0.08, fabric, z=0.43, roundness=0.28),
    ]
    if variant in (1, 2):
        meshes.append(
            _rounded(
                original,
                w,
                0.08,
                0.48 if variant == 1 else 0.62,
                fabric if variant == 1 else timber,
                cy=-(d / 2 - 0.04),
                z=0.47,
                roundness=0.26,
            )
        )
    elif variant == 3:
        # The former cylinder was Z-up, so a round chair back rendered as a
        # horizontal floating "pancake" above the seat. Use an upright,
        # softly rounded upholstered back in the chair's X/Z plane.
        meshes.append(
            _rounded(
                original,
                w * 0.94,
                0.10,
                0.46,
                original._shade(fabric, 0.96),
                cy=-(d / 2 - 0.04),
                z=0.49,
                roundness=0.62,
            )
        )
    elif variant == 4:
        for x in np.linspace(-w * 0.38, w * 0.38, 5):
            meshes.append(
                original._bx(
                    0.025,
                    0.04,
                    0.52,
                    timber,
                    cx=float(x),
                    cy=-(d / 2 - 0.03),
                    z=0.45,
                )
            )
    elif variant == 5:
        # Wishbone chair with a broad curved top rail.
        meshes.append(_rounded(original, w, 0.065, 0.18, timber, cy=-(d / 2 - 0.035), z=0.72, roundness=0.54))
        for side in (-1, 1):
            rail = original._bx(0.035, 0.035, 0.52, timber, cx=side * w * 0.40, cy=-(d / 2 - 0.04), z=0.43)
            rail.rotate(original._rotz(-side * 0.18), center=(side * w * 0.40, 0, 0))
            meshes.append(rail)
    elif variant == 6:
        # Cantilever chair with a continuous metal sled.
        meshes.append(_rounded(original, w, 0.075, 0.48, fabric, cy=-(d / 2 - 0.04), z=0.48, roundness=0.24))
        for side in (-1, 1):
            meshes.extend((
                original._bx(0.028, d * 0.88, 0.42, palette["metal"], cx=side * (w / 2 - 0.06)),
                original._bx(0.028, d * 0.88, 0.028, palette["metal"], cx=side * (w / 2 - 0.06), z=0.01),
            ))
    else:
        # Woven/cane back.
        meshes.append(original._bx(w, 0.045, 0.52, original._shade(timber, 1.10), cy=-(d / 2 - 0.03), z=0.46))
        for x in np.linspace(-w * 0.36, w * 0.36, 6):
            meshes.append(original._bx(0.014, 0.018, 0.40, palette["wood_dark"], cx=float(x), cy=-(d / 2 - 0.055), z=0.51))
    if variant != 6:
        for side_x in (-1, 1):
            for side_y in (-1, 1):
                meshes.append(
                    original._bx(
                        0.035,
                        0.035,
                        0.43,
                        palette["wood_dark"],
                        cx=side_x * (w / 2 - 0.05),
                        cy=side_y * (d / 2 - 0.05),
                    )
                )
    _finish(meshes[:2], "curtain_fabric", fabric, strength=0.64, repeat=0.38)
    return meshes, w, d


def build_dining_table(
    furnisher,
    original,
    palette,
    w=1.7,
    d=0.95,
    shape=None,
):
    """Original Livinai table plus five plan- and style-aware table shapes."""
    family = _style_family(furnisher)
    if shape is None:
        choices = {
            "modern": ("rectangular", "oval", "racetrack"),
            "quiet": ("round", "oval", "rounded_rectangle"),
            "industrial": ("rectangular", "racetrack"),
            "boho": ("round", "oval", "square"),
            "classic": ("rectangular", "oval"),
            "midcentury": ("oval", "racetrack", "rounded_rectangle"),
        }.get(family, ("rectangular", "oval"))
        shape = choices[_variation(furnisher, "dining_table_shape", len(choices))]
    shape = str(shape).lower()
    if shape == "rectangular":
        # Preserve the authored table the user preferred.
        return original.build_dining_table(palette, w=w, d=d)

    timber = palette["wood"]
    dark = palette["wood_dark"]
    metal = palette["metal"]
    stone = original._mix_color(palette["table"], palette["wall"], 0.24)
    top_material = stone if family in {"modern", "classic"} and shape == "oval" else timber
    meshes = []

    if shape == "round":
        diameter = min(w, d) if abs(w - d) > 0.02 else w
        w = d = diameter
        meshes.append(original._cyl(diameter / 2, 0.075, top_material, z=0.70, res=56))
    elif shape == "square":
        side = min(w, max(d, 0.82))
        w = d = side
        meshes.append(_rounded(original, side, side, 0.075, top_material, z=0.70, roundness=0.16))
    elif shape == "oval":
        meshes.append(_rounded(original, w, d, 0.075, top_material, z=0.70, roundness=0.68, resolution=30))
    elif shape == "racetrack":
        meshes.append(_rounded(original, w, d, 0.075, top_material, z=0.70, roundness=0.48, resolution=28))
    else:
        shape = "rounded_rectangle"
        meshes.append(_rounded(original, w, d, 0.075, top_material, z=0.70, roundness=0.28, resolution=26))

    if shape in {"round", "square"}:
        meshes.extend((
            original._cyl(max(0.075, min(w, d) * 0.085), 0.66, dark, z=0.04, res=32),
            original._cyl(min(w, d) * 0.27, 0.045, dark, z=0.0, res=44),
        ))
    elif family == "classic":
        # Twin pedestal base keeps longer oval/rectangular tables visually grounded.
        for side in (-1, 1):
            meshes.extend((
                original._cyl(0.11, 0.64, dark, cx=side * w * 0.27, z=0.05, res=28),
                original._cyl(min(0.31, w * 0.16), 0.045, dark, cx=side * w * 0.27, z=0.0, res=36),
            ))
    elif family == "industrial":
        for side in (-1, 1):
            leg = original._bx(0.055, d * 0.76, 0.68, metal, cx=side * (w / 2 - 0.22), z=0.04)
            leg.rotate(original._rotz(side * 0.08), center=(side * (w / 2 - 0.22), 0, 0))
            meshes.append(leg)
        meshes.append(original._bx(w * 0.72, 0.04, 0.06, metal, z=0.34))
    else:
        for side in (-1, 1):
            meshes.append(_rounded(original, 0.12, d * 0.58, 0.67, dark, cx=side * w * 0.28, z=0.03, roundness=0.18))

    # Retain the restrained centerpiece from the preferred original table.
    original_parts = original.build_dining_table(palette, w=max(1.2, w), d=max(0.78, d))[0]
    meshes.extend(original_parts[5:])
    _finish(
        meshes[:1],
        "marble" if top_material is stone else "warm_oak",
        top_material,
        strength=0.16 if top_material is stone else 0.23,
        repeat=max(0.8, w * 0.72),
    )
    return meshes, w, d


def build_bed(furnisher, original, palette, w=1.8, d=2.15):
    variant = _variant_index(furnisher, "bed", 8)
    meshes, w, d = original.build_bed(palette, w=w, d=d)
    # Replace the original flat pillow slabs with upright cushions supported
    # by the headboard. Indices 4:9 are the two sleeping pillows, lumbar
    # cushion and two accent pillows; the folded throw and bed structure stay.
    if len(meshes) >= 10:
        del meshes[4:9]
        linen = original._mix_color(
            original.WHITE_SOFT,
            palette["cushion"],
            0.18,
        )
        accent = original._mix_color(
            palette["accent"],
            palette["cushion"],
            0.35,
        )
        pillow_bottom = 0.58
        pillow_depth = 0.16
        pillow_cy = -(d / 2 - 0.30)
        sleeping_pillows = []
        for side in (-1, 1):
            pillow = _rounded(
                original,
                min(0.68, w * 0.38),
                pillow_depth,
                0.42,
                linen,
                cx=side * w * 0.21,
                cy=pillow_cy,
                z=pillow_bottom,
                roundness=0.48,
            )
            pillow.rotate(
                np.array(
                    [
                        [1.0, 0.0, 0.0],
                        [0.0, math.cos(0.10), -math.sin(0.10)],
                        [0.0, math.sin(0.10), math.cos(0.10)],
                    ]
                ),
                center=(
                    side * w * 0.21,
                    pillow_cy,
                    pillow_bottom + 0.21,
                ),
            )
            sleeping_pillows.append(pillow)
        lumbar = _rounded(
            original,
            min(0.72, w * 0.42),
            0.13,
            0.24,
            accent,
            cy=-(d / 2 - 0.47),
            z=0.60,
            roundness=0.52,
        )
        _finish(
            sleeping_pillows,
            "curtain_fabric",
            linen,
            strength=0.68,
            repeat=0.44,
        )
        _finish(
            [lumbar],
            "curtain_fabric",
            accent,
            strength=0.68,
            repeat=0.38,
        )
        meshes[4:4] = [*sleeping_pillows, lumbar]
    if variant == 1:
        # Channel headboard.
        for x in np.linspace(-w * 0.42, w * 0.42, 7):
            meshes.append(
                original._bx(
                    0.025,
                    0.025,
                    0.86,
                    original._shade(palette["sofa"], 0.76),
                    cx=float(x),
                    cy=-(d / 2 - 0.19),
                    z=0.22,
                )
            )
    elif variant == 2:
        # Timber slat headboard.
        for x in np.linspace(-w * 0.46, w * 0.46, 11):
            meshes.append(
                original._bx(
                    0.035,
                    0.055,
                    1.12,
                    palette["wood_dark"],
                    cx=float(x),
                    cy=-(d / 2 - 0.18),
                    z=0.10,
                )
            )
    elif variant == 3 and float(furnisher.poly.area) >= 15.0:
        # Slim canopy frame.
        for side_x in (-1, 1):
            for side_y in (-1, 1):
                meshes.append(
                    original._bx(
                        0.035,
                        0.035,
                        2.05,
                        palette["metal"],
                        cx=side_x * (w / 2 - 0.04),
                        cy=side_y * (d / 2 - 0.05),
                    )
                )
        meshes.extend(
            (
                original._bx(w - 0.05, 0.03, 0.03, palette["metal"], cy=-d / 2 + 0.05, z=2.02),
                original._bx(w - 0.05, 0.03, 0.03, palette["metal"], cy=d / 2 - 0.05, z=2.02),
            )
        )
    elif variant == 4:
        # Storage drawers along both sides.
        for side in (-1, 1):
            meshes.append(
                original._bx(
                    w * 0.42,
                    0.025,
                    0.24,
                    palette["wood"],
                    cx=side * w * 0.23,
                    cy=d / 2 - 0.08,
                    z=0.10,
                )
            )
    elif variant == 5:
        # Low platform bed with an oversized recessed timber plinth.
        meshes.extend((
            _rounded(original, w + 0.20, d + 0.12, 0.10, palette["wood_dark"], z=0.04, roundness=0.16),
            _rounded(original, w + 0.10, 0.10, 0.64, palette["wood"], cy=-(d / 2 - 0.04), z=0.18, roundness=0.20),
        ))
    elif variant == 6:
        # Wingback headboard suited to hotel, bohemian and classic rooms.
        for side in (-1, 1):
            wing = _rounded(
                original, 0.26, 0.24, 1.10, palette["sofa"],
                cx=side * (w / 2 - 0.11), cy=-(d / 2 - 0.12),
                z=0.16, roundness=0.30,
            )
            wing.rotate(original._rotz(-side * 0.12), center=(side * (w / 2 - 0.11), 0, 0))
            meshes.append(wing)
    elif variant == 7:
        # Sleigh profile with a softly rolled footboard.
        meshes.extend((
            _rounded(original, w, 0.22, 0.90, palette["wood"], cy=-(d / 2 - 0.11), z=0.14, roundness=0.50),
            _rounded(original, w, 0.18, 0.54, palette["wood"], cy=d / 2 - 0.09, z=0.08, roundness=0.50),
        ))
    return meshes, w, d


def build_nightstand(furnisher, original, palette, w=0.48, d=0.42):
    variant = _variation(furnisher, "nightstand", 4)
    if variant == 0:
        return original.build_nightstand(palette, w=w, d=d)
    timber = palette["wood"]
    if variant == 1:
        diameter = min(w, d)
        meshes = [
            original._cyl(diameter / 2, 0.50, timber, z=0.05, res=42),
            original._cyl(diameter * 0.48, 0.04, original._shade(timber, 1.10), z=0.55, res=42),
        ]
        w = d = diameter
    elif variant == 2:
        meshes = [
            _rounded(original, w, d, 0.18, timber, z=0.42, roundness=0.28),
            original._bx(w * 0.82, d * 0.76, 0.025, original._shade(timber, 0.78), z=0.49),
        ]
    else:
        meshes = [
            _rounded(original, w, d, 0.48, timber, z=0.10, roundness=0.20),
            original._bx(w - 0.06, 0.025, 0.16, original._shade(timber, 0.82), cy=d / 2, z=0.28),
        ]
        for side in (-1, 1):
            meshes.append(
                original._cyl(
                    0.025,
                    0.10,
                    palette["metal"],
                    cx=side * (w / 2 - 0.07),
                    cy=side * (d / 2 - 0.07),
                )
            )
    _finish(meshes, "warm_oak", timber, strength=0.24, repeat=0.58)
    return meshes, w, d


def build_wardrobe(furnisher, original, palette, w=1.8, d=0.62):
    """Nine style-filtered wardrobe faces and storage configurations."""
    variant = _variant_index(furnisher, "wardrobe", 9)
    meshes, w, d = original.build_wardrobe(palette, w=w, d=d)
    front = d / 2 + 0.035
    height = 2.08
    if variant == 1:
        # Two broad sliding leaves.
        for side in (-1, 1):
            meshes.append(
                original._bx(
                    w / 2 - 0.035,
                    0.025,
                    height - 0.16,
                    original._shade(palette["cabinet"], 0.96 + side * 0.03),
                    cx=side * w * 0.25,
                    cy=front,
                    z=0.14,
                )
            )
    elif variant == 2:
        mirror = [0.62, 0.68, 0.70]
        panel_width = max(0.28, w / max(2, round(w / 0.62)) - 0.12)
        for side in (-1, 1):
            meshes.append(
                original._bx(
                    panel_width,
                    0.012,
                    height - 0.42,
                    mirror,
                    cx=side * w * 0.25,
                    cy=front + 0.018,
                    z=0.28,
                )
            )
    elif variant == 3:
        # Vertical fluting.
        for x in np.linspace(-w * 0.46, w * 0.46, max(8, int(w / 0.10))):
            meshes.append(
                original._bx(
                    0.025,
                    0.025,
                    height - 0.26,
                    palette["wood_dark"],
                    cx=float(x),
                    cy=front + 0.018,
                    z=0.20,
                )
            )
    elif variant == 4:
        # Contrasting open display column.
        column_x = w / 2 - min(0.24, w * 0.15)
        for z in (0.36, 0.82, 1.28, 1.74):
            meshes.append(
                original._bx(
                    min(0.42, w * 0.26),
                    d * 0.78,
                    0.035,
                    palette["wood_dark"],
                    cx=column_x,
                    z=z,
                )
            )
    elif variant == 5:
        # Classic crown and lower rail.
        meshes.extend(
            (
                original._bx(w + 0.14, d + 0.08, 0.10, palette["wood_dark"], z=2.08),
                original._bx(w + 0.06, 0.04, 0.12, palette["wood_dark"], cy=front, z=0.10),
            )
        )
    elif variant == 6:
        # Woven rattan/cane door fronts.
        panel_count = max(2, round(w / 0.58))
        panel_width = w / panel_count
        cane = original._mix_color(palette["wood"], [0.82, 0.69, 0.46], 0.42)
        for index in range(panel_count):
            x = -w / 2 + panel_width * (index + 0.5)
            meshes.append(original._bx(panel_width - 0.06, 0.022, height - 0.34, cane, cx=x, cy=front + 0.02, z=0.22))
            for rib in (-0.28, -0.10, 0.10, 0.28):
                meshes.append(original._bx(0.012, 0.014, height - 0.46, palette["wood_dark"], cx=x + rib * panel_width, cy=front + 0.04, z=0.28))
    elif variant == 7:
        # Smoked-glass display wardrobe with dark mullions.
        glass = original._mix_color([0.42, 0.52, 0.55], palette["cabinet"], 0.28)
        for side in (-1, 1):
            meshes.append(original._bx(w * 0.44, 0.014, height - 0.28, glass, cx=side * w * 0.24, cy=front + 0.02, z=0.20))
        for x in (-w * 0.48, 0.0, w * 0.48):
            meshes.append(original._bx(0.025, 0.025, height - 0.20, palette["metal"], cx=x, cy=front + 0.04, z=0.14))
    elif variant == 8:
        # High-gloss framed doors, visually lighter for contemporary rooms.
        lacquer = original._mix_color(palette["cabinet"], palette["wall"], 0.34)
        panel_count = max(2, round(w / 0.62))
        panel_width = w / panel_count
        for index in range(panel_count):
            x = -w / 2 + panel_width * (index + 0.5)
            meshes.append(_rounded(original, panel_width - 0.035, 0.025, height - 0.22, lacquer, cx=x, cy=front + 0.02, z=0.15, roundness=0.10))
    return meshes, w, d


def build_sideboard(furnisher, original, palette, w=1.6, d=0.45):
    variant = _variation(furnisher, "sideboard", 5)
    meshes, w, d = original.build_sideboard(palette, w=w, d=d)
    front = d / 2 + 0.015
    if variant == 1:
        for x in np.linspace(-w * 0.44, w * 0.44, max(8, int(w / 0.11))):
            meshes.append(original._bx(0.022, 0.018, 0.66, palette["wood_dark"], cx=float(x), cy=front, z=0.08))
    elif variant == 2:
        for side in (-1, 1):
            meshes.append(original._bx(w * 0.43, 0.018, 0.58, original._shade(palette["cabinet"], 0.94 + side * 0.04), cx=side * w * 0.23, cy=front, z=0.12))
    elif variant == 3:
        for side in (-1, 1):
            meshes.append(original._cyl(0.025, 0.18, palette["metal"], cx=side * (w / 2 - 0.10), cy=side * (d / 2 - 0.06), z=0.0, res=18))
    elif variant == 4:
        stone = original._mix_color(palette["wall"], palette["table"], 0.24)
        top = original._bx(w + 0.04, d + 0.03, 0.055, stone, z=0.80)
        _finish([top], "marble", stone, strength=0.14, repeat=0.72)
        meshes.append(top)
    return meshes, w, d


def build_desk(furnisher, original, palette, w=1.4, d=0.7):
    variant = _variation(furnisher, "desk", 5)
    if variant == 0:
        return original.build_desk(palette, w=w, d=d)
    timber = palette["wood"]
    metal = palette["metal"]
    meshes = [_rounded(original, w, d, 0.07, timber, z=0.72, roundness=0.15)]
    if variant == 1:
        for side in (-1, 1):
            meshes.append(original._bx(0.05, d - 0.08, 0.72, metal, cx=side * (w / 2 - 0.08)))
    elif variant == 2:
        for side in (-1, 1):
            meshes.append(original._bx(w * 0.28, d * 0.72, 0.68, palette["cabinet"], cx=side * w * 0.32, z=0.03))
    elif variant == 3:
        meshes.extend(
            (
                original._bx(w * 0.62, 0.05, 0.68, metal, cy=-d * 0.35),
                original._bx(w * 0.62, 0.05, 0.68, metal, cy=d * 0.35),
            )
        )
    else:
        return_depth = min(1.12, d + 0.40)
        meshes.append(_rounded(original, w * 0.46, return_depth, 0.07, timber, cx=w * 0.27, z=0.72, roundness=0.15))
        d = return_depth
    _finish(meshes[:1], "warm_oak", timber, strength=0.22, repeat=0.82)
    return meshes, w, d


def build_bookshelf(furnisher, original, palette, w=1.6, d=0.34):
    variant = _variation(furnisher, "bookshelf", 5)
    if variant == 0:
        return original.build_bookshelf(palette, w=w, d=d)
    height = 1.88 if variant != 4 else 1.42
    timber = palette["wood"]
    meshes = [
        original._bx(0.055, d, height, timber, cx=-w / 2 + 0.028),
        original._bx(0.055, d, height, timber, cx=w / 2 - 0.028),
    ]
    shelf_levels = (0.04, 0.48, 0.92, 1.36, height - 0.06)
    for level in shelf_levels:
        meshes.append(original._bx(w, d, 0.045, timber, z=level))
    if variant == 1:
        for x in (-w * 0.18, w * 0.22):
            meshes.append(original._bx(0.045, d, height * 0.72, original._shade(timber, 0.90), cx=x, z=0.08))
    elif variant == 2:
        meshes.append(original._bx(w * 0.46, d * 0.92, height * 0.45, palette["cabinet"], cx=w * 0.24, z=0.04))
    elif variant == 3:
        # Ladder frame.
        for side in (-1, 1):
            rail = original._bx(0.045, d, height, palette["metal"], cx=side * (w / 2 - 0.04))
            rail.rotate(original._rotz(side * 0.06), center=(0, 0, 0))
            meshes.append(rail)
    _finish(meshes, "warm_oak", timber, strength=0.22, repeat=0.70)
    return meshes, w, d


def build_tv_unit(furnisher, original, palette, w=1.7, d=0.42):
    """Build a correctly scaled low media console with a wall-mounted screen.

    The old catalog item started with a 50 cm-high solid box and then stacked
    variant-specific wall panels behind the television.  In compact rooms that
    read as a bulky cabinet and, for the stone variant, as a second wall
    colour.  Every style now shares one residentially proportioned console and
    keeps the room wall completely visible behind the directly mounted TV.
    """
    variant = _variant_index(furnisher, "tv_unit", 7)
    w = max(1.35, float(w))
    d = min(0.44, max(0.36, float(d)))
    body_h = 0.32
    body_z = 0.15
    top_z = body_z + body_h
    timber = palette["wood"]
    cabinet = palette["cabinet"]
    dark = palette["wood_dark"]
    metal = palette["metal"]

    # A slim-legged console leaves visible floor below it and keeps the
    # elevation light. Variant 4 is intentionally wall-hung.
    meshes = []
    case = _rounded(
        original,
        w,
        d,
        body_h,
        cabinet if variant in (0, 3, 4) else timber,
        z=body_z,
        roundness=0.08,
    )
    meshes.append(case)
    top = _rounded(
        original,
        w + 0.025,
        d + 0.018,
        0.035,
        timber,
        z=top_z,
        roundness=0.10,
    )
    meshes.append(top)
    if variant != 4:
        for x in (-w * 0.39, w * 0.39):
            for y in (-d * 0.31, d * 0.31):
                meshes.append(
                    original._bx(
                        0.035,
                        0.035,
                        body_z,
                        metal,
                        cx=x,
                        cy=y,
                        z=0.0,
                    )
                )

    front_y = d / 2 + 0.011
    front_h = body_h - 0.07
    front_z = body_z + 0.035
    gap = 0.018
    bay_w = (w - 4 * gap) / 3
    front_tone = (
        original._shade(cabinet, 0.96)
        if variant in (0, 3, 4)
        else original._shade(timber, 0.93)
    )
    fronts = []
    for index in range(3):
        x = -w / 2 + 2 * gap + bay_w / 2 + index * (bay_w + gap)
        front = _rounded(
            original,
            bay_w,
            0.018,
            front_h,
            front_tone,
            cx=x,
            cy=front_y,
            z=front_z,
            roundness=0.05,
        )
        fronts.append(front)
        meshes.append(front)
        meshes.append(
            _rounded(
                original,
                min(0.16, bay_w * 0.28),
                0.018,
                0.014,
                metal,
                cx=x,
                cy=front_y + 0.014,
                z=front_z + front_h * 0.72,
                roundness=0.20,
            )
        )

    # The screen is mounted directly on the continuous room wall.  Its centre
    # and eye line follow normal seated-viewing proportions.
    screen_w = min(1.48, max(1.14, w * 0.86))
    screen_h = screen_w * 0.5625
    screen_bottom = 0.80
    screen = _rounded(
        original,
        screen_w,
        0.050,
        screen_h,
        original.SCREEN_DARK,
        cy=-(d / 2 - 0.05),
        z=screen_bottom,
        roundness=0.035,
    )
    meshes.append(screen)
    soundbar = _rounded(
        original,
        min(0.72, screen_w * 0.48),
        0.075,
        0.048,
        original._shade(metal, 0.70),
        cy=-d * 0.12,
        z=top_z + 0.035,
        roundness=0.24,
    )
    meshes.append(soundbar)

    if variant == 1:
        for x in np.linspace(-w * 0.43, w * 0.43, max(8, int(w / 0.11))):
            meshes.append(
                original._bx(
                    0.018,
                    0.014,
                    front_h,
                    dark,
                    cx=float(x),
                    cy=front_y + 0.018,
                    z=front_z,
                )
            )
    elif variant == 2:
        # A quiet two-tone front, without a contrasting wall-sized backing.
        fronts[1].paint_uniform_color(original._shade(timber, 0.84))
    elif variant == 3:
        # Three balanced drawer fronts form the clean default elevation.
        pass
    elif variant == 4:
        # A recessed shadow line makes the same console read as wall-hung.
        meshes.append(
            original._bx(
                w * 0.72,
                d * 0.72,
                0.035,
                original._shade(palette["wall"], 0.62),
                z=body_z - 0.025,
            )
        )
    elif variant == 5:
        # Recess the last bay for an asymmetric display niche.
        niche = original._bx(
            bay_w - 0.05,
            0.022,
            front_h - 0.05,
            dark,
            cx=w / 2 - 2 * gap - bay_w / 2,
            cy=front_y + 0.020,
            z=front_z + 0.025,
        )
        meshes.append(niche)
    elif variant == 6:
        # Fine shaker rails keep the classic option low and unobtrusive.
        for index in range(3):
            x = -w / 2 + 2 * gap + bay_w / 2 + index * (bay_w + gap)
            meshes.extend(
                (
                    original._bx(
                        bay_w * 0.82,
                        0.010,
                        0.018,
                        dark,
                        cx=x,
                        cy=front_y + 0.020,
                        z=front_z + 0.025,
                    ),
                    original._bx(
                        bay_w * 0.82,
                        0.010,
                        0.018,
                        dark,
                        cx=x,
                        cy=front_y + 0.020,
                        z=front_z + front_h - 0.043,
                    ),
                )
            )
    _finish([case, top, *fronts], "warm_oak", timber, strength=0.20, repeat=0.72)
    return meshes, w, d


def build_kitchen_island(furnisher, original, palette, w=1.8, d=0.9):
    variant = _variation(furnisher, "kitchen_island", 4)
    requested_depth = float(d)
    meshes, w, reported_depth = original.build_island(palette, w=w, d=d)
    # The legacy builder bakes two stools into the island mesh and reports
    # their combined depth as the cabinet footprint.  The room recipe already
    # places editable stools separately, so retaining both doubled the seating
    # and made a standard 90 cm island behave like a 155 cm obstacle.
    if float(reported_depth) > requested_depth + 0.30 and len(meshes) >= 4:
        meshes = meshes[:-4]
    d = requested_depth
    if variant == 1:
        for x in np.linspace(-w * 0.42, w * 0.42, max(7, int(w / 0.13))):
            meshes.append(original._bx(0.025, 0.025, 0.76, palette["wood_dark"], cx=float(x), cy=d / 2 + 0.012, z=0.08))
    elif variant == 2:
        for side in (-1, 1):
            meshes.append(original._bx(0.07, d + 0.04, 0.91, palette["counter"], cx=side * (w / 2 - 0.035)))
    elif variant == 3:
        meshes.append(original._bx(w * 0.48, d * 0.82, 0.62, original._shade(palette["cabinet"], 0.88), cx=w * 0.22, z=0.10))
    return meshes, w, d


def build_wall_art(furnisher, original, palette, w=1.25):
    """Six coordinated wall-art compositions sized to their furniture anchor."""
    family = _style_family(furnisher)
    allowed = {
        "modern": (0, 1, 2, 4),
        "quiet": (0, 1, 3),
        "industrial": (1, 2, 5),
        "boho": (1, 3, 4, 5),
        "classic": (0, 2, 5),
        "midcentury": (0, 1, 2, 4),
    }.get(family, (0, 1, 2))
    variant = allowed[_variation(furnisher, "wall_art", len(allowed))]
    if variant == 0:
        return original.build_art(palette, w=w)

    frame = palette["wood_dark"] if family != "industrial" else palette["metal"]
    canvas = original._shade(palette["wall"], 1.03)
    accent = palette["accent"]
    cushion = palette["cushion"]
    meshes = []

    def panel(width, height, cx=0.0, z=1.22, tone=None):
        meshes.extend((
            original._bx(width, 0.045, height, frame, cx=cx, z=z),
            original._bx(width - 0.055, 0.049, height - 0.055, tone or canvas, cx=cx, cy=0.006, z=z + 0.028),
        ))

    if variant == 1:
        gap = 0.075
        panel_width = (w - gap) / 2
        for side in (-1, 1):
            x = side * (panel_width + gap) / 2
            panel(panel_width, 0.90, x, tone=original._mix_color(canvas, accent, 0.12 if side < 0 else 0.28))
            meshes.append(original._cyl(panel_width * 0.18, 0.018, accent if side < 0 else cushion, cx=x + side * panel_width * 0.08, cy=0.038, z=1.50, res=32))
    elif variant == 2:
        gap = 0.055
        panel_width = (w - gap * 2) / 3
        for index in (-1, 0, 1):
            height = 0.78 if index else 0.98
            panel(panel_width, height, index * (panel_width + gap), 1.20, original._mix_color(canvas, accent, 0.12 + (index + 1) * 0.09))
    elif variant == 3:
        # Woven textile hanging with timber rails and layered bands.
        meshes.extend((
            original._bx(w, 0.045, 0.055, frame, z=2.12),
            original._bx(w * 0.88, 0.035, 0.86, original._mix_color(canvas, cushion, 0.20), cy=0.012, z=1.24),
        ))
        for index, color in enumerate((accent, cushion, original._shade(accent, 0.76))):
            meshes.append(original._bx(w * (0.72 - index * 0.12), 0.018, 0.12, color, cy=0.035, z=1.43 + index * 0.20))
    elif variant == 4:
        # Large organic canvas with offset sculptural forms.
        panel(w, 0.92, tone=original._mix_color(canvas, cushion, 0.10))
        meshes.extend((
            original._cyl(w * 0.18, 0.018, accent, cx=-w * 0.20, cy=0.038, z=1.48, res=40),
            original._cyl(w * 0.12, 0.020, cushion, cx=w * 0.22, cy=0.040, z=1.72, res=40),
            _rounded(original, w * 0.22, 0.022, 0.42, original._shade(accent, 0.78), cx=w * 0.12, cy=0.04, z=1.34, roundness=0.55),
        ))
    else:
        # Gallery grid for layered, classic and industrial interiors.
        columns = 3 if w >= 1.35 else 2
        rows = 2
        gap = 0.055
        panel_width = (w - gap * (columns - 1)) / columns
        for row in range(rows):
            for column in range(columns):
                x = (column - (columns - 1) / 2) * (panel_width + gap)
                tone = original._mix_color(canvas, accent if (row + column) % 2 else cushion, 0.16)
                panel(panel_width, 0.38, x, 1.30 + row * 0.44, tone)
    return meshes, w, 0.08


def build_style_plant(original, palette, tall=True):
    """Style-specific greenery: olive, palm, cactus, topiary or rubber plant."""
    style = str(palette.get("style_label", "Modern")).lower()
    family = (
        "classic" if any(word in style for word in ("classic", "traditional"))
        else "industrial" if "industrial" in style
        else "boho" if "boho" in style
        else "quiet" if any(word in style for word in ("japandi", "scandinavian", "minimal"))
        else "midcentury" if "mid-century" in style
        else "modern"
    )
    height = 1.30 if tall else 0.76
    pot = palette["wood_dark"] if family in {"quiet", "classic"} else palette["accent"]
    green = [0.22, 0.38, 0.20]
    meshes = [
        original._cyl(0.16 if tall else 0.13, 0.28 if tall else 0.22, pot, z=0.0, res=30),
    ]
    if family == "industrial":
        meshes.extend((
            original._cyl(0.055, height - 0.25, green, z=0.24, res=20),
            original._cyl(0.035, height * 0.36, original._shade(green, 1.10), cx=0.10, z=height * 0.48, res=18),
            original._cyl(0.032, height * 0.30, original._shade(green, 0.88), cx=-0.09, z=height * 0.58, res=18),
        ))
    else:
        stems = 5 if family == "boho" else 3 if family == "quiet" else 4
        for index in range(stems):
            angle = (index / stems) * math.tau
            reach = 0.16 + 0.04 * (index % 2)
            x, y = math.cos(angle) * reach, math.sin(angle) * reach
            stem = original._cylinder_between((0, 0, 0.25), (x, y, height * (0.72 + 0.05 * (index % 3))), 0.012, palette["wood_dark"], resolution=12)
            if stem is not None:
                meshes.append(stem)
            leaf_radius = 0.22 if family == "boho" else 0.17 if family == "quiet" else 0.19
            meshes.append(original._sph(leaf_radius, original._shade(green, 0.90 + 0.08 * (index % 3)), cx=x, cy=y, z=height * (0.76 + 0.04 * (index % 3))))
    return meshes, (0.62 if tall else 0.46), (0.62 if tall else 0.46)


def build_style_floor_lamp(original, base_builder, palette):
    """Coordinate the reading lamp silhouette with the selected room style."""
    style = str(palette.get("style_label", "Modern")).lower()
    if not any(word in style for word in ("classic", "traditional", "industrial", "boho", "scandinavian", "japandi", "minimal")):
        return base_builder(palette)
    metal = palette["metal"]
    shade = palette["shade"]
    meshes = [original._cyl(0.18, 0.025, metal, z=0.0, res=36)]
    if "industrial" in style:
        meshes.extend((
            original._bx(0.035, 0.035, 1.52, metal, z=0.02),
            original._bx(0.035, 0.42, 0.035, metal, cy=0.20, z=1.51),
            original._cyl(0.18, 0.24, shade, cy=0.40, z=1.28, res=30),
        ))
    elif any(word in style for word in ("classic", "traditional")):
        meshes.extend((
            original._cyl(0.035, 1.30, metal, z=0.02, res=24),
            original._cyl(0.24, 0.32, shade, z=1.31, res=38),
            original._cyl(0.07, 0.12, palette["accent"], z=1.22, res=28),
        ))
    else:
        # Timber tripod with a broad linen/woven shade.
        for side in (-1, 0, 1):
            leg = original._bx(0.035, 0.035, 1.26, palette["wood_dark"], cx=side * 0.11, cy=abs(side) * 0.05, z=0.02)
            leg.rotate(original._rotz(side * 0.07), center=(side * 0.11, 0, 0))
            meshes.append(leg)
        meshes.append(original._cyl(0.25, 0.30, shade, z=1.27, res=40))
    return meshes, 0.55, 0.55


def _variant_asset_key(furnisher, asset_key, dimensions=None):
    names = {
        "sofa": (
            "tailored_sofa",
            "low_profile_sofa",
            "track_arm_sofa",
            "curved_sofa",
            "left_l_sectional_sofa",
            "right_l_sectional_sofa",
            "modular_sectional_sofa",
            "tuxedo_sofa",
            "camelback_sofa",
            "daybed_sofa",
        ),
        "armchair": (
            "classic_armchair",
            "wingback_armchair",
            "club_armchair",
            "swivel_armchair",
            "barrel_armchair",
            "lounge_shell_armchair",
            "sling_armchair",
            "cane_armchair",
        ),
        "coffee_table": (
            "original_coffee_table",
            "round_pedestal_coffee_table",
            "nesting_coffee_tables",
            "plinth_coffee_table",
            "stone_frame_coffee_table",
            "drum_coffee_table",
            "glass_frame_coffee_table",
            "sculptural_coffee_table",
            "square_tray_coffee_table",
        ),
        "dining_chair": (
            "original_dining_chair",
            "upholstered_dining_chair",
            "high_back_dining_chair",
            "round_back_dining_chair",
            "spindle_dining_chair",
            "wishbone_dining_chair",
            "cantilever_dining_chair",
            "cane_dining_chair",
        ),
        "bed": (
            "tufted_bed",
            "channel_headboard_bed",
            "timber_slat_bed",
            "canopy_bed",
            "storage_bed",
            "low_platform_bed",
            "wingback_bed",
            "sleigh_bed",
        ),
        "nightstand": (
            "original_nightstand",
            "round_nightstand",
            "floating_nightstand",
            "drawer_nightstand",
        ),
        "wardrobe": (
            "panelled_wardrobe",
            "sliding_wardrobe",
            "mirrored_wardrobe",
            "fluted_wardrobe",
            "display_wardrobe",
            "classic_wardrobe",
            "cane_wardrobe",
            "smoked_glass_wardrobe",
            "lacquer_wardrobe",
        ),
        "sideboard": (
            "original_sideboard",
            "fluted_sideboard",
            "two_tone_sideboard",
            "legged_sideboard",
            "stone_top_sideboard",
        ),
        "desk": (
            "original_desk",
            "metal_frame_desk",
            "double_pedestal_desk",
            "trestle_desk",
            "l_shaped_desk",
        ),
        "bookshelf": (
            "original_bookshelf",
            "asymmetric_bookshelf",
            "cabinet_bookshelf",
            "ladder_bookshelf",
            "low_bookshelf",
        ),
        "tv_unit": (
            "slim_media_console",
            "fluted_media_console",
            "two_tone_media_console",
            "drawer_media_console",
            "floating_media_console",
            "asymmetric_media_console",
            "classic_media_console",
        ),
        "kitchen_island": (
            "original_kitchen_island",
            "fluted_kitchen_island",
            "waterfall_kitchen_island",
            "storage_kitchen_island",
        ),
    }
    if asset_key == "dining_table":
        shape = str((dimensions or {}).get("shape", "rectangular"))
        return f"{shape}_dining_table"
    options = names[asset_key]
    index = _variant_index(furnisher, asset_key, len(options))
    if (
        asset_key == "sofa"
        and index in (4, 5, 6)
        and not _sectional_roomy(
            furnisher,
            float((dimensions or {}).get("w", 2.2)),
        )
    ):
        index %= 4
    return options[index]


def install(original):
    """Install original-source variation builders on Interior_Plan."""
    base_method = original.RoomFurnisher.furniture_builder
    base_art_on = original.RoomFurnisher.art_on
    base_floor_lamp = original.build_floor_lamp
    builders = {
        "sofa": build_sofa,
        "armchair": build_armchair,
        "coffee_table": build_coffee_table,
        "dining_chair": build_dining_chair,
        "dining_table": build_dining_table,
        "bed": build_bed,
        "nightstand": build_nightstand,
        "wardrobe": build_wardrobe,
        "sideboard": build_sideboard,
        "desk": build_desk,
        "bookshelf": build_bookshelf,
        "tv_unit": build_tv_unit,
        "kitchen_island": build_kitchen_island,
    }

    def furniture_builder(self, asset_key, procedural_builder):
        builder = builders.get(asset_key)
        if builder is None:
            return base_method(self, asset_key, procedural_builder)

        def build_original_variation(palette, **kwargs):
            built = builder(self, original, palette, **kwargs)
            meshes, _width, _depth = built
            variant_asset_key = _variant_asset_key(self, asset_key, kwargs)
            for mesh in meshes:
                self._editable_mesh_assets[id(mesh)] = (
                    mesh,
                    variant_asset_key,
                )
            return built

        # The variation is the *fallback*, not the answer.
        #
        # This used to return `build_original_variation` directly, and this
        # dictionary names every major piece of furniture — sofa, armchair,
        # coffee table, dining table and chairs, bed, nightstand, wardrobe,
        # sideboard, desk, bookshelf, TV unit. So for all of them the catalogue
        # branch in `base_method` was never reached, and every room was
        # furnished with procedural geometry. Only the assets missing from this
        # dictionary — wall art, sconces, ceiling lights, plants, bathroom
        # fixtures — ever loaded a real model, which is why a walkthrough could
        # have a photoreal pendant hanging over a sofa built from boxes, and why
        # changing the design style moved the palette and nothing else.
        #
        # Handing the variation to `base_method` as its procedural builder keeps
        # both halves honest: the catalogue answers when the style kit names a
        # model, and the variation still answers when the kit says None, when the
        # model cannot be loaded, and when the piece is deliberately designed to
        # the room, like the kitchen island. It also still runs first inside the
        # wrapper, so its measured width and depth are what the catalogue model
        # is scaled to.
        return base_method(self, asset_key, build_original_variation)

    original.RoomFurnisher.furniture_builder = furniture_builder

    def art_on(self, slot_info, w=1.25):
        if not self.wants_wall_decor or self._window_behind(slot_info, w):
            return
        room_type = str(self.config.get("room_type", "")).lower()
        if "office" in room_type:
            return base_art_on(self, slot_info, w=w)
        position = (
            np.asarray(slot_info["pos"], dtype=float)
            - slot_info["n"] * (slot_info["d"] / 2 + 0.01)
        )
        built = build_wall_art(self, original, self.P, w=w)
        variant = _variation(self, "wall_art", 6)
        for mesh in built[0]:
            self._editable_mesh_assets[id(mesh)] = (
                mesh,
                f"coordinated_wall_art_{variant + 1}",
            )
        self.add(
            built,
            position,
            slot_info["yaw"],
            block=False,
            check=False,
        )

    original.RoomFurnisher.art_on = art_on
    original.build_plant = lambda palette, tall=True: build_style_plant(
        original, palette, tall=tall
    )
    original.build_floor_lamp = lambda palette: build_style_floor_lamp(
        original, base_floor_lamp, palette
    )
    return tuple(sorted(builders))
