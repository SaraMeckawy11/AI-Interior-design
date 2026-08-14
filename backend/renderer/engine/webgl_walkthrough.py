"""Export Interior_Plan's native scene as a cached, browser-ready PBR glTF.

The desktop scene builder remains the source of truth for geometry, furniture,
UVs and material maps. Only the final renderer changes: glTF lets the browser
keep the entire scene on the GPU, so camera movement never requires a server
round trip.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import sys
from collections import defaultdict
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path

import numpy as np
from PIL import Image


# This repository vendors the exact Livinai_web renderer input beside the
# exporter. Never resolve a second checkout or a machine-specific source root.
INTERIOR_PLAN_ROOT = (Path(__file__).resolve().parent / "interior_plan").resolve()
if str(INTERIOR_PLAN_ROOT) not in sys.path:
    sys.path.insert(0, str(INTERIOR_PLAN_ROOT))
TRIMESH_PACKAGES = INTERIOR_PLAN_ROOT / ".triposr_venv" / "Lib" / "site-packages"
if TRIMESH_PACKAGES.is_dir() and str(TRIMESH_PACKAGES) not in sys.path:
    # This directory supplies trimesh for the native exporter, but it also
    # contains older AI libraries. Keep the web app's own model environment
    # ahead of it so diffusers/transformers stay version-compatible.
    sys.path.append(str(TRIMESH_PACKAGES))

import trimesh  # noqa: E402
import plan_walkthrough as original  # noqa: E402
import archviz_materials as archviz_materials  # noqa: E402
from archviz_materials import apply_archviz_material, material_record_for_mesh  # noqa: E402
from furniture_variations import install as install_furniture_variations  # noqa: E402


WEB_SPATIAL_BOOST = 1.12
WEB_TEXTURE_MAX_SIZE = 256
BALCONY_OPENING_HEIGHT = 2.38

# Practical residential planning dimensions, in metres.  These are deliberately
# conservative enough for a walkthrough while still allowing compact apartments
# to step down to smaller furniture instead of becoming empty.
DESIGN_CLEARANCES = {
    "main_passage": 0.90,
    "secondary_passage": 0.76,
    "bed_side": 0.58,
    "bed_foot": 0.78,
    "wardrobe_front": 0.86,
    "dresser_front": 0.78,
    "sofa_table_gap": 0.40,
    "dining_edge": 0.90,
    "desk_chair_zone": 1.05,
    "storage_front": 0.76,
    "vanity_front": 0.76,
    "toilet_front": 0.76,
}


KITCHEN_TYPE_RULES = {
    "open": {"cabinet_plan": "adaptive", "opening": "wide"},
    "closed": {"cabinet_plan": "u", "opening": "standard"},
    "american": {
        "cabinet_plan": "l",
        "opening": "wide",
        "peninsula": True,
    },
    "galley": {"cabinet_plan": "galley", "opening": "preserve"},
    "l_shaped": {"cabinet_plan": "l", "opening": "preserve"},
    "u_shaped": {"cabinet_plan": "u", "opening": "preserve"},
    "island": {
        "cabinet_plan": "l",
        "opening": "preserve",
        "island": True,
    },
    "peninsula": {
        "cabinet_plan": "l",
        "opening": "wide",
        "peninsula": True,
    },
}


def _kitchen_type_key(value):
    text = str(value or "open").strip().lower().replace("-", " ")
    if "american" in text:
        return "american"
    if "peninsula" in text:
        return "peninsula"
    if "island" in text:
        return "island"
    if "galley" in text:
        return "galley"
    if "closed" in text:
        return "closed"
    if text == "u" or "u shap" in text:
        return "u_shaped"
    if text == "l" or "l shap" in text:
        return "l_shaped"
    return "open"


def _designer_dining_zone(self, position=None, yaw=None, compact=False, guarantee=False):
    """Choose and align a dining set from usable room geometry and style.

    Bistro, round, square, oval, racetrack and rectangular tables are sized
    from real clearances. Every option is squared to the dominant wall and
    reserved as one circulation-safe group.
    """
    area = float(self.poly.area)
    rectangle_points = list(self.poly.minimum_rotated_rectangle.exterior.coords)
    rectangle_vectors = [
        np.asarray(rectangle_points[index + 1], dtype=float)
        - np.asarray(rectangle_points[index], dtype=float)
        for index in range(min(4, len(rectangle_points) - 1))
    ]
    rectangle_edges = [
        float(np.linalg.norm(vector))
        for vector in rectangle_vectors
    ]
    major = max(rectangle_edges, default=0.01)
    minor = max(0.01, min(rectangle_edges, default=0.01))
    aspect = major / minor
    major_index = (
        int(np.argmax(rectangle_edges))
        if rectangle_edges
        else 0
    )
    major_direction = (
        rectangle_vectors[major_index] / max(major, 1e-9)
        if rectangle_vectors
        else np.array([1.0, 0.0], dtype=float)
    )
    if (
        major_direction[0] < -0.01
        or (
            abs(major_direction[0]) <= 0.01
            and major_direction[1] < 0
        )
    ):
        major_direction = -major_direction
    room_type = str(self.config.get("room_type", "")).lower()
    dedicated_dining = "dining" in room_type
    open_plan_dining = (
        "living" in room_type
        and not self.config.get("_plan_has_dining_room", False)
    )
    door_entries = list(getattr(self, "door_access_entries", ()))
    circulation_sensitive = open_plan_dining and bool(door_entries)

    wall_slots = self.wall_slots(include_windows=True)
    if open_plan_dining and position is None:
        kitchen_anchor = self._kitchen_xy()
        balcony_zones = list(getattr(self, "balcony_access_zones", ()))
        if kitchen_anchor is not None:
            # Serving distance wins: the dining table belongs on the kitchen
            # side of an open-plan living room. Pull toward the kitchen but stay
            # inside this room, so the set lands at the kitchen end rather than
            # against the wall between them.
            toward = kitchen_anchor - self.centroid
            norm = float(np.linalg.norm(toward))
            if norm > 1e-6:
                position = self.centroid + (toward / norm) * min(
                    2.40, norm * 0.55
                )
            else:
                position = self.centroid
        elif balcony_zones:
            # No kitchen context: put dining in the balcony's natural light.
            biggest = max(balcony_zones, key=lambda z: z.area)
            anchor = np.array(
                [biggest.centroid.x, biggest.centroid.y], dtype=float
            )
            inward = self.centroid - anchor
            norm = float(np.linalg.norm(inward))
            inward = inward / norm if norm > 1e-6 else major_direction
            position = anchor + inward * 0.95
        else:
            zoning_direction = major_direction
            zoning_sign = -1.0
            if door_entries:
                entry_delta = (
                    np.asarray(door_entries[0]["center"], dtype=float)
                    - self.centroid
                )
                entry_projection = float(
                    np.dot(entry_delta, zoning_direction)
                )
                if abs(entry_projection) > 0.18:
                    zoning_sign = math.copysign(1.0, entry_projection)
            position = (
                self.centroid
                + zoning_direction
                * zoning_sign
                * min(2.20, major * 0.24)
            )
    structural_yaws = []
    for slot in wall_slots[:8]:
        direction = np.asarray(slot["dir"], dtype=float)
        candidate = float(math.atan2(direction[1], direction[0])) % math.pi
        if not any(abs(math.sin(candidate - known)) < 0.08 for known in structural_yaws):
            structural_yaws.append(candidate)
    if yaw is not None:
        requested = float(yaw) % math.pi
        structural_yaws.sort(key=lambda value: abs(math.sin(value - requested)))
    if door_entries:
        access_reference = (
            np.asarray(position, dtype=float)
            if position is not None
            else self.centroid
        )
        nearest_entry = min(
            door_entries,
            key=lambda entry: np.linalg.norm(
                np.asarray(entry["center"], dtype=float) - access_reference
            ),
        )
        access_direction = np.asarray(nearest_entry["inward"], dtype=float)
        access_yaw = float(
            math.atan2(access_direction[1], access_direction[0])
        ) % math.pi
        if not any(
            abs(math.sin(access_yaw - known)) < 0.08
            for known in structural_yaws
        ):
            structural_yaws.insert(0, access_yaw)
        elif circulation_sensitive:
            structural_yaws.sort(
                key=lambda value: abs(math.sin(value - access_yaw))
            )
    if not structural_yaws:
        structural_yaws = [float(yaw or 0.0), float(yaw or 0.0) + math.pi / 2]

    chair_builder = self.furniture_builder("dining_chair", original.build_chair)

    def editable_table(builder, shape):
        def build(palette, w, d):
            built = builder(palette, w=w, d=d, shape=shape)
            for mesh in built[0]:
                self._editable_mesh_assets[id(mesh)] = (
                    mesh,
                    f"{shape}_dining_table",
                )
            return built
        return build

    style = str(self.config.get("style", "Modern")).lower()
    signature = "|".join((
        str(self.config.get("name", "room")),
        style,
        str(self.config.get("design_seed", "variation-v3")),
        str(round(area, 2)),
    ))
    style_pick = int(hashlib.sha1(signature.encode("utf-8")).hexdigest()[:8], 16)
    source_table_builder = self.furniture_builder(
        "dining_table",
        original.build_dining_table,
    )

    if compact:
        target_seats = 4
    elif open_plan_dining:
        # Only the kitchen-side allocation belongs to dining; the total room
        # also contains the lounge. Never size an open-plan table from the
        # whole living-room area.
        target_seats = (
            6
            if (
                area >= 46.0
                and minor >= 4.0
                and not circulation_sensitive
            )
            else 4
        )
    elif dedicated_dining:
        if area >= 28.0 and major >= 5.0 and minor >= 3.6:
            target_seats = 8
        elif area >= 15.0 and minor >= 2.8:
            target_seats = 6
        elif area >= 8.0 and minor >= 2.1:
            target_seats = 4
        else:
            target_seats = 2
    else:
        target_seats = 4 if area < 14.0 or minor < 2.8 else 6

    def long_shape(seats):
        """The elongated silhouette this style would draw for `seats`."""
        if any(word in style for word in ("industrial", "traditional")):
            shape_options = ("rectangular", "racetrack")
        elif any(word in style for word in ("scandinavian", "japandi", "minimal")):
            shape_options = ("oval", "rounded_rectangle", "rectangular")
        elif any(word in style for word in ("classic", "bohemian", "boho")):
            shape_options = ("oval", "rectangular")
        else:
            shape_options = ("rectangular", "oval", "racetrack", "rounded_rectangle")
        return shape_options[(style_pick + seats) % len(shape_options)]

    def shape_candidates(seats):
        """Table silhouettes for `seats`, the one the room suits first.

        A circle is the default dining table, and the first shape tried
        anywhere it can work: it seats four in the smallest footprint of any
        shape, has no corner to walk into beside a doorway, and is the right
        answer in the square-ish rooms most plans draw. The other shapes are
        chosen by the space rather than by taste — a square top where a
        formal, genuinely square room wants one, and the long family once the
        room is clearly elongated or the table has to seat six.

        Returning a list instead of one shape is what makes that a fit rather
        than a guess: each candidate is offered to the pose search in turn, so
        a narrow room that cannot take a round table gets the rectangle it can
        take instead of losing its table altogether.
        """
        long_pick = long_shape(seats)
        if seats >= 6:
            # Six covers do not fit around a residential round table.
            return (long_pick, "rectangular")
        balanced = aspect <= 1.24
        formal = any(
            word in style
            for word in ("classic", "traditional", "industrial")
        )
        if aspect > 1.45:
            # A clearly elongated room reads as a long table — except for a
            # two-seater, which is a bistro table wherever it stands.
            return (
                ("round", long_pick, "square")
                if seats <= 2
                else (long_pick, "round", "square")
            )
        if seats == 4 and balanced and formal and not circulation_sensitive:
            return ("square", "round", long_pick)
        return ("round", "square", long_pick)

    def table_template(seats, shape, clearance=None):
        dining_clearance = (
            float(clearance)
            if clearance is not None
            else 0.58
            if open_plan_dining
            else DESIGN_CLEARANCES["dining_edge"]
        )
        if shape == "round":
            width = depth = 0.88 if seats <= 2 else 1.06
        elif shape == "square":
            width = depth = 0.86 if seats <= 2 else 0.98
        else:
            dimensions = {
                2: (1.02, 0.72),
                4: (1.26 if circulation_sensitive else 1.36, 0.78),
                6: (1.78, 0.92),
                8: (2.26, 1.02),
            }
            width, depth = dimensions[seats]
            if shape == "oval":
                width += 0.06
            elif shape == "racetrack":
                width += 0.03

        if shape in ("round", "square"):
            # In open plans, tuck chairs into their everyday position and keep
            # the main circulation lane outside the dining zone. Dedicated
            # dining rooms retain the full pull-back allowance.
            zone_width = zone_depth = (
                width + dining_clearance * 2
            )
        else:
            # Four-seat rectangular tables have no end chairs, but still need
            # a walk-by margin.  Six- and eight-seat layouts reserve the full
            # chair-and-passage allowance at both ends.
            end_clearance = (
                min(
                    DESIGN_CLEARANCES["secondary_passage"],
                    dining_clearance,
                )
                if seats <= 4
                else dining_clearance
            )
            zone_width = width + end_clearance * 2
            zone_depth = depth + dining_clearance * 2
        return {
            "seats": seats,
            "shape": shape,
            "width": width,
            "depth": depth,
            "zone_width": zone_width,
            "zone_depth": zone_depth,
        }

    seat_candidates = {
        8: (8, 6, 4, 2),
        6: (6, 4, 2),
        4: (4, 2),
        2: (2,),
    }[target_seats]

    # The pull-back allowance, and what to do when the room cannot give it.
    #
    # A 0.90 m allowance on every edge is the right number for a room with
    # space to spare, and it is why small dining rooms used to come back with
    # no table at all: a 3 m square room inset for its walls leaves 2.76 m, the
    # smallest four-seat zone at full allowance is 2.86 m, and the keep-clear
    # corridor in front of the door takes a bite out of what is left. Every
    # size failed, and the room — the one room named after its table — was
    # furnished with a sideboard and nothing to eat at.
    #
    # So the allowance steps down before the table does. Each rung is still a
    # usable gap to pull a chair back into; a slightly tight dining room is a
    # far better answer than an empty one.
    default_clearance = (
        0.58 if open_plan_dining else DESIGN_CLEARANCES["dining_edge"]
    )
    clearance_ladder = [None] + [
        value
        for value in (0.76, 0.62, 0.50)
        if value < default_clearance
    ]

    def find_pose_for(candidate):
        if open_plan_dining and position is not None:
            safe_room = self.poly.buffer(-0.12)
            for candidate_yaw in structural_yaws:
                preferred_footprint = original.footprint_poly(
                    np.asarray(position, dtype=float),
                    candidate_yaw,
                    candidate["zone_width"],
                    candidate["zone_depth"],
                )
                if (
                    preferred_footprint.within(safe_room)
                    and not any(
                        preferred_footprint.intersects(zone)
                        for zone in self.door_zones
                    )
                    and not any(
                        preferred_footprint.intersects(placed)
                        for placed in self.placed
                    )
                ):
                    return {
                        "pos": np.asarray(position, dtype=float),
                        "yaw": candidate_yaw,
                        "footprint": preferred_footprint,
                    }
        return self.find_open_pose(
            candidate["zone_width"],
            candidate["zone_depth"],
            preferred=position,
            yaws=structural_yaws,
        )

    selected = None
    pose = None
    for clearance in clearance_ladder:
        for seat_count in seat_candidates:
            for shape in shape_candidates(seat_count):
                candidate = table_template(seat_count, shape, clearance)
                candidate_pose = find_pose_for(candidate)
                if candidate_pose is not None:
                    selected = candidate
                    pose = candidate_pose
                    break
            if pose is not None:
                break
        if pose is not None:
            break

    smallest = seat_candidates[-1]
    if selected is None:
        selected = table_template(
            smallest,
            shape_candidates(smallest)[0],
            clearance_ladder[-1],
        )
    if pose is None:
        # A dining room with no dining table is not a dining room. Once every
        # size, shape and allowance has been tried, stand the set on the room's
        # centre and let the person move it, rather than hand back an empty
        # floor. Other rooms keep the old behaviour and simply go without.
        if not guarantee and not dedicated_dining:
            return None
        forced = np.asarray(position, dtype=float) if position is not None else self.centroid
        forced_yaw = structural_yaws[0]
        pose = {
            "pos": forced,
            "yaw": forced_yaw,
            "footprint": original.footprint_poly(
                forced,
                forced_yaw,
                selected["zone_width"],
                selected["zone_depth"],
            ),
        }

    # Once a valid open-plan pose is found, slide the complete set toward the
    # kitchen along the room's long axis. This clears the sofa-to-TV sightline
    # while keeping the cook-to-table route short and every doorway usable.
    if open_plan_dining and pose is not None:
        kitchen_position = self._kitchen_xy()
        if kitchen_position is not None:
            current_center = np.asarray(pose["pos"], dtype=float)
            kitchen_delta = kitchen_position - current_center
            kitchen_sign = math.copysign(
                1.0,
                float(np.dot(kitchen_delta, major_direction)) or 1.0,
            )
            kitchen_axis = major_direction * kitchen_sign
            lateral_axis = np.array(
                [-kitchen_axis[1], kitchen_axis[0]],
                dtype=float,
            )
            safe_room = self.poly.buffer(-0.12)
            for shift in (1.40, 1.20, 1.00, 0.80, 0.60, 0.40, 0.20):
                shifted = False
                for lateral_shift in (
                    0.0,
                    0.25,
                    -0.25,
                    0.45,
                    -0.45,
                    0.65,
                    -0.65,
                ):
                    shifted_center = (
                        current_center
                        + kitchen_axis * shift
                        + lateral_axis * lateral_shift
                    )
                    shifted_footprint = original.footprint_poly(
                        shifted_center,
                        float(pose["yaw"]),
                        selected["zone_width"],
                        selected["zone_depth"],
                    )
                    if (
                        shifted_footprint.within(safe_room)
                        and not any(
                            shifted_footprint.intersects(zone)
                            for zone in self.door_zones
                        )
                        and not any(
                            shifted_footprint.intersects(placed)
                            for placed in self.placed
                        )
                    ):
                        pose = {
                            **pose,
                            "pos": shifted_center,
                            "footprint": shifted_footprint,
                        }
                        shifted = True
                        break
                if shifted:
                    break

    chair_count = selected["seats"]
    table_shape = selected["shape"]
    table_width = selected["width"]
    table_depth = selected["depth"]
    zone_width = selected["zone_width"]
    zone_depth = selected["zone_depth"]
    table_builder = editable_table(source_table_builder, table_shape)

    center = np.asarray(pose["pos"], dtype=float)
    table_yaw = float(pose["yaw"])
    self.place_rug(center, table_yaw, zone_width - 0.1, zone_depth - 0.1)
    self.add(
        table_builder(self.P, w=table_width, d=table_depth),
        center,
        table_yaw,
        block=False,
        avoid_doors=False,
        check=False,
    )

    placed_chair_count = 0

    def place_dining_chair(position, chair_yaw):
        nonlocal placed_chair_count
        placed = self.add(
            chair_builder(self.P),
            position,
            chair_yaw,
            block=False,
            avoid_doors=True,
            check=True,
        )
        if placed:
            placed_chair_count += 1
        return placed

    if table_shape == "round":
        chair_radius = table_width / 2 + 0.36
        for index in range(chair_count):
            angle = table_yaw + (2 * math.pi * index / chair_count)
            chair_pos = center + np.array([math.cos(angle), math.sin(angle)]) * chair_radius
            facing = center - chair_pos
            place_dining_chair(
                chair_pos,
                original.yaw_facing(facing),
            )
    elif table_shape == "square":
        chair_radius = table_width / 2 + 0.36
        chair_layout = (
            ((0.0, chair_radius), (0.0, -chair_radius))
            if chair_count == 2
            else (
                (chair_radius, 0.0),
                (-chair_radius, 0.0),
                (0.0, chair_radius),
                (0.0, -chair_radius),
            )
        )
        local_x = np.array([math.cos(table_yaw), math.sin(table_yaw)])
        local_y = np.array([-math.sin(table_yaw), math.cos(table_yaw)])
        for x, y in chair_layout:
            chair_pos = center + local_x * x + local_y * y
            place_dining_chair(
                chair_pos,
                original.yaw_facing(center - chair_pos),
            )
    else:
        local_x = np.array([math.cos(table_yaw), math.sin(table_yaw)])
        local_y = np.array([-math.sin(table_yaw), math.cos(table_yaw)])
        side_offset = table_depth / 2 + 0.36
        side_chairs = 1 if chair_count == 2 else 2 if chair_count <= 6 else 3
        longitudinal_positions = (
            (0.0,)
            if side_chairs == 1
            else (-table_width * 0.27, table_width * 0.27)
            if side_chairs == 2
            else (-table_width * 0.31, 0.0, table_width * 0.31)
        )
        for side in (-1, 1):
            for offset in longitudinal_positions:
                chair_pos = center + local_y * side * side_offset + local_x * offset
                place_dining_chair(
                    chair_pos,
                    original.yaw_facing(-local_y * side),
                )
        if chair_count in (6, 8):
            end_offset = table_width / 2 + 0.38
            for side in (-1, 1):
                chair_pos = center + local_x * side * end_offset
                place_dining_chair(
                    chair_pos,
                    original.yaw_facing(-local_x * side),
                )

    reserved_dining_zone = pose["footprint"].buffer(
        0.10 if open_plan_dining else 0.18
    )
    self.placed.append(reserved_dining_zone)
    self._livinai_dining_footprints = [
        *getattr(self, "_livinai_dining_footprints", ()),
        reserved_dining_zone,
    ]
    self.pendant(center)
    return {
        "pos": center,
        "yaw": table_yaw,
        "footprint": pose["footprint"],
        "shape": table_shape,
        "seats": placed_chair_count,
    }


_ORIGINAL_LIVING_ANCHOR_SLOTS = original.RoomFurnisher.living_anchor_slots
_ORIGINAL_AGAINST_WALL = original.RoomFurnisher.against_wall


def _living_anchor_slots_with_clear_media_axis(self, sofa_width=2.35):
    """Keep the native lounge orientation and zone it as one composition.

    The native renderer already understands the architectural hierarchy of the
    room. We preserve its preferred sofa wall, then test a few restrained
    lateral adjustments along that wall. The seating group only changes
    orientation when its original wall cannot support the conversation zone,
    balcony route, dining separation, and a wall-mounted TV together.
    """
    ranked = _ORIGINAL_LIVING_ANCHOR_SLOTS(self, sofa_width=sofa_width)
    if not ranked:
        return ranked
    dining_footprints = list(
        getattr(self, "_livinai_dining_footprints", self.placed)
    )
    dining_centers = [
        np.array([footprint.centroid.x, footprint.centroid.y], dtype=float)
        for footprint in dining_footprints
    ]
    # The sofa is placed BEFORE the dining set, so `dining_footprints` is still
    # empty here and the seating group used to stay dead-centre on its wall —
    # leaving a large useless gap at one end (typically in front of the balcony)
    # and squeezing the dining table into whatever was left. When this room will
    # also host dining, reserve the far end of the room now — the end away from
    # the entry door, biased to the balcony when there is one — so the sofa is
    # pushed toward the opposite end and the dining zone gets a real allocation.
    if not dining_centers and self.config.get("_livinai_expects_dining", False):
        anticipated = None
        kitchen_anchor = self._kitchen_xy()
        balcony_zones = list(getattr(self, "balcony_access_zones", ()))
        if kitchen_anchor is not None:
            # Dining is zoned to the kitchen side, so the seating group must be
            # pushed to the opposite end of the room.
            anticipated = kitchen_anchor
        elif balcony_zones:
            biggest = max(balcony_zones, key=lambda zone: zone.area)
            anticipated = np.array(
                [biggest.centroid.x, biggest.centroid.y], dtype=float
            )
        elif door_entries_for_zoning := list(
            getattr(self, "door_access_entries", ())
        ):
            entry = np.asarray(
                door_entries_for_zoning[0]["center"], dtype=float
            )
            anticipated = self.centroid + (self.centroid - entry)
        # Zoning must separate the two groups ALONG the room's long axis. A
        # balcony centred on a short wall points across that axis and produced a
        # zero shift, which is exactly how the sofa ended up centred with dead
        # space beside it. Project any balcony/entry hint onto the long axis and
        # push the anticipated dining zone a real distance down it.
        rectangle = list(self.poly.minimum_rotated_rectangle.exterior.coords)
        vectors = [
            np.asarray(rectangle[index + 1], dtype=float)
            - np.asarray(rectangle[index], dtype=float)
            for index in range(min(4, len(rectangle) - 1))
        ]
        if vectors:
            longest = max(vectors, key=lambda v: float(np.linalg.norm(v)))
            extent = float(np.linalg.norm(longest))
            if extent > 1e-6:
                axis = longest / extent
                toward = 1.0
                if anticipated is not None:
                    projection = float(
                        np.dot(anticipated - self.centroid, axis)
                    )
                    if abs(projection) > 0.20:
                        toward = math.copysign(1.0, projection)
                anticipated = (
                    self.centroid + axis * toward * min(2.60, extent * 0.30)
                )
        if anticipated is not None:
            dining_centers = [anticipated]

    expanded = []
    for original_rank, slot in enumerate(ranked):
        travel = max(0.0, (float(slot["len"]) - sofa_width - 0.24) / 2)
        target_offset = 0.0
        if dining_centers and travel >= 0.18:
            dining_center = min(
                dining_centers,
                key=lambda center: np.linalg.norm(
                    np.asarray(slot["mid"], dtype=float) - center
                ),
            )
            dining_projection = float(
                np.dot(
                    dining_center - np.asarray(slot["mid"], dtype=float),
                    np.asarray(slot["dir"], dtype=float),
                )
            )
            if abs(dining_projection) >= 0.18:
                shift_size = min(
                    travel * 0.72,
                    max(
                        0.75,
                        min(1.20, abs(dining_projection) + 0.25),
                    ),
                )
                target_offset = -math.copysign(
                    shift_size,
                    dining_projection,
                )
        offsets = [target_offset, target_offset * 0.65, 0.0]
        if travel >= 0.50 and abs(target_offset) < 0.18:
            offsets.extend((-min(0.65, travel * 0.35), min(0.65, travel * 0.35)))
        for offset in offsets:
            candidate = dict(slot)
            candidate["mid"] = (
                np.asarray(slot["mid"], dtype=float)
                + np.asarray(slot["dir"], dtype=float) * offset
            )
            candidate["_livinai_original_rank"] = original_rank
            candidate["_livinai_shift"] = abs(offset)
            candidate["_livinai_target_error"] = abs(
                offset - target_offset
            )
            sofa_pos, sofa_yaw = self._centered_wall_pose(
                candidate,
                sofa_width,
                0.98,
            )
            if not self._candidate_clear(
                original.footprint_poly(
                    sofa_pos,
                    sofa_yaw,
                    sofa_width,
                    0.98,
                )
            ):
                continue
            if any(
                np.linalg.norm(candidate["mid"] - existing["mid"]) < 0.08
                and existing["edge"] is candidate["edge"]
                for existing in expanded
            ):
                continue
            expanded.append(candidate)
    if expanded:
        ranked = expanded
    solid_slots = self.wall_slots()

    def quality(slot, fallback_rank):
        original_rank = slot.get("_livinai_original_rank", fallback_rank)
        sofa_pos, sofa_yaw = self._centered_wall_pose(slot, sofa_width, 0.98)
        facing = np.asarray(slot["n"], dtype=float)
        lateral = np.asarray(slot["dir"], dtype=float)
        conversation_zone = original.footprint_poly(
            sofa_pos + facing * 1.05,
            sofa_yaw,
            min(4.20, sofa_width + 1.60),
            2.50,
        )
        safe_room = self.poly.buffer(-0.08)
        coverage = (
            conversation_zone.intersection(safe_room).area
            / max(conversation_zone.area, 1e-9)
            if not safe_room.is_empty
            else 0.0
        )
        dining_overlap = sum(
            conversation_zone.intersection(footprint).area
            for footprint in dining_footprints
        )
        balcony_overlap = sum(
            conversation_zone.intersection(zone).area
            for zone in getattr(self, "balcony_access_zones", ())
        )
        media_candidates = [
            other
            for other in solid_slots
            if (
                other is not slot
                and other["len"] >= 1.20
                and np.dot(other["n"], facing) < -0.55
                and np.dot(np.asarray(other["mid"]) - sofa_pos, facing) > 1.25
            )
        ]
        axes = []
        for media_slot in media_candidates[:4]:
            television_width = min(
                1.70,
                max(1.20, float(media_slot["len"]) - 0.12),
            )
            media_travel = max(
                0.0,
                (float(media_slot["len"]) - television_width - 0.12) / 2,
            )
            alignment_shift = float(
                np.dot(
                    sofa_pos - np.asarray(media_slot["mid"], dtype=float),
                    np.asarray(media_slot["dir"], dtype=float),
                )
            )
            alignment_shift = float(
                np.clip(alignment_shift, -media_travel, media_travel)
            )
            aligned_slot = dict(media_slot)
            aligned_slot["mid"] = (
                np.asarray(media_slot["mid"], dtype=float)
                + np.asarray(media_slot["dir"], dtype=float)
                * alignment_shift
            )
            media_pos, _media_yaw = self._centered_wall_pose(
                aligned_slot,
                television_width,
                0.42,
            )
            forward_distance = float(np.dot(media_pos - sofa_pos, facing))
            lateral_offset = abs(float(np.dot(media_pos - sofa_pos, lateral)))
            if forward_distance <= 1.35:
                continue
            clear_depth = max(0.20, forward_distance - 0.70)
            corridor_center = sofa_pos + facing * (
                0.49 + clear_depth / 2
            )
            corridor = original.footprint_poly(
                corridor_center,
                original.yaw_facing(facing),
                min(1.85, max(1.20, sofa_width * 0.72)),
                clear_depth,
            )
            obstruction = sum(
                corridor.intersection(footprint).area
                for footprint in dining_footprints
            )
            axes.append((obstruction, lateral_offset, forward_distance))
        if axes:
            obstruction, lateral_offset, distance = min(axes)
        else:
            obstruction, lateral_offset, distance = (99.0, 99.0, 99.0)
        return (
            1 if balcony_overlap > 0.025 else 0,
            1 if dining_overlap > 0.06 else 0,
            1 if coverage < 0.86 else 0,
            1 if not axes else 0,
            1
            if lateral_offset > max(0.65, sofa_width * 0.32)
            else 0,
            1 if obstruction > 0.18 else 0,
            original_rank,
            1 if obstruction > 0.035 else 0,
            round(float(slot.get("_livinai_target_error", 0.0)), 4),
            round(dining_overlap + obstruction, 4),
            round(lateral_offset, 4),
            round(abs(distance - 3.2), 4),
        )

    return [
        slot
        for original_rank, slot in sorted(
            enumerate(ranked),
            key=lambda item: quality(item[1], item[0]),
        )
    ]


def _builder_asset_key(builder):
    """Read the stable asset key captured by a furniture-builder closure."""
    for cell in getattr(builder, "__closure__", ()) or ():
        try:
            value = cell.cell_contents
        except ValueError:
            continue
        if isinstance(value, str) and value in {
            "sofa",
            "tv_unit",
            "wardrobe",
            "sideboard",
            "bed",
            "dining_table",
        }:
            return value
    return None


def _against_wall_with_centered_media(
    self,
    builder,
    slots=None,
    min_side=0.0,
    prefer=None,
    block=True,
    avoid_doors=True,
    **kwargs,
):
    """Keep the media unit on a wall and prefer a clear sofa-to-TV route."""
    if _builder_asset_key(builder) == "tv_unit" and slots:
        sofa_objects = [
            item
            for item in self.editable_objects
            if str(item.get("asset_key", "")).endswith("sofa")
        ]
        if sofa_objects:
            sofa = sofa_objects[-1]
            sofa_position = np.asarray(sofa["position"], dtype=float)
            sofa_yaw = float(sofa["yaw"])
            facing = np.array(
                [-math.sin(sofa_yaw), math.cos(sofa_yaw)],
                dtype=float,
            )
            lateral = np.array([facing[1], -facing[0]], dtype=float)
            dining_footprints = getattr(
                self,
                "_livinai_dining_footprints",
                (),
            )
            requested_width = float(kwargs.get("w", 1.35))
            ranked_slots = []
            for slot_rank, slot in enumerate(slots):
                aligned_slot = dict(slot)
                available_travel = max(
                    0.0,
                    (
                        float(slot["len"])
                        - requested_width
                        - 0.12
                    )
                    / 2,
                )
                alignment_shift = float(
                    np.dot(
                        sofa_position
                        - np.asarray(slot["mid"], dtype=float),
                        np.asarray(slot["dir"], dtype=float),
                    )
                )
                alignment_shift = float(
                    np.clip(
                        alignment_shift,
                        -available_travel,
                        available_travel,
                    )
                )
                aligned_slot["mid"] = (
                    np.asarray(slot["mid"], dtype=float)
                    + np.asarray(slot["dir"], dtype=float)
                    * alignment_shift
                )
                media_position = (
                    np.asarray(aligned_slot["mid"], dtype=float)
                    + np.asarray(aligned_slot["n"], dtype=float)
                    * (original.WALL_GAP + 0.21)
                )
                forward_distance = float(
                    np.dot(media_position - sofa_position, facing)
                )
                lateral_offset = abs(
                    float(
                        np.dot(
                            media_position - sofa_position,
                            lateral,
                        )
                    )
                )
                if forward_distance <= 0.65:
                    ranked_slots.append(
                        (2, lateral_offset, slot_rank, aligned_slot)
                    )
                    continue
                corridor_start = max(
                    0.64,
                    float(sofa["depth"]) / 2 + 0.18,
                )
                corridor_depth = max(
                    0.20,
                    forward_distance - corridor_start - 0.18,
                )
                corridor = original.footprint_poly(
                    sofa_position
                    + facing * (corridor_start + corridor_depth / 2),
                    original.yaw_facing(facing),
                    min(1.85, max(1.25, float(sofa["width"]) * 0.72)),
                    corridor_depth,
                )
                dining_obstruction = sum(
                    corridor.intersection(footprint).area
                    for footprint in dining_footprints
                )
                ranked_slots.append(
                    (
                        1 if dining_obstruction > 0.035 else 0,
                        lateral_offset,
                        slot_rank,
                        aligned_slot,
                    )
                )
            # Do not discard usable wall slots: retaining them prevents the
            # renderer from forcing a freestanding TV into a compact lounge.
            slots = [
                item[3]
                for item in sorted(
                    ranked_slots,
                    key=lambda item: (item[0], item[1], item[2]),
                )
            ]
    return _ORIGINAL_AGAINST_WALL(
        self,
        builder,
        slots=slots,
        min_side=min_side,
        prefer=prefer,
        block=block,
        avoid_doors=avoid_doors,
        **kwargs,
    )


def _window_behind(self, slot_info, width):
    """True if a window sits on the wall directly behind a wall-anchored item.

    Used to stop art/mirrors being hung over glazing. The current Interior_Plan
    release no longer ships this helper even though the Livinai furnishing layer
    (art_on, mirror placement) still relies on it; without it every room's
    furnishing raised AttributeError and aborted after its first few pieces,
    leaving rooms nearly empty. Missing/edge-less slot info is treated as "no
    window" so decor still gets placed.
    """
    slot = slot_info.get("slot") if isinstance(slot_info, dict) else None
    edge = slot.get("edge") if isinstance(slot, dict) else None
    if not edge:
        return False
    openings = edge.get("openings") or []
    if not openings:
        return False
    p1 = np.asarray(edge["p1"], dtype=float)
    p2 = np.asarray(edge["p2"], dtype=float)
    span = p2 - p1
    length = float(edge.get("length") or np.linalg.norm(span))
    if length < 1e-6:
        return False
    unit = span / length
    pos = np.asarray(slot_info.get("pos", (p1 + p2) / 2), dtype=float)
    t_center = float(np.dot(pos - p1, unit)) / length
    half = (float(width) / 2 + 0.08) / length
    lo, hi = t_center - half, t_center + half
    for kind, t0, t1 in openings:
        if "window" not in str(kind):
            continue
        if min(float(t1), hi) > max(float(t0), lo):
            return True
    return False


_ORIGINAL_WALL_SLOTS = original.RoomFurnisher.wall_slots


def _wall_slots_with_windows(self, include_windows=False):
    """Free wall runs, longest first, optionally treating windows as usable.

    The Livinai dining/anchor overrides call `wall_slots(include_windows=True)`
    so a dining table, sideboard or sofa may sit along a glazed wall, but the
    current Interior_Plan release ships a `wall_slots()` with no such parameter,
    which raised TypeError and aborted living-room furnishing (no dining zone).
    The default (windows block, like doors) delegates to the original.
    """
    if not include_windows:
        return _ORIGINAL_WALL_SLOTS(self)
    slots = []
    for e in self.edges:
        length = e["length"]
        if length < 0.7:
            continue
        p1, p2 = np.array(e["p1"]), np.array(e["p2"])
        pad = 0.30 / length
        openings = [
            o for o in e.get("openings", []) if "window" not in str(o[0])
        ]
        blocked = sorted(
            (max(0.0, t0 - pad), min(1.0, t1 + pad)) for _, t0, t1 in openings
        )
        end_margin = 0.18 / length
        cursor, free = end_margin, []
        for b0, b1 in blocked:
            if b0 > cursor:
                free.append((cursor, b0))
            cursor = max(cursor, b1)
        if cursor < 1 - end_margin:
            free.append((cursor, 1 - end_margin))
        span = p2 - p1
        unit = span / np.linalg.norm(span)
        normal = self._inward_normal(p1, p2)
        for f0, f1 in free:
            flen = (f1 - f0) * length
            if flen < 0.5:
                continue
            slots.append(dict(
                edge=e, p1=p1, p2=p2, t0=f0, t1=f1, len=flen,
                mid=p1 + span * ((f0 + f1) / 2), dir=unit, n=normal,
            ))
    slots.sort(key=lambda s: -s["len"])
    return slots


def _kitchen_xy(self):
    """Kitchen centroid if a cross-room context supplied one, else None.

    The open-plan dining override nudges the dining set toward the kitchen when
    it knows where the kitchen is. A single-room furnisher usually does not, and
    the current Interior_Plan release omits this helper entirely (another
    AttributeError that aborted living-room furnishing). Returning the optional
    stored position — or None — keeps dining placement working either way.
    """
    position = getattr(self, "_kitchen_position", None)
    if position is None:
        return None
    return np.asarray(position, dtype=float)


# The browser and CPU walkthroughs share this imported Interior_Plan class.
# Installing the upgraded method here keeps both outputs spatially identical.
original.RoomFurnisher.wall_slots = _wall_slots_with_windows
original.RoomFurnisher._window_behind = _window_behind
original.RoomFurnisher._kitchen_xy = _kitchen_xy
original.RoomFurnisher.place_dining_zone = _designer_dining_zone
original.RoomFurnisher.living_anchor_slots = (
    _living_anchor_slots_with_clear_media_axis
)
ORIGINAL_VARIATION_ASSETS = install_furniture_variations(original)
original.RoomFurnisher.against_wall = _against_wall_with_centered_media


_ACTIVE_BALCONIES = ContextVar("livinai_active_balconies", default=())
_ACTIVE_BALCONY_SCALE = ContextVar("livinai_active_balcony_scale", default=None)
_ACTIVE_BALCONY_CURTAIN_OWNERS = ContextVar(
    "livinai_active_balcony_curtain_owners",
    default=(),
)
_ORIGINAL_ASSIGN_OPENINGS = original.assign_openings
_ORIGINAL_BUILD_ROOM_TRIM = original.build_room_trim
_ORIGINAL_ROOM_FURNISHER_INIT = original.RoomFurnisher.__init__
_ORIGINAL_GET_PALETTE = original.get_palette
_ORIGINAL_BUILD_ROOM_DESIGN_SURFACES = original.build_room_design_surfaces


def _normalize_balcony_door_segments(balconies, scale):
    """Give balcony doors the same minimum clear width as normal doors."""
    if not balconies or scale is None:
        return tuple(balconies or ())
    minimum_pixels = float(original.MIN_DOOR_W) * float(scale)
    normalized = []
    for item in balconies:
        if len(item) < 2:
            continue
        start = np.asarray(item[0], dtype=float)
        end = np.asarray(item[1], dtype=float)
        vector = end - start
        length = float(np.linalg.norm(vector))
        if length > 1e-6 and length < minimum_pixels:
            direction = vector / length
            midpoint = (start + end) / 2
            start = midpoint - direction * minimum_pixels / 2
            end = midpoint + direction * minimum_pixels / 2
        normalized.append(
            (
                start.tolist(),
                end.tolist(),
                *item[2:],
            )
        )
    return tuple(normalized)


def _balcony_curtain_owner_records(balconies, rooms, configs, scale):
    """Choose one room to dress each shared balcony opening.

    A single structural balcony edge can belong to two adjoining room
    polygons.  Building trim from both sides created the doubled rods and
    mismatched curtain panels seen in the walkthrough.  Prefer the living side
    of a shared edge, then dining/studio, then a bedroom.
    """
    if not balconies or not rooms or scale is None:
        return ()
    room_records = []
    for index, room in enumerate(rooms):
        world = [original.px_to_m_real(point, scale) for point in room]
        polygon = original.Polygon(
            [(point[0], point[1]) for point in world]
        ).buffer(0)
        if polygon.is_empty:
            continue
        room_type = str(
            (configs[index] if configs and index < len(configs) else {}).get(
                "room_type",
                "",
            )
        ).lower()
        if "living" in room_type:
            priority = 0
        elif any(word in room_type for word in ("dining", "studio")):
            priority = 1
        elif any(word in room_type for word in ("bedroom", "guest", "kids")):
            priority = 2
        else:
            priority = 3
        room_records.append((priority, index, polygon))

    owners = []
    for item in balconies:
        if len(item) < 2:
            continue
        opening_a = np.asarray(original.px_to_m_real(item[0], scale), dtype=float)
        opening_b = np.asarray(original.px_to_m_real(item[1], scale), dtype=float)
        opening_line = original.LineString([opening_a, opening_b])
        opening_length = float(opening_line.length)
        if opening_length < 0.20:
            continue
        candidates = []
        band = opening_line.buffer(0.075, cap_style=2)
        for priority, index, polygon in room_records:
            overlap = float(polygon.boundary.intersection(band).length)
            if (
                polygon.boundary.distance(opening_line) <= 0.075
                and overlap >= min(0.30, opening_length * 0.35)
            ):
                candidates.append((priority, index, polygon))
        if not candidates:
            continue
        _, owner_index, owner_polygon = min(
            candidates,
            key=lambda value: (value[0], value[1]),
        )
        centre = owner_polygon.centroid
        owners.append(
            {
                "midpoint": np.asarray(
                    [
                        opening_line.centroid.x,
                        opening_line.centroid.y,
                    ],
                    dtype=float,
                ),
                "length": opening_length,
                "room_index": owner_index,
                "room_centroid": np.asarray(
                    [centre.x, centre.y],
                    dtype=float,
                ),
            }
        )
    return tuple(owners)


@contextmanager
def balcony_opening_context(
    balconies,
    pixels_per_meter=None,
    rooms=None,
    doors=None,
    configs=None,
):
    """Expose balcony segments to the native builder without merging them into doors."""
    measured_scale = pixels_per_meter
    if measured_scale is None and rooms:
        measured_scale = original.estimate_px_per_m(rooms, doors or [])
    world_scale = (
        float(measured_scale) / float(original.SCALE_BOOST)
        if measured_scale
        else None
    )
    normalized_balconies = _normalize_balcony_door_segments(
        balconies,
        world_scale,
    )
    balcony_token = _ACTIVE_BALCONIES.set(normalized_balconies)
    scale_token = _ACTIVE_BALCONY_SCALE.set(world_scale)
    owner_token = _ACTIVE_BALCONY_CURTAIN_OWNERS.set(
        _balcony_curtain_owner_records(
            normalized_balconies,
            rooms,
            configs,
            world_scale,
        )
    )
    try:
        yield
    finally:
        _ACTIVE_BALCONY_CURTAIN_OWNERS.reset(owner_token)
        _ACTIVE_BALCONY_SCALE.reset(scale_token)
        _ACTIVE_BALCONIES.reset(balcony_token)


def _strict_aligned_opening_candidates(all_room_edges, a, b):
    """Return only wall edges that genuinely run along an authored opening."""
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    vector = b - a
    segment_length = float(np.linalg.norm(vector))
    if segment_length < 0.18:
        return []
    segment_direction = vector / segment_length
    segment_line = original.LineString([a, b])
    candidates = []
    for room_index, edges in enumerate(all_room_edges):
        for edge_index, edge in enumerate(edges):
            p1 = np.asarray(edge["p1"], dtype=float)
            p2 = np.asarray(edge["p2"], dtype=float)
            edge_vector = p2 - p1
            edge_length = float(np.linalg.norm(edge_vector))
            if edge_length < 0.24:
                continue
            edge_direction = edge_vector / edge_length
            alignment = abs(float(np.dot(edge_direction, segment_direction)))
            line_distance = float(edge["line"].distance(segment_line))
            # An authored opening is a span ON its intended wall. Never use
            # the old relaxed corner fallback: it was cutting the side wall of
            # the adjacent room whenever a door ended close to a corner.
            if alignment < 0.90 or line_distance > 0.28:
                continue
            projected = sorted(
                float(np.dot(point - p1, edge_direction))
                for point in (a, b)
            )
            overlap_start = max(0.0, projected[0])
            overlap_end = min(edge_length, projected[1])
            overlap = overlap_end - overlap_start
            if overlap < min(0.18, segment_length * 0.20):
                continue
            # Carry the opening cleanly through a collinear room-edge seam.
            # This deliberately has no automatic five-centimetre wall pier.
            # Traced room boundaries commonly differ by 5–10 cm at a shared
            # junction. Treat that drafting tolerance as the same endpoint so
            # no narrow full-height wall stub survives between two openings.
            start = 0.0 if projected[0] <= 0.12 else overlap_start / edge_length
            end = 1.0 if projected[1] >= edge_length - 0.12 else overlap_end / edge_length
            candidates.append({
                "room_index": room_index,
                "edge_index": edge_index,
                "edge": edge,
                "start": max(0.0, min(1.0, start)),
                "end": max(0.0, min(1.0, end)),
                "overlap": overlap,
                "alignment": alignment,
                "distance": line_distance,
            })
    return candidates


def _opening_meets_perpendicular_opening(a, b, authored_segments):
    """True when a doorway terminates inside another authored doorway."""
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    vector = b - a
    length = float(np.linalg.norm(vector))
    if length < 1e-6:
        return False
    direction = vector / length
    for other_a, other_b in authored_segments:
        other_a = np.asarray(other_a, dtype=float)
        other_b = np.asarray(other_b, dtype=float)
        other_vector = other_b - other_a
        other_length = float(np.linalg.norm(other_vector))
        if other_length < 1e-6:
            continue
        other_direction = other_vector / other_length
        if abs(float(np.dot(direction, other_direction))) >= 0.35:
            continue
        other_line = original.LineString([other_a, other_b])
        if any(
            float(other_line.distance(original.Point(endpoint))) <= 0.18
            for endpoint in (a, b)
        ):
            return True
    return False


def _merge_strict_openings(all_room_edges):
    """Merge only overlapping spans, never separate nearby door drawings."""
    for edges in all_room_edges:
        for edge in edges:
            length = max(float(edge["length"]), 1e-9)
            grouped = {}
            for kind, start, end in edge.get("openings", ()):
                family = (
                    "door"
                    if kind in ("door", "door_hole")
                    else "balcony"
                    if kind in ("balcony", "balcony_hole")
                    else str(kind)
                )
                grouped.setdefault(family, []).append((kind, float(start), float(end)))
            merged_openings = []
            for family, items in grouped.items():
                items.sort(key=lambda item: item[1])
                merged = []
                for kind, start, end in items:
                    if merged and (start - merged[-1][2]) * length <= 0.025:
                        previous_kind, previous_start, previous_end = merged[-1]
                        frame_kind = "door" if family == "door" else "balcony"
                        hole_kind = "door_hole" if family == "door" else "balcony_hole"
                        combined_kind = (
                            frame_kind
                            if kind == frame_kind or previous_kind == frame_kind
                            else hole_kind
                            if family in ("door", "balcony")
                            else previous_kind
                        )
                        merged[-1] = (
                            combined_kind,
                            previous_start,
                            max(previous_end, end),
                        )
                    else:
                        merged.append((kind, start, end))
                merged_openings.extend(merged)
            edge["openings"] = merged_openings


def _assign_strict_opening_segments(
    all_room_edges,
    segments,
    *,
    frame_kind,
    hole_kind,
    one_edge_only=False,
    suppress_t_frames=False,
):
    assigned = []
    normalized_segments = [
        (np.asarray(item[0], dtype=float), np.asarray(item[1], dtype=float))
        for item in segments
        if len(item) >= 2
    ]
    for segment_index, (a, b) in enumerate(normalized_segments):
        candidates = _strict_aligned_opening_candidates(all_room_edges, a, b)
        if not candidates:
            continue
        candidates.sort(
            key=lambda item: (
                item["overlap"],
                item["alignment"],
                -item["distance"],
            ),
            reverse=True,
        )
        selected = candidates[:1] if one_edge_only else candidates
        for candidate in selected:
            candidate["edge"]["openings"].append(
                (hole_kind, candidate["start"], candidate["end"])
            )
        suppress_frame = suppress_t_frames and _opening_meets_perpendicular_opening(
            a,
            b,
            [
                segment
                for other_index, segment in enumerate(normalized_segments)
                if other_index != segment_index
            ],
        )
        if not suppress_frame:
            owner = selected[0]
            owner["edge"]["openings"][-1] = (
                frame_kind,
                owner["start"],
                owner["end"],
            )
        assigned.append((a, b))
    return assigned


def _assign_openings_with_balconies(all_room_edges, doors_m, windows_m):
    # The edges are freshly built for this scene, but explicitly clear the
    # opening list so a retry cannot retain a permissive legacy assignment.
    for edges in all_room_edges:
        for edge in edges:
            edge["openings"] = []
    door_infos = _assign_strict_opening_segments(
        all_room_edges,
        doors_m,
        frame_kind="door",
        hole_kind="door_hole",
        suppress_t_frames=True,
    )
    _assign_strict_opening_segments(
        all_room_edges,
        windows_m,
        frame_kind="window",
        hole_kind="window",
        one_edge_only=True,
    )
    balconies_px = _ACTIVE_BALCONIES.get()
    if not balconies_px:
        _merge_strict_openings(all_room_edges)
        return door_infos

    # build_scene has already converted rooms, doors and windows to metres.
    # Convert the separately typed balcony spans with the same measured scale.
    scale = _ACTIVE_BALCONY_SCALE.get()
    if scale is None:
        _merge_strict_openings(all_room_edges)
        return door_infos
    balconies_m = [
        (
            original.px_to_m_real(item[0], scale),
            original.px_to_m_real(item[1], scale),
        )
        for item in balconies_px
        if len(item) >= 2
    ]
    if not balconies_m:
        _merge_strict_openings(all_room_edges)
        return door_infos

    balcony_infos = _assign_strict_opening_segments(
        all_room_edges,
        balconies_m,
        frame_kind="balcony",
        hole_kind="balcony_hole",
    )
    _merge_strict_openings(all_room_edges)
    return door_infos + balcony_infos


def _balcony_frame(op1, op2, wall_angle, frame_color=None):
    """Slim full-height perimeter trim that never fills the balcony passage."""
    op1 = np.asarray(op1, dtype=float)
    op2 = np.asarray(op2, dtype=float)
    length = float(np.linalg.norm(op2 - op1))
    if length < 1e-6:
        return []
    depth = max(float(original.WALL_THICKNESS) + 0.055, 0.16)
    color = frame_color or [0.18, 0.19, 0.19]

    def bar(x0, x1, z0, z1):
        mesh = original.o3d.geometry.TriangleMesh.create_box(
            width=max(0.012, x1 - x0),
            height=depth,
            depth=max(0.012, z1 - z0),
        )
        mesh.translate((x0, -depth / 2, z0))
        mesh.rotate(original._rotz(wall_angle), center=(0, 0, 0))
        mesh.translate((op1[0], op1[1], 0))
        return original._paint(mesh, color)

    jamb = 0.035
    head = 0.045
    return [
        bar(-jamb, 0.0, 0.0, BALCONY_OPENING_HEIGHT),
        bar(length, length + jamb, 0.0, BALCONY_OPENING_HEIGHT),
        bar(-jamb, length + jamb, BALCONY_OPENING_HEIGHT - head, BALCONY_OPENING_HEIGHT),
    ]


def _build_walls_with_balconies(edges, wall_color, material_name=None, trim_color=None):
    """Native structural walls with a real floor-level balcony cutout."""
    meshes = []
    wall_meshes = []

    def add_wall(mesh):
        if mesh is not None:
            wall_meshes.append(mesh)

    for edge in edges:
        p1 = np.asarray(edge["p1"], dtype=float)
        p2 = np.asarray(edge["p2"], dtype=float)
        if edge["length"] < 0.1:
            continue
        direction = (p2 - p1) / np.linalg.norm(p2 - p1)
        extension = direction * (float(original.WALL_THICKNESS) * 0.75)

        def segment(a, b, z0, z1, extend_a=False, extend_b=False):
            a = np.asarray(a, dtype=float)
            b = np.asarray(b, dtype=float)
            if extend_a:
                a -= extension
            if extend_b:
                b += extension
            return original.wall_segment(a, b, z0, z1, wall_color)

        wall_angle = math.atan2(p2[1] - p1[1], p2[0] - p1[0])
        length = float(edge["length"])
        last = 0.0
        for kind, start, end in sorted(
            edge.get("openings", []), key=lambda value: value[1]
        ):
            start = max(last, min(1.0, max(0.0, float(start))))
            end = max(start, min(1.0, max(0.0, float(end))))
            if (start - last) * length > 0.02:
                add_wall(
                    segment(
                        p1 + (p2 - p1) * last,
                        p1 + (p2 - p1) * start,
                        0.0,
                        original.WALL_H,
                        extend_a=last <= 0.001,
                    )
                )
            opening_a = p1 + (p2 - p1) * start
            opening_b = p1 + (p2 - p1) * end
            if kind in ("balcony", "balcony_hole"):
                if BALCONY_OPENING_HEIGHT < float(original.WALL_H) - 0.01:
                    add_wall(
                        original.wall_segment(
                            opening_a,
                            opening_b,
                            BALCONY_OPENING_HEIGHT,
                            original.WALL_H,
                            wall_color,
                        )
                    )
                if kind == "balcony":
                    meshes.extend(
                        _balcony_frame(
                            opening_a,
                            opening_b,
                            wall_angle,
                            frame_color=trim_color,
                        )
                    )
            elif kind in ("door", "door_hole"):
                add_wall(
                    original.wall_segment(
                        opening_a,
                        opening_b,
                        original.DOOR_HEIGHT,
                        original.WALL_H,
                        wall_color,
                    )
                )
                if kind == "door":
                    meshes.extend(
                        original._door_frame(
                            opening_a,
                            opening_b,
                            wall_angle,
                            frame_color=trim_color,
                        )
                    )
            else:
                add_wall(
                    original.wall_segment(
                        opening_a,
                        opening_b,
                        0.0,
                        original.WINDOW_SILL,
                        wall_color,
                    )
                )
                add_wall(
                    original.wall_segment(
                        opening_a,
                        opening_b,
                        original.WINDOW_SILL + original.WINDOW_HEIGHT,
                        original.WALL_H,
                        wall_color,
                    )
                )
                for window_mesh in original.create_window_geometry(
                    opening_a, opening_b, wall_angle
                ):
                    vertices = np.asarray(window_mesh.vertices)
                    is_fake_floor_spill = (
                        len(vertices)
                        and float(vertices[:, 2].max()) <= 0.02
                        and float(vertices[:, 2].min()) >= -0.001
                        and len(vertices) <= 4
                    )
                    if not is_fake_floor_spill:
                        meshes.append(window_mesh)
            last = end
        if (1.0 - last) * length > 0.02:
            add_wall(
                segment(
                    p1 + (p2 - p1) * last,
                    p2,
                    0.0,
                    original.WALL_H,
                    extend_a=last <= 0.001,
                    extend_b=True,
                )
            )
    if wall_meshes:
        combined = wall_meshes[0]
        for part in wall_meshes[1:]:
            combined += part
        if material_name:
            apply_archviz_material(
                combined,
                material_name,
                tint=wall_color,
                tint_strength=0.32 if material_name != "wallpaper" else 0.18,
            )
        meshes.insert(0, combined)
    return meshes


def _build_wall_finish_skins_with_balconies(
    room_m,
    edges,
    wall_color,
    material_name,
):
    """Keep decorative wall finishes out of balcony openings as well."""
    polygon = original.Polygon([(point[0], point[1]) for point in room_m])
    if not polygon.is_valid:
        polygon = polygon.buffer(0)
    meshes = []
    tint_strength = {
        "wallpaper": 0.14,
        "limewash": 0.30,
        "bathroom_tile": 0.20,
        "concrete": 0.18,
    }.get(material_name, 0.30)
    surface_material = "marble" if material_name == "bathroom_tile" else material_name

    for edge in edges:
        p1 = np.asarray(edge["p1"], dtype=float)
        p2 = np.asarray(edge["p2"], dtype=float)
        length = float(edge["length"])
        if length < 0.10:
            continue
        direction = (p2 - p1) / length
        normal = np.array([-direction[1], direction[0]])
        middle = (p1 + p2) / 2
        inward = (
            normal
            if polygon.contains(original.Point(*(middle + normal * 0.25)))
            else -normal
        )

        def add_skin(a, b, z0, z1):
            if z1 - z0 <= 0.01:
                return
            skin = original._wall_strip(
                a,
                b,
                z0,
                z1,
                0.008,
                wall_color,
                inward,
                original.WALL_THICKNESS / 2 + 0.008,
            )
            if skin is None:
                return
            apply_archviz_material(
                skin,
                surface_material,
                tint=wall_color,
                tint_strength=tint_strength,
                repeat_m=3.2 if material_name == "bathroom_tile" else None,
                detail_maps=material_name not in {"plaster", "limewash"},
            )
            meshes.append(skin)

        last = 0.0
        for kind, start, end in sorted(
            edge.get("openings", []), key=lambda value: value[1]
        ):
            start = max(last, min(1.0, max(0.0, float(start))))
            end = max(start, min(1.0, max(0.0, float(end))))
            if (start - last) * length > 0.018:
                add_skin(
                    p1 + (p2 - p1) * last,
                    p1 + (p2 - p1) * start,
                    0.0,
                    original.WALL_H,
                )
            opening_a = p1 + (p2 - p1) * start
            opening_b = p1 + (p2 - p1) * end
            if kind in ("balcony", "balcony_hole"):
                add_skin(
                    opening_a,
                    opening_b,
                    BALCONY_OPENING_HEIGHT,
                    original.WALL_H,
                )
            elif kind in ("door", "door_hole"):
                add_skin(
                    opening_a,
                    opening_b,
                    original.DOOR_HEIGHT,
                    original.WALL_H,
                )
            else:
                add_skin(
                    opening_a,
                    opening_b,
                    0.0,
                    original.WINDOW_SILL,
                )
                add_skin(
                    opening_a,
                    opening_b,
                    original.WINDOW_SILL + original.WINDOW_HEIGHT,
                    original.WALL_H,
                )
            last = end
        if (1.0 - last) * length > 0.018:
            add_skin(
                p1 + (p2 - p1) * last,
                p2,
                0.0,
                original.WALL_H,
            )
    return meshes


def _professional_room_palette(style, config=None):
    """Apply a restrained 70/20/10 colour hierarchy by room function."""
    palette = dict(_ORIGINAL_GET_PALETTE(style, config))
    room_type = str((config or {}).get("room_type", "")).lower()
    if "bed" in room_type or "guest" in room_type or "kids" in room_type:
        # Bedrooms benefit from a warmer, quieter envelope and a deliberately
        # muted accent; furniture and textiles remain the stronger 20/10 notes.
        palette["wall"] = original._mix_color(
            palette["wall"], palette["wood"], 0.075
        )
        palette["accent"] = original._mix_color(
            palette["accent"], palette["wall"], 0.32
        )
    elif "bath" in room_type:
        palette["wall"] = original._mix_color(
            palette["wall"], original.WHITE_SOFT, 0.34
        )
        palette["accent"] = original._mix_color(
            palette["accent"], palette["wall"], 0.44
        )
    elif "kitchen" in room_type:
        palette["wall"] = original._mix_color(
            palette["wall"], original.WHITE_SOFT, 0.22
        )
        palette["accent"] = original._mix_color(
            palette["accent"], palette["cabinet"], 0.24
        )
    elif "living" in room_type or "dining" in room_type:
        palette["accent"] = original._mix_color(
            palette["accent"], palette["wall"], 0.24
        )
    return palette


def _professional_room_design_surfaces(room_m, edges, palette, config):
    """Choose one coherent focal-wall treatment from room and style."""
    tuned = dict(config or {})
    requested = str(tuned.get("wall_finish", "Auto by style")).lower()
    room_type = str(tuned.get("room_type", "")).lower()
    style = str(tuned.get("style", "Modern")).lower()
    if requested == "auto by style":
        if any(word in room_type for word in ("bed", "guest", "kids")):
            if any(word in style for word in ("classic", "traditional")):
                tuned["wall_finish"] = "panel moulding"
            elif any(word in style for word in ("japandi", "scandinavian", "boho")):
                tuned["wall_finish"] = "wood slats"
            else:
                tuned["wall_finish"] = "accent color"
        elif any(word in room_type for word in ("hall", "entry", "foyer")):
            tuned["wall_finish"] = "panel moulding"
    return _ORIGINAL_BUILD_ROOM_DESIGN_SURFACES(
        room_m,
        edges,
        palette,
        tuned,
    )


def _room_furnisher_init_with_balconies(self, *args, **kwargs):
    _ORIGINAL_ROOM_FURNISHER_INIT(self, *args, **kwargs)
    self.balcony_access_zones = []
    self.circulation_zones = []
    self.door_access_entries = []
    for edge in self.edges:
        p1 = np.asarray(edge["p1"], dtype=float)
        p2 = np.asarray(edge["p2"], dtype=float)
        for kind, start, end in edge.get("openings", []):
            if kind not in (
                "door",
                "door_hole",
                "balcony",
                "balcony_hole",
            ):
                continue
            center = p1 + (p2 - p1) * ((float(start) + float(end)) / 2)
            opening_a = p1 + (p2 - p1) * float(start)
            opening_b = p1 + (p2 - p1) * float(end)
            opening_width = float(np.linalg.norm(opening_b - opening_a))
            inward = self._inward_normal(p1, p2)
            is_balcony = kind in ("balcony", "balcony_hole")
            # Keep-clear corridors were so deep/wide (1.85 m x opening+0.72) that
            # a single doorway sterilised ~4-5 m2 and several openings together
            # fragmented a living room so badly that no dining zone could fit in
            # front of a balcony. Real circulation only needs ~1 m of approach.
            corridor_depth = 1.15 if is_balcony else 1.05
            corridor_width = opening_width + (0.34 if is_balcony else 0.34)
            corridor_center = center + inward * corridor_depth / 2
            corridor = original.footprint_poly(
                corridor_center,
                original.yaw_facing(inward),
                corridor_width,
                corridor_depth,
            ).intersection(self.poly)
            self.circulation_zones.append(corridor)
            if is_balcony:
                # A balcony is only stepped through occasionally, so it must not
                # sterilise the whole wall the way a real doorway does. Reserve
                # the deep corridor as a *soft* preference for living-room
                # scoring, but hard-block only a shallow threshold strip in
                # front of the opening so beds, wardrobes and dressers can still
                # sit along the balcony wall. Blocking the full 1.55 m corridor
                # left balcony bedrooms almost empty.
                self.balcony_access_zones.append(corridor)
                threshold_depth = 0.45
                threshold = original.footprint_poly(
                    center + inward * threshold_depth / 2,
                    original.yaw_facing(inward),
                    opening_width + 0.12,
                    threshold_depth,
                ).intersection(self.poly)
                self.door_zones.append(threshold)
            else:
                self.door_access_entries.append(
                    {
                        "center": center,
                        "inward": inward,
                        "width": opening_width,
                        "corridor": corridor,
                    }
                )
                self.door_zones.append(corridor)


def _build_bedside_commode(palette, w=0.42, d=0.38):
    """Grounded two-drawer bedside commode with a stable floor silhouette."""
    body = original._mix_color(
        palette["cabinet"],
        palette["wood"],
        0.34,
    )
    top = original._shade(palette["wood"], 1.04)
    front = float(d) / 2 + 0.014
    meshes = [
        original._bx(w, d, 0.34, body, z=0.10),
        original._bx(w + 0.035, d + 0.025, 0.04, top, z=0.44),
    ]
    for side_x in (-1, 1):
        for side_y in (-1, 1):
            meshes.append(
                original._bx(
                    0.055,
                    0.055,
                    0.10,
                    palette["wood_dark"],
                    cx=side_x * (w / 2 - 0.055),
                    cy=side_y * (d / 2 - 0.05),
                    z=0.0,
                )
            )
    for row, drawer_z in enumerate((0.135, 0.295)):
        meshes.extend((
            original._bx(
                w * 0.86,
                0.025,
                0.14,
                original._shade(body, 0.98 + row * 0.025),
                cy=front,
                z=drawer_z,
            ),
            original._bx(
                min(0.13, w * 0.32),
                0.032,
                0.022,
                palette["metal"],
                cy=front + 0.022,
                z=drawer_z + 0.06,
            ),
        ))
    apply_archviz_material(
        meshes[0],
        "warm_oak",
        tint=body,
        tint_strength=0.24,
        repeat_m=0.52,
    )
    return meshes, float(w), float(d)


def _build_drawer_dresser(palette, w=1.20, d=0.44):
    """A compact, clearly readable bedroom chest with six working drawer faces."""
    body = original._mix_color(
        palette["cabinet"],
        palette["wood"],
        0.28,
    )
    front = float(d) / 2 + 0.016
    meshes = [
        original._bx(w, d, 0.74, body, z=0.08),
        original._bx(
            w + 0.05,
            d + 0.03,
            0.045,
            original._shade(palette["wood"], 1.06),
            z=0.82,
        ),
        original._bx(w * 0.90, d * 0.76, 0.07, palette["wood_dark"], z=0.02),
    ]
    drawer_width = w / 2 - 0.055
    for row in range(3):
        drawer_z = 0.13 + row * 0.225
        for side in (-1, 1):
            drawer_x = side * (w / 4)
            meshes.extend(
                (
                    original._bx(
                        drawer_width,
                        0.028,
                        0.19,
                        original._shade(body, 0.97 + 0.02 * row),
                        cx=drawer_x,
                        cy=front,
                        z=drawer_z,
                    ),
                    original._bx(
                        min(0.16, drawer_width * 0.46),
                        0.035,
                        0.022,
                        palette["metal"],
                        cx=drawer_x,
                        cy=front + 0.026,
                        z=drawer_z + 0.085,
                    ),
                )
            )
    apply_archviz_material(
        meshes[0],
        "warm_oak",
        tint=body,
        tint_strength=0.20,
        repeat_m=0.82,
    )
    return meshes, w, d


def _build_wall_shelves(palette, w=1.00, d=0.18):
    """Shallow styled shelves that can sit above low furniture without crowding."""
    timber = original._mix_color(
        palette["wood"],
        palette["wood_dark"],
        0.22,
    )
    meshes = []
    for level in (1.02, 1.38, 1.74):
        meshes.append(original._bx(w, d, 0.045, timber, z=level))
    for side in (-1, 1):
        meshes.append(
            original._bx(
                0.035,
                d,
                0.78,
                palette["metal"],
                cx=side * (w / 2 - 0.06),
                z=1.00,
            )
        )
    book_colors = (
        palette["accent"],
        original._shade(palette["wall"], 0.72),
        palette["wood_dark"],
    )
    for index, color in enumerate(book_colors):
        meshes.append(
            original._bx(
                0.10,
                d * 0.72,
                0.22 + 0.035 * (index % 2),
                color,
                cx=-w * 0.30 + index * 0.12,
                z=1.07,
            )
        )
    apply_archviz_material(
        meshes[0],
        "warm_oak",
        tint=timber,
        tint_strength=0.22,
        repeat_m=0.62,
    )
    return meshes, w, d


def _build_full_length_mirror(palette, w=0.72, d=0.16):
    """A floor-standing full-length mirror for bedrooms without dresser space."""
    height = 1.76
    frame = original._mix_color(
        palette["wood_dark"],
        palette["metal"],
        0.28,
    )
    glass = original._mix_color([0.72, 0.82, 0.86], palette["wall"], 0.12)
    front = d / 2 + 0.012
    meshes = [
        original._bx(w, d, 0.08, frame, z=0.02),
        original._bx(w, d, 0.08, frame, z=height - 0.06),
        original._bx(0.07, d, height, frame, cx=-(w / 2 - 0.035), z=0.02),
        original._bx(0.07, d, height, frame, cx=w / 2 - 0.035, z=0.02),
        original._bx(w - 0.12, 0.025, height - 0.15, glass, cy=front, z=0.10),
        original._bx(w * 0.62, d + 0.22, 0.045, frame, cy=-0.05, z=0.0),
    ]
    return meshes, w, d + 0.22


def _build_bedroom_statement_mirror(
    palette,
    w=0.94,
    d=0.07,
    h=0.88,
    z=1.48,
    shape="rounded_rectangle",
):
    """A properly scaled dresser mirror, shaped to the selected style."""
    frame = original._mix_color(
        palette["wood_dark"],
        palette["metal"],
        0.38,
    )
    glass = original._mix_color(
        [0.70, 0.80, 0.85],
        palette["wall"],
        0.10,
    )
    if shape in ("round", "oval"):
        diameter = max(float(w), float(h))
        meshes, _width, _depth = original.build_round_mirror(
            palette,
            diameter=diameter,
            z=z,
            ornate=shape == "round",
        )
        if shape == "oval":
            x_scale = float(w) / diameter
            z_scale = float(h) / diameter
            for mesh in meshes:
                vertices = np.asarray(mesh.vertices)
                if not len(vertices):
                    continue
                vertices[:, 0] *= x_scale
                vertices[:, 2] = z + (vertices[:, 2] - z) * z_scale
                mesh.vertices = original.o3d.utility.Vector3dVector(vertices)
                mesh.compute_vertex_normals()
        return meshes, float(w), float(d)

    half_width = float(w) / 2
    half_height = float(h) / 2
    frame_width = 0.045 if shape == "slim_rectangle" else 0.055
    front = float(d) / 2 + 0.010
    meshes = [
        original._bx(w, d, frame_width, frame, z=z - half_height),
        original._bx(w, d, frame_width, frame, z=z + half_height - frame_width),
        original._bx(frame_width, d, h, frame, cx=-(half_width - frame_width / 2), z=z - half_height),
        original._bx(frame_width, d, h, frame, cx=half_width - frame_width / 2, z=z - half_height),
        original._bx(
            w - frame_width * 2,
            0.024,
            h - frame_width * 2,
            glass,
            cy=front,
            z=z - half_height + frame_width,
        ),
    ]
    return meshes, float(w), float(d)


def _build_wardrobe_mirror_panel(palette, w=0.58, d=0.035, h=1.58):
    """A slim framed mirror fixed to a wardrobe face, with no floor footprint."""
    frame = original._mix_color(
        palette["wood_dark"],
        palette["metal"],
        0.32,
    )
    glass = original._mix_color(
        [0.70, 0.80, 0.84],
        palette["wall"],
        0.10,
    )
    meshes = [
        original._bx(w, d, 0.045, frame, z=0.30),
        original._bx(w, d, 0.045, frame, z=0.30 + h - 0.045),
        original._bx(0.045, d, h, frame, cx=-(w / 2 - 0.022), z=0.30),
        original._bx(0.045, d, h, frame, cx=w / 2 - 0.022, z=0.30),
        original._bx(w - 0.08, d * 0.55, h - 0.09, glass, z=0.345),
    ]
    return meshes, w, d


def _build_dresser_shelves(palette, w=0.34, d=0.14):
    """A compact shelf stack designed to share a wall with a dresser mirror."""
    timber = original._mix_color(
        palette["wood"],
        palette["wood_dark"],
        0.20,
    )
    meshes = [
        original._bx(w, d, 0.04, timber, z=1.05),
        original._bx(w, d, 0.04, timber, z=1.38),
        original._bx(w, d, 0.04, timber, z=1.71),
        original._bx(0.03, d, 0.70, palette["metal"], cx=-(w / 2 - 0.025), z=1.03),
        original._bx(0.03, d, 0.70, palette["metal"], cx=w / 2 - 0.025, z=1.03),
    ]
    return meshes, w, d


def _editable_builder(self, asset_key, builder):
    """Register locally authored furniture with the walkthrough selection system."""

    def build_registered(palette, **kwargs):
        built = builder(palette, **kwargs)
        meshes, _width, _depth = built
        for mesh in meshes:
            self._editable_mesh_assets[id(mesh)] = (mesh, asset_key)
        return built

    return build_registered


def _furniture_with_suffix(self, suffix):
    return next(
        (
            item
            for item in reversed(self.editable_objects)
            if str(item.get("asset_key", "")).endswith(suffix)
        ),
        None,
    )


def _is_bedside_commode_item(item):
    key = str(item.get("asset_key", ""))
    return key.endswith("nightstand") or key.endswith("bedside_commode")


def _furniture_axes(item):
    yaw = float(item["yaw"])
    return (
        np.array([-math.sin(yaw), math.cos(yaw)], dtype=float),
        np.array([math.cos(yaw), math.sin(yaw)], dtype=float),
    )


def _room_span_metrics(self):
    rectangle = list(self.poly.minimum_rotated_rectangle.exterior.coords)
    spans = [
        float(
            np.linalg.norm(
                np.asarray(rectangle[index + 1], dtype=float)
                - np.asarray(rectangle[index], dtype=float)
            )
        )
        for index in range(min(4, len(rectangle) - 1))
    ]
    return (
        max(spans, default=0.0),
        min(spans, default=0.0),
    )


def _front_service_zone(position, yaw, width, depth, clearance, side=0.0):
    """Return the approach space in front of a wall-facing furniture item."""
    facing = np.array([-math.sin(float(yaw)), math.cos(float(yaw))], dtype=float)
    center = (
        np.asarray(position, dtype=float)
        + facing * (float(depth) / 2 + float(clearance) / 2)
    )
    return original.footprint_poly(
        center,
        float(yaw),
        float(width) + float(side) * 2,
        float(clearance),
    )


def _service_zone_is_clear(
    self,
    zone,
    *,
    avoid_doors=True,
    allowed_overlap=0.018,
):
    safe_room = self.poly.buffer(-0.035)
    if safe_room.is_empty or not zone.within(safe_room):
        return False
    if any(
        zone.intersection(placed).area > allowed_overlap
        for placed in self.placed
    ):
        return False
    if avoid_doors and any(
        zone.intersection(door_zone).area > 0.025
        for door_zone in self.door_zones
    ):
        return False
    return True


def _set_furniture_pose(item, position, yaw=None):
    """Move an editable furniture group without disturbing its stable pivot."""
    if yaw is not None:
        delta_yaw = math.atan2(
            math.sin(float(yaw) - float(item["yaw"])),
            math.cos(float(yaw) - float(item["yaw"])),
        )
        if abs(delta_yaw) > 1e-6:
            original.rotate_furniture_object(item, delta_yaw)
    position = np.asarray(position, dtype=float)
    delta = position - np.asarray(item["position"], dtype=float)
    if float(np.linalg.norm(delta)) > 1e-7:
        for mesh in item.get("meshes", ()):
            mesh.translate((float(delta[0]), float(delta[1]), 0.0))
        item["position"] = position


def _shifted_against_wall(
    self,
    builder,
    *,
    min_side=0.0,
    prefer=None,
    block=True,
    avoid_doors=True,
    front_clearance=0.0,
    side_clearance=0.0,
    **kwargs,
):
    """Try centered and shifted wall poses instead of abandoning a usable wall."""
    slots = list(self.wall_slots())
    if prefer:
        slots.sort(key=prefer)
    for slot in slots:
        probe = builder(self.P, **kwargs)
        _meshes, width, depth = probe
        if float(slot["len"]) < max(float(width) + 0.10, float(min_side)):
            continue
        travel = max(
            0.0,
            (float(slot["len"]) - float(width) - 0.12) / 2,
        )
        offsets = [0.0]
        if travel >= 0.10:
            near = min(travel, max(0.24, travel * 0.48))
            offsets.extend((-near, near))
        if travel >= 0.38:
            far = min(travel, max(0.40, travel * 0.86))
            offsets.extend((-far, far))
        for offset in offsets:
            built = builder(self.P, **kwargs)
            candidate_slot = dict(slot)
            candidate_slot["mid"] = (
                np.asarray(slot["mid"], dtype=float)
                + np.asarray(slot["dir"], dtype=float) * offset
            )
            position = (
                np.asarray(candidate_slot["mid"], dtype=float)
                + np.asarray(candidate_slot["n"], dtype=float)
                * (original.WALL_GAP + float(depth) / 2)
            )
            yaw = original.yaw_facing(candidate_slot["n"])
            if front_clearance > 0:
                service_zone = _front_service_zone(
                    position,
                    yaw,
                    width,
                    depth,
                    front_clearance,
                    side=side_clearance,
                )
                if not _service_zone_is_clear(
                    self,
                    service_zone,
                    avoid_doors=avoid_doors,
                ):
                    continue
            if self.add(
                built,
                position,
                yaw,
                block=block,
                avoid_doors=avoid_doors,
            ):
                return {
                    "slot": candidate_slot,
                    "pos": position,
                    "yaw": yaw,
                    "n": candidate_slot["n"],
                    "s": candidate_slot["dir"],
                    "w": float(width),
                    "d": float(depth),
                }
    return None


def _place_mirror_over(
    self,
    furniture,
    diameter=0.74,
    lateral_offset=0.0,
):
    if not furniture or self._window_behind(furniture, diameter):
        return False
    position = (
        np.asarray(furniture["pos"], dtype=float)
        - furniture["n"] * (furniture["d"] / 2 + 0.012)
        + furniture["s"] * float(lateral_offset)
    )
    return self.add(
        _editable_builder(
            self,
            "dresser_mirror",
            original.build_round_mirror,
        )(
            self.P,
            diameter=diameter,
            z=1.38,
            ornate=self.design_choices["style_key"] == "classic",
        ),
        position,
        furniture["yaw"],
        block=False,
        avoid_doors=False,
        check=False,
    )


def _place_bedroom_statement_mirror(self, dresser):
    if not dresser:
        return False
    style = str(self.design_choices.get("style_key", "modern")).lower()
    if any(word in style for word in ("classic", "traditional")):
        shape = "round"
        width = height = max(0.86, min(1.02, float(dresser["w"]) * 0.92))
    elif any(word in style for word in ("japandi", "scandinavian", "boho")):
        shape = "oval"
        width = max(0.76, min(0.96, float(dresser["w"]) * 0.88))
        height = max(0.94, min(1.12, width * 1.22))
    else:
        shape = "slim_rectangle"
        width = max(0.80, min(1.10, float(dresser["w"]) * 0.96))
        height = max(0.82, min(0.98, width * 0.88))
    if self._window_behind(dresser, width):
        return False
    # Dresser top is 0.865 m. A 16–20 cm clear gap keeps the mirror visually
    # connected to the commode without letting it sink into the furniture.
    center_z = 0.865 + 0.18 + height / 2
    position = (
        np.asarray(dresser["pos"], dtype=float)
        - dresser["n"] * (dresser["d"] / 2 + 0.012)
    )
    return self.add(
        _editable_builder(
            self,
            "dresser_statement_mirror",
            _build_bedroom_statement_mirror,
        )(
            self.P,
            w=width,
            h=height,
            z=center_z,
            shape=shape,
        ),
        position,
        dresser["yaw"],
        block=False,
        avoid_doors=False,
        check=False,
    )


def _place_shelves_over_dresser(self, dresser):
    if not dresser:
        return False
    shelf_width = max(0.24, min(0.36, dresser["w"] * 0.30))
    lateral_offset = dresser["w"] * 0.31
    position = (
        np.asarray(dresser["pos"], dtype=float)
        - dresser["n"] * (dresser["d"] / 2 + 0.010)
        + dresser["s"] * lateral_offset
    )
    return self.add(
        _editable_builder(
            self,
            "dresser_shelves",
            _build_dresser_shelves,
        )(
            self.P,
            w=shelf_width,
            d=0.13,
        ),
        position,
        dresser["yaw"],
        block=False,
        avoid_doors=False,
        check=False,
    )


def _place_wardrobe_mirror(self, wardrobe):
    if not wardrobe:
        return False
    facing, lateral = _furniture_axes(wardrobe)
    mirror_width = max(
        0.42,
        min(0.62, float(wardrobe["width"]) * 0.42),
    )
    position = (
        np.asarray(wardrobe["position"], dtype=float)
        + facing * (float(wardrobe["depth"]) / 2 + 0.022)
        - lateral * min(0.18, float(wardrobe["width"]) * 0.18)
    )
    return self.add(
        _editable_builder(
            self,
            "wardrobe_mirror",
            _build_wardrobe_mirror_panel,
        )(
            self.P,
            w=mirror_width,
            d=0.035,
        ),
        position,
        float(wardrobe["yaw"]),
        block=False,
        avoid_doors=False,
        check=False,
    )


_ORIGINAL_FURNISH_BEDROOM = original.RoomFurnisher.furnish_bedroom
_ORIGINAL_FURNISH_DINING = original.RoomFurnisher.furnish_dining
_ORIGINAL_FURNISH_OFFICE = original.RoomFurnisher.furnish_office
_ORIGINAL_FURNISH_LIVING = original.RoomFurnisher.furnish_living
_ORIGINAL_FURNISH = original.RoomFurnisher.furnish
_ORIGINAL_PROFESSIONAL_DETAIL = original._professional_detail


def _professional_detail_with_supported_pillows(
    asset_key,
    palette,
    width,
    depth,
    height,
    z=0.0,
):
    """Use supported upright sofa cushions instead of a loose imported cluster."""
    if asset_key != "throw_pillows":
        return _ORIGINAL_PROFESSIONAL_DETAIL(
            asset_key,
            palette,
            width,
            depth,
            height,
            z=z,
        )

    pillow_count = 2 if float(width) >= 0.70 else 1
    gap = 0.055
    pillow_width = min(
        0.44,
        (
            float(width)
            - gap * (pillow_count - 1)
        )
        / pillow_count,
    )
    pillow_depth = min(0.14, max(0.11, float(depth) * 0.32))
    pillow_height = min(0.34, max(0.27, float(height)))
    total_width = pillow_width * pillow_count + gap * (pillow_count - 1)
    colors = (
        original._mix_color(
            palette["accent"],
            palette["cushion"],
            0.42,
        ),
        original._mix_color(
            palette["cushion"],
            palette["wall"],
            0.18,
        ),
    )
    pillows = []
    lean = math.radians(8.0)
    rotation = np.array(
        [
            [1.0, 0.0, 0.0],
            [0.0, math.cos(lean), -math.sin(lean)],
            [0.0, math.sin(lean), math.cos(lean)],
        ],
        dtype=float,
    )
    for index in range(pillow_count):
        x = (
            -total_width / 2
            + pillow_width / 2
            + index * (pillow_width + gap)
        )
        color = colors[index % len(colors)]
        pillow = original._rounded_cuboid(
            pillow_width,
            pillow_depth,
            pillow_height,
            color,
            cx=x,
            cy=0.0,
            z=float(z),
            roundness=0.48,
            resolution=24,
        )
        pillow.rotate(
            rotation,
            center=(
                x,
                0.0,
                float(z) + pillow_height / 2,
            ),
        )
        apply_archviz_material(
            pillow,
            "curtain_fabric",
            tint=color,
            tint_strength=0.66,
            repeat_m=0.38,
        )
        pillows.append(pillow)
    return pillows


def _place_bed_ensemble(self, bed_builder, nightstand_builder):
    """Place the headboard, bed and bedside storage as one aligned composition."""
    area = float(self.poly.area)
    _major, minor = _room_span_metrics(self)
    if area >= 17.0 and minor >= 3.45:
        bed_sizes = ((1.80, 2.12), (1.60, 2.05), (1.40, 1.95))
    elif area >= 12.0 and minor >= 3.0:
        bed_sizes = ((1.60, 2.05), (1.40, 1.95), (1.20, 1.90))
    elif area >= 8.5:
        bed_sizes = ((1.40, 1.95), (1.20, 1.90), (1.00, 1.90))
    else:
        bed_sizes = ((1.20, 1.90), (1.00, 1.88))

    anchor_slots = list(self.bedroom_anchor_slots())
    if not anchor_slots:
        anchor_slots = list(self.wall_slots())

    for bed_width, bed_depth in bed_sizes:
        stand_width = 0.44 if bed_width >= 1.6 else 0.38 if bed_width >= 1.3 else 0.34
        stand_depth = 0.38 if bed_width >= 1.6 else 0.34
        gap = 0.08
        # First secure the bed alone. Wardrobe and dresser storage are planned
        # next; bedside commodes are added only afterward if both side clearances
        # still work. This prevents optional tables from displacing a wardrobe.
        for stand_count in (0,):
            group_width = (
                bed_width
                + stand_count * stand_width
                + stand_count * gap
            )
            for slot in anchor_slots:
                if float(slot["len"]) < group_width + 0.10:
                    continue
                travel = max(
                    0.0,
                    (float(slot["len"]) - group_width - 0.10) / 2,
                )
                offsets = [0.0]
                if travel >= 0.18:
                    offsets.extend((-min(0.42, travel), min(0.42, travel)))
                for offset in offsets:
                    n = np.asarray(slot["n"], dtype=float)
                    s = np.asarray(slot["dir"], dtype=float)
                    center = (
                        np.asarray(slot["mid"], dtype=float)
                        + s * offset
                        + n * (original.WALL_GAP + bed_depth / 2)
                    )
                    yaw = original.yaw_facing(n)
                    bed_fp = original.footprint_poly(
                        center,
                        yaw,
                        bed_width,
                        bed_depth,
                    )
                    foot_zone = _front_service_zone(
                        center,
                        yaw,
                        bed_width,
                        bed_depth,
                        DESIGN_CLEARANCES["bed_foot"],
                        side=0.06,
                    )
                    if (
                        not self._ok(bed_fp)
                        or not _service_zone_is_clear(
                            self,
                            foot_zone,
                            avoid_doors=True,
                        )
                    ):
                        continue

                    stand_candidates = []
                    if stand_count:
                        sides = (-1, 1) if stand_count == 2 else (-1, 1)
                        for side in sides:
                            stand_position = (
                                center
                                + s
                                * side
                                * (
                                    bed_width / 2
                                    + gap
                                    + stand_width / 2
                                )
                                - n
                                * max(
                                    0.0,
                                    (bed_depth - stand_depth) / 2,
                                )
                            )
                            stand_fp = original.footprint_poly(
                                stand_position,
                                yaw,
                                stand_width,
                                stand_depth,
                            )
                            if self._ok(stand_fp) and not stand_fp.intersects(bed_fp):
                                stand_candidates.append((side, stand_position))
                        if len(stand_candidates) < stand_count:
                            continue
                        if stand_count == 1:
                            # Put the single table on the side farther from the
                            # nearest entrance so the bed remains approachable.
                            entries = [
                                np.asarray(entry["center"], dtype=float)
                                for entry in self.door_access_entries
                            ]
                            stand_candidates.sort(
                                key=lambda item: min(
                                    (
                                        float(
                                            np.linalg.norm(
                                                item[1] - entry
                                            )
                                        )
                                        for entry in entries
                                    ),
                                    default=2.0,
                                ),
                                reverse=True,
                            )
                        stand_candidates = stand_candidates[:stand_count]

                    if not self.add(
                        bed_builder(
                            self.P,
                            w=bed_width,
                            d=bed_depth,
                        ),
                        center,
                        yaw,
                    ):
                        continue
                    for _side, stand_position in stand_candidates:
                        self.add(
                            nightstand_builder(
                                self.P,
                                w=stand_width,
                                d=stand_depth,
                            ),
                            stand_position,
                            yaw,
                        )
                    return {
                        "slot": slot,
                        "pos": center,
                        "yaw": yaw,
                        "n": n,
                        "s": s,
                        "w": bed_width,
                        "d": bed_depth,
                        "stands": len(stand_candidates),
                    }
    return None


def _furnish_complete_bedroom(self):
    """Furnish every bedroom with a bed, wardrobe, commode and paired mirror."""
    area = float(self.poly.area)
    _major, minor = _room_span_metrics(self)
    bed_builder = self.furniture_builder("bed", original.build_bed)
    nightstand_builder = _editable_builder(
        self,
        "bedside_commode",
        _build_bedside_commode,
    )
    wardrobe_builder = self.furniture_builder(
        "wardrobe",
        original.build_wardrobe,
    )
    bed = _place_bed_ensemble(self, bed_builder, nightstand_builder)
    bed_facing = np.asarray(bed["n"], dtype=float) if bed else None

    if bed:
        rug_position = (
            np.asarray(bed["pos"], dtype=float)
            + bed["n"] * (bed["d"] / 2 - 0.34)
        )
        self.place_rug(
            rug_position,
            bed["yaw"],
            min(bed["w"] + 1.05, max(1.70, minor - 0.32)),
            1.55,
        )
        if self.airy:
            self.art_on(bed, w=min(1.20, bed["w"] * 0.78))
        else:
            self.feature_on(bed, w=min(2.10, bed["w"] + 0.28))

    def wardrobe_preference(slot):
        alignment = (
            float(np.dot(slot["n"], bed_facing))
            if bed_facing is not None
            else 0.0
        )
        same_wall = bool(
            bed
            and slot["edge"] is bed["slot"]["edge"]
        )
        return (
            2 if same_wall else 0 if alignment < -0.55 else 1,
            -float(slot["len"]),
        )

    wardrobe_sizes = (
        ((1.60, 0.60), (1.30, 0.58), (1.00, 0.54))
        if area >= 16.0 and minor >= 3.25
        else ((1.30, 0.58), (1.00, 0.54), (0.82, 0.50))
    )
    wardrobe_info = None
    for width, depth in wardrobe_sizes:
        wardrobe_info = _shifted_against_wall(
            self,
            wardrobe_builder,
            min_side=width + 0.08,
            prefer=wardrobe_preference,
            front_clearance=DESIGN_CLEARANCES["wardrobe_front"],
            side_clearance=0.04,
            w=width,
            d=depth,
        )
        if wardrobe_info:
            break

    # Bedside tables are useful, but they must never displace essential
    # clothes storage.  Recover their exact occupied footprints before retrying
    # a standards-sized wardrobe.
    if wardrobe_info is None:
        nightstands = [
            item
            for item in list(self.editable_objects)
            if _is_bedside_commode_item(item)
        ]
        for nightstand in nightstands:
            _remove_furniture_object(self, nightstand)
            for width, depth in (
                (1.30, 0.58),
                (1.00, 0.54),
            ):
                wardrobe_info = _shifted_against_wall(
                    self,
                    wardrobe_builder,
                    min_side=width + 0.08,
                    prefer=wardrobe_preference,
                    front_clearance=0.68,
                    side_clearance=0.03,
                    w=width,
                    d=depth,
                )
                if wardrobe_info:
                    break
            if wardrobe_info:
                break
    if wardrobe_info is None:
        for width, depth in ((1.00, 0.52), (0.82, 0.50)):
            wardrobe_info = _shifted_against_wall(
                self,
                wardrobe_builder,
                min_side=width + 0.08,
                prefer=wardrobe_preference,
                front_clearance=0.58,
                side_clearance=0.02,
                w=width,
                d=depth,
            )
            if wardrobe_info:
                break
    if wardrobe_info is None:
        # Wardrobes are essential bedroom storage. Step down once more to a
        # slim, full-height unit before any dresser or bedside commode is
        # allowed to claim the remaining wall space.
        for item in list(self.editable_objects):
            if _is_bedside_commode_item(item):
                _remove_furniture_object(self, item)
        for width, depth in ((0.76, 0.48), (0.68, 0.46)):
            wardrobe_info = _shifted_against_wall(
                self,
                wardrobe_builder,
                min_side=width + 0.06,
                prefer=wardrobe_preference,
                front_clearance=0.48,
                side_clearance=0.01,
                w=width,
                d=depth,
            )
            if wardrobe_info:
                break

    dresser_builder = _editable_builder(
        self,
        "drawer_dresser",
        _build_drawer_dresser,
    )

    def dresser_preference(slot):
        alignment = (
            float(np.dot(slot["n"], bed_facing))
            if bed_facing is not None
            else 0.0
        )
        wardrobe_wall = bool(
            wardrobe_info
            and slot["edge"] is wardrobe_info["slot"]["edge"]
        )
        bed_wall = bool(bed and slot["edge"] is bed["slot"]["edge"])
        return (
            3 if wardrobe_wall else 2 if bed_wall else 0 if alignment < -0.55 else 1,
            -float(slot["len"]),
        )

    standard_dresser_sizes = (
        ((1.06, 0.42), (0.82, 0.38))
        if area >= 14.0 and minor >= 3.0
        else ((0.82, 0.38), (0.68, 0.34))
    )

    def place_required_dresser(front_clearance, sizes=standard_dresser_sizes):
        for width, depth in sizes:
            result = _shifted_against_wall(
                self,
                dresser_builder,
                min_side=width + 0.08,
                prefer=dresser_preference,
                front_clearance=front_clearance,
                side_clearance=0.02,
                w=width,
                d=depth,
            )
            if result:
                return result
        return None

    dresser = place_required_dresser(
        DESIGN_CLEARANCES["dresser_front"]
    )
    if dresser is None:
        dresser = place_required_dresser(0.60)
    if dresser is None:
        # Remove any remaining optional nightstand one at a time and retry.
        for nightstand in [
            item
            for item in list(self.editable_objects)
            if _is_bedside_commode_item(item)
        ]:
            _remove_furniture_object(self, nightstand)
            dresser = place_required_dresser(0.58)
            if dresser:
                break
    if dresser is None:
        dresser = place_required_dresser(
            0.54,
            ((0.68, 0.34), (0.60, 0.32)),
        )

    # The mirror is a single composition with the commode, centred above it.
    # It is not substituted with an unrelated wardrobe mirror.
    if dresser:
        _place_bedroom_statement_mirror(self, dresser)

    # Re-evaluate compact bedside commodes after the wardrobe and dresser have
    # claimed their walls. This preserves essential storage first, then fills
    # whichever bed sides still have genuinely usable clearance.
    if bed:
        existing_stands = [
            item
            for item in self.editable_objects
            if _is_bedside_commode_item(item)
        ]
        occupied_sides = {
            1 if float(np.dot(
                np.asarray(item["position"], dtype=float)
                - np.asarray(bed["pos"], dtype=float),
                np.asarray(bed["s"], dtype=float),
            )) >= 0 else -1
            for item in existing_stands
        }
        entries = [
            np.asarray(entry["center"], dtype=float)
            for entry in self.door_access_entries
        ]
        stand_width, stand_depth = 0.42, 0.38
        candidates = []
        for side in (-1, 1):
            if side in occupied_sides:
                continue
            position = (
                np.asarray(bed["pos"], dtype=float)
                + np.asarray(bed["s"], dtype=float)
                * side
                * (float(bed["w"]) / 2 + 0.08 + stand_width / 2)
                - np.asarray(bed["n"], dtype=float)
                * max(0.0, (float(bed["d"]) - stand_depth) / 2)
            )
            entry_clearance = min(
                (
                    float(np.linalg.norm(position - entry))
                    for entry in entries
                ),
                default=3.0,
            )
            candidates.append((entry_clearance, side, position))
        for _clearance, _side, position in sorted(candidates, reverse=True):
            if self.add(
                nightstand_builder(
                    self.P,
                    w=stand_width,
                    d=stand_depth,
                ),
                position,
                float(bed["yaw"]),
            ):
                existing_stands.append(self.editable_objects[-1])
            if len(existing_stands) >= 2:
                break

    # A reading chair belongs only in a genuinely generous bedroom; forcing it
    # into ordinary rooms was one of the largest sources of visual clutter.
    if area >= 22.0 and minor >= 3.8 and not self.airy:
        _shifted_against_wall(
            self,
            self.furniture_builder("armchair", original.build_armchair),
            min_side=1.02,
            front_clearance=0.56,
            w=0.86,
            d=0.82,
        )
    if self.wants_plants and area >= 14.0:
        self.in_corner(original.build_plant, tall=False)
    self.pendant()


def _furnish_complete_dining(self):
    _ORIGINAL_FURNISH_DINING(self)
    # Recover the table the way the open-plan living room does.
    #
    # The recipe above asks for one zone, at one size, on the centroid, and
    # accepts whatever comes back — so a room whose doorway corridor crosses
    # its middle came out with a sideboard, a plant, and nowhere to eat. The
    # allowance ladder inside `place_dining_zone` covers most of that now; this
    # is the last resort for the rest, and a dedicated dining room is the one
    # place where standing the set down unconditionally is the right answer.
    if not _furniture_with_suffix(self, "dining_table"):
        if not self.place_dining_zone(position=self.centroid, compact=True):
            self.place_dining_zone(
                position=self.centroid,
                compact=True,
                guarantee=True,
            )
    has_storage = any(
        "sideboard" in str(item.get("asset_key", ""))
        for item in self.editable_objects
    )
    if not has_storage:
        sideboard = self.against_wall(
            self.furniture_builder("sideboard", original.build_sideboard),
            min_side=0.96,
            w=0.90,
            d=0.38,
        )
        if sideboard:
            self.art_on(sideboard, w=min(0.78, sideboard["w"] * 0.82))


def _furnish_complete_office(self):
    """Build a usable workstation with a real chair and storage approach zone."""
    area = float(self.poly.area)
    _major, minor = _room_span_metrics(self)
    desk_builder = self.furniture_builder("desk", original.build_desk)
    chair_builder = self.furniture_builder(
        "office_chair",
        original.build_office_chair,
    )
    shelf_builder = self.furniture_builder(
        "bookshelf",
        original.build_bookshelf,
    )
    desk_sizes = (
        ((1.50, 0.70), (1.25, 0.64), (1.00, 0.56))
        if area >= 10.0 and minor >= 2.65
        else ((1.25, 0.64), (1.00, 0.56), (0.88, 0.52))
    )
    desk = None
    for width, depth in desk_sizes:
        desk = _shifted_against_wall(
            self,
            desk_builder,
            min_side=width + 0.10,
            front_clearance=DESIGN_CLEARANCES["desk_chair_zone"],
            side_clearance=0.10,
            w=width,
            d=depth,
        )
        if desk:
            break

    if desk:
        chair_width = 0.56
        chair_depth = 0.58
        chair_position = (
            np.asarray(desk["pos"], dtype=float)
            + np.asarray(desk["n"], dtype=float)
            * (
                float(desk["d"]) / 2
                + chair_depth / 2
                + 0.12
            )
        )
        self.add(
            chair_builder(
                self.P,
                w=chair_width,
                d=chair_depth,
            ),
            chair_position,
            original.yaw_facing(-np.asarray(desk["n"], dtype=float)),
        )
        self.art_on(desk, w=min(0.94, float(desk["w"]) * 0.72))
        lamp = original._professional_detail(
            "desk_lamp",
            self.P,
            0.30,
            0.30,
            0.42,
            z=0.76,
        )
        if lamp:
            lamp_position = (
                np.asarray(desk["pos"], dtype=float)
                + np.asarray(desk["s"], dtype=float)
                * (float(desk["w"]) / 2 - 0.23)
                - np.asarray(desk["n"], dtype=float) * 0.10
            )
            self.add(
                (lamp, 0.30, 0.30),
                lamp_position,
                float(desk["yaw"]),
                block=False,
                avoid_doors=False,
                check=False,
            )

    def shelf_preference(slot):
        return (
            1 if desk and slot["edge"] is desk["slot"]["edge"] else 0,
            -float(slot["len"]),
        )

    shelf = None
    for width, depth in (
        (1.40, 0.32),
        (1.05, 0.30),
        (0.82, 0.26),
    ):
        shelf = _shifted_against_wall(
            self,
            shelf_builder,
            min_side=width + 0.08,
            prefer=shelf_preference,
            front_clearance=0.66,
            w=width,
            d=depth,
        )
        if shelf:
            break
    if not shelf:
        _shifted_against_wall(
            self,
            _editable_builder(
                self,
                "wall_shelves",
                _build_wall_shelves,
            ),
            min_side=0.76,
            block=False,
            w=0.72,
            d=0.15,
        )
    if self.wants_plants and area >= 9.0:
        self.in_corner(original.build_plant, tall=False)
    self.pendant()


def _remove_furniture_object(self, item):
    """Remove one rejected editable object from the completed room scene."""
    target = original.footprint_poly(
        np.asarray(item["position"], dtype=float),
        float(item["yaw"]),
        float(item["width"]),
        float(item["depth"]),
    ).buffer(0.04)
    matches = []
    for index, footprint in enumerate(self.placed):
        centroid_distance = float(
            target.centroid.distance(footprint.centroid)
        )
        area_delta = abs(float(target.area) - float(footprint.area))
        if centroid_distance <= 0.08:
            matches.append((area_delta, centroid_distance, index))
    if matches:
        _area_delta, _centroid_distance, index = min(matches)
        self.placed.pop(index)
    mesh_ids = {id(mesh) for mesh in item.get("meshes", ())}
    self.meshes = [mesh for mesh in self.meshes if id(mesh) not in mesh_ids]
    if item in self.editable_objects:
        self.editable_objects.remove(item)


def _place_floating_media_safely(self, sofa, tv_builder):
    """Place a compact freestanding TV only when the complete zone is clear.

    A media unit is optional in an open plan; circulation and dining clearance
    are not.  In particular, never use the legacy forced placement or its
    full-height slat wall when the sofa faces an occupied dining zone.
    """
    facing = np.asarray(sofa["n"], dtype=float)
    sofa_position = np.asarray(sofa["pos"], dtype=float)
    tv_yaw = original.yaw_facing(-facing)
    dining_zones = [
        zone.buffer(0.24)
        for zone in getattr(self, "_livinai_dining_footprints", ())
    ]
    circulation_zones = [
        zone.buffer(0.08)
        for zone in getattr(self, "circulation_zones", ())
    ]
    balcony_zones = [
        zone.buffer(0.08)
        for zone in getattr(self, "balcony_access_zones", ())
    ]
    safe_room = self.poly.buffer(-0.10)
    if safe_room.is_empty:
        return False

    for width in (1.35, 1.18):
        built = tv_builder(self.P, w=width)
        _meshes, actual_width, actual_depth = built
        for distance in (2.45, 2.75, 3.05, 3.35):
            if (
                distance
                - float(sofa["d"]) / 2
                - float(actual_depth) / 2
                < 1.45
            ):
                continue
            position = sofa_position + facing * distance
            footprint = original.footprint_poly(
                position,
                tv_yaw,
                actual_width,
                actual_depth,
            )
            clearance = footprint.buffer(0.24)
            if (
                not footprint.within(safe_room)
                or any(clearance.intersects(zone) for zone in dining_zones)
                or any(
                    clearance.intersection(zone).area > 0.025
                    for zone in circulation_zones
                )
                or any(clearance.intersects(zone) for zone in balcony_zones)
                or not self._ok(footprint)
            ):
                continue
            if self.add(built, position, tv_yaw):
                return True
    return False


def _place_opposite_wall_media(self, sofa, tv_builder):
    """Mount a TV console on the solid wall directly facing the sofa."""
    facing = np.asarray(sofa["n"], dtype=float)
    sofa_position = np.asarray(sofa["pos"], dtype=float)
    lateral = np.asarray(sofa["s"], dtype=float)
    candidates = []
    for slot in self.wall_slots():
        direction = np.asarray(slot["n"], dtype=float)
        delta = np.asarray(slot["mid"], dtype=float) - sofa_position
        forward_distance = float(np.dot(delta, facing))
        if (
            float(slot["len"]) < 1.22
            or float(np.dot(direction, facing)) > -0.72
            or forward_distance < 2.35
            or forward_distance > 5.60
        ):
            continue
        lateral_offset = abs(float(np.dot(delta, lateral)))
        candidates.append(
            (
                lateral_offset,
                abs(forward_distance - 3.45),
                slot,
            )
        )
    slots = [
        item[2]
        for item in sorted(candidates, key=lambda item: (item[0], item[1]))
    ]
    for width in (1.70, 1.50, 1.35):
        if self.against_wall(
            tv_builder,
            slots=slots,
            min_side=width + 0.08,
            w=width,
        ):
            return True
    return False


def _place_required_living_group(self):
    """Recover a correctly zoned sofa group when dining claimed every anchor."""
    dining_zones = list(
        getattr(self, "_livinai_dining_footprints", ())
    )
    original_placed = list(self.placed)
    self.placed = [
        footprint
        for footprint in self.placed
        if not any(footprint is zone for zone in dining_zones)
    ]
    sofa_builder = self.furniture_builder("sofa", original.build_sofa)
    sofa = None
    try:
        base_slots = list(self.wall_slots(include_windows=True))
        dining_centers = [
            np.array([zone.centroid.x, zone.centroid.y], dtype=float)
            for zone in dining_zones
        ]
        if dining_centers:
            base_slots.sort(
                key=lambda slot: (
                    0
                    if any(
                        (
                            float(other["len"]) >= 1.22
                            and float(
                                np.dot(
                                    np.asarray(other["n"], dtype=float),
                                    np.asarray(slot["n"], dtype=float),
                                )
                            )
                            < -0.72
                            and 2.35
                            <= float(
                                np.dot(
                                    np.asarray(other["mid"], dtype=float)
                                    - np.asarray(slot["mid"], dtype=float),
                                    np.asarray(slot["n"], dtype=float),
                                )
                            )
                            <= 5.60
                        )
                        for other in self.wall_slots()
                    )
                    else 1,
                    -min(
                        float(
                            np.linalg.norm(
                                np.asarray(slot["mid"], dtype=float) - center
                            )
                        )
                        for center in dining_centers
                    ),
                ),
            )
        for width, depth in (
            (2.60, 0.98),
            (2.35, 0.95),
            (2.15, 0.92),
            (1.80, 0.88),
        ):
            clear_poses = []
            for slot in base_slots:
                if float(slot["len"]) < width + 0.12:
                    continue
                travel = max(
                    0.0,
                    (float(slot["len"]) - width - 0.12) / 2,
                )
                offsets = [0.0]
                for fraction in (0.38, 0.68, 0.94):
                    shift = min(travel, max(0.28, travel * fraction))
                    if shift >= 0.08:
                        offsets.extend((-shift, shift))
                for offset in offsets:
                    candidate_slot = dict(slot)
                    candidate_slot["mid"] = (
                        np.asarray(slot["mid"], dtype=float)
                        + np.asarray(slot["dir"], dtype=float) * offset
                    )
                    position, yaw = self._centered_wall_pose(
                        candidate_slot,
                        width,
                        depth,
                    )
                    footprint = original.footprint_poly(
                        position,
                        yaw,
                        width,
                        depth,
                    )
                    if (
                        any(
                            footprint.buffer(0.18).intersects(zone)
                            for zone in dining_zones
                        )
                        or not self._ok(footprint)
                    ):
                        continue
                    clear_poses.append(
                        (candidate_slot, position, yaw)
                    )
                    break
            if not clear_poses:
                continue
            for slot, position, yaw in clear_poses:
                built = sofa_builder(
                    self.P,
                    w=width,
                    d=depth,
                )
                _meshes, actual_width, actual_depth = built
                if not self.add(built, position, yaw):
                    continue
                sofa = {
                    "slot": slot,
                    "pos": position,
                    "yaw": yaw,
                    "n": np.asarray(slot["n"], dtype=float),
                    "s": np.asarray(slot["dir"], dtype=float),
                    "w": float(actual_width),
                    "d": float(actual_depth),
                }
                break
            if sofa:
                break
    finally:
        recovered = [
            footprint
            for footprint in self.placed
            if all(footprint is not old for old in original_placed)
        ]
        self.placed = original_placed + recovered

    if not sofa:
        return None

    sofa_position = np.asarray(sofa["pos"], dtype=float)
    facing = np.asarray(sofa["n"], dtype=float)
    self.place_rug(
        sofa_position + facing * 0.95,
        sofa["yaw"],
        min(3.30, sofa["w"] + 0.75),
        2.35,
    )
    table_builder = self.furniture_builder(
        "coffee_table",
        original.build_coffee_table,
    )
    table_position = sofa_position + facing * 1.12
    self.add(
        table_builder(self.P, w=1.10, d=0.60),
        table_position,
        sofa["yaw"],
    )
    tv_builder = self.furniture_builder("tv_unit", original.build_tv_unit)
    if not _place_opposite_wall_media(self, sofa, tv_builder):
        _place_floating_media_safely(self, sofa, tv_builder)
    return sofa


def _place_required_coffee_table(self, sofa):
    """Complete the sofa group without letting a broad dining reserve hide it."""
    sofa_position = np.asarray(sofa["position"], dtype=float)
    sofa_facing, _sofa_lateral = _furniture_axes(sofa)
    builder = self.furniture_builder(
        "coffee_table",
        original.build_coffee_table,
    )
    dining_items = [
        item
        for item in self.editable_objects
        if (
            "dining_table" in str(item.get("asset_key", ""))
            or "dining_chair" in str(item.get("asset_key", ""))
        )
    ]
    dining_zones = list(
        getattr(self, "_livinai_dining_footprints", ())
    )
    original_placed = list(self.placed)
    self.placed = [
        footprint
        for footprint in self.placed
        if not any(footprint is zone for zone in dining_zones)
    ]
    try:
        for width, depth in ((1.10, 0.60), (0.96, 0.56)):
            for distance in (1.12, 1.02, 1.22):
                built = builder(self.P, w=width, d=depth)
                _meshes, actual_width, actual_depth = built
                position = sofa_position + sofa_facing * distance
                footprint = original.footprint_poly(
                    position,
                    float(sofa["yaw"]),
                    actual_width,
                    actual_depth,
                )
                physical_conflict = any(
                    footprint.buffer(0.10).intersects(
                        original.footprint_poly(
                            np.asarray(item["position"], dtype=float),
                            float(item["yaw"]),
                            float(item["width"]),
                            float(item["depth"]),
                        )
                    )
                    for item in dining_items
                )
                if physical_conflict:
                    continue
                if self.add(
                    built,
                    position,
                    float(sofa["yaw"]),
                ):
                    return True
    finally:
        recovered = [
            footprint
            for footprint in self.placed
            if all(footprint is not old for old in original_placed)
        ]
        self.placed = original_placed + recovered
    return False


def _furnish_aligned_living(self):
    """Normalize the finished seating group around one measured focal axis."""
    _ORIGINAL_FURNISH_LIVING(self)
    wants_dining = (
        not self.config.get("_plan_has_dining_room", False)
        and float(self.poly.area) >= 10.0
        and not any(
            phrase in self.brief
            for phrase in ("no dining", "without dining", "living only")
        )
    )
    dining_table = _furniture_with_suffix(self, "dining_table")
    if wants_dining and not dining_table:
        # The living/dining allocation is a required zone when the plan has no
        # separate dining room. Recover it after the lounge recipe and, if the
        # room is tight, release optional armchairs before the final guaranteed
        # compact placement. The sofa and coffee table remain untouched.
        dining_zone = self.place_dining_zone(compact=True)
        if not dining_zone:
            optional_chairs = [
                item
                for item in self.editable_objects
                if str(item.get("asset_key", "")).endswith("armchair")
            ]
            for chair in optional_chairs:
                _remove_furniture_object(self, chair)
                dining_zone = self.place_dining_zone(compact=True)
                if dining_zone:
                    break
        if not dining_zone:
            self.place_dining_zone(compact=True, guarantee=True)
    sofa = _furniture_with_suffix(self, "sofa")
    if not sofa:
        _place_required_living_group(self)
        sofa = _furniture_with_suffix(self, "sofa")
    coffee_table = next(
        (
            item
            for item in reversed(self.editable_objects)
            if "coffee_table" in str(item.get("asset_key", ""))
        ),
        None,
    )
    if sofa and not coffee_table:
        _place_required_coffee_table(self, sofa)
        coffee_table = next(
            (
                item
                for item in reversed(self.editable_objects)
                if "coffee_table" in str(item.get("asset_key", ""))
            ),
            None,
        )
    if not sofa or not coffee_table:
        return

    sofa_position = np.asarray(sofa["position"], dtype=float)
    sofa_facing, sofa_lateral = _furniture_axes(sofa)
    sofa_key = str(sofa.get("asset_key", ""))
    sectional_side = (
        -1
        if "left_l_sectional" in sofa_key
        else 1
        if "right_l_sectional" in sofa_key
        else 0
    )
    if sectional_side:
        # The chaise occupies one side of the nominal bounding rectangle. Keep
        # the table beside it, aligned with the main seat front, rather than
        # overlapping the chaise or floating beyond its tip.
        table_position = (
            sofa_position
            + sofa_facing
            * (
                0.10
                + float(coffee_table["depth"]) / 2
                + DESIGN_CLEARANCES["sofa_table_gap"]
            )
            - sofa_lateral
            * sectional_side
            * min(0.62, float(sofa["width"]) * 0.24)
        )
    else:
        table_position = (
            sofa_position
            + sofa_facing
            * (
                float(sofa["depth"]) / 2
                + float(coffee_table["depth"]) / 2
                + DESIGN_CLEARANCES["sofa_table_gap"]
            )
        )
    table_footprint = original.footprint_poly(
        table_position,
        float(sofa["yaw"]),
        float(coffee_table["width"]),
        float(coffee_table["depth"]),
    )
    safe_room = self.poly.buffer(-0.08)
    table_conflicts = (
        safe_room.is_empty
        or not table_footprint.within(safe_room)
        or any(
            table_footprint.intersection(zone).area > 0.025
            for zone in getattr(self, "circulation_zones", ())
        )
        or any(
            table_footprint.intersects(zone)
            for zone in getattr(self, "_livinai_dining_footprints", ())
        )
    )
    if not table_conflicts:
        _set_furniture_pose(
            coffee_table,
            table_position,
            float(sofa["yaw"]),
        )
    else:
        table_position = np.asarray(coffee_table["position"], dtype=float)
        table_footprint = original.footprint_poly(
            table_position,
            float(coffee_table["yaw"]),
            float(coffee_table["width"]),
            float(coffee_table["depth"]),
        )

    # The sofa keeps the yaw its wall gave it.
    #
    # This used to turn the sofa to face the coffee table, which is fine when
    # the table is dead ahead and wrong every other time. An L-sectional puts
    # its table up to 0.62 m off the seating axis, and a table that could not
    # be moved stays wherever it was — so "face the table" swung the sofa as
    # much as thirty degrees off the wall behind it. Because it rotates about
    # its own centre, and that centre sits half a sofa-depth off the wall, one
    # end then buried itself in the plaster: the tilted sofa half-inside the
    # wall that people were seeing.
    #
    # A sofa against a wall is parallel to that wall. `against_wall` already
    # places it square, and the coffee table is aligned to the sofa above
    # rather than the other way round, so there is nothing left to correct.
    chairs = [
        item
        for item in self.editable_objects
        if str(item.get("asset_key", "")).endswith("armchair")
    ]
    chairs.sort(
        key=lambda item: float(
            np.linalg.norm(
                np.asarray(item["position"], dtype=float)
                - table_position
            )
        )
    )
    dining_zones = [
        zone.buffer(0.10)
        for zone in getattr(self, "_livinai_dining_footprints", ())
    ]
    circulation_zones = [
        zone.buffer(0.06)
        for zone in getattr(self, "circulation_zones", ())
    ]
    area = float(self.poly.area)
    keep_limit = (
        1
        if sectional_side or area < 18.0
        else 2
    )
    kept = 0
    chair_sides = (
        (-sectional_side,)
        if sectional_side
        else (-1, 1)
    )
    for chair, side in zip(chairs, chair_sides):
        position = (
            table_position
            + sofa_lateral * side * (1.30 if sectional_side else 1.36)
            + sofa_facing * (0.18 if sectional_side else 0.28)
        )
        chair_yaw = original.yaw_facing(table_position - position)
        footprint = original.footprint_poly(
            position,
            chair_yaw,
            float(chair["width"]),
            float(chair["depth"]),
        )
        conflicts = (
            not footprint.within(safe_room)
            or footprint.intersects(table_footprint.buffer(0.20))
            or any(footprint.intersects(zone) for zone in dining_zones)
            or any(
                footprint.intersection(zone).area > 0.025
                for zone in circulation_zones
            )
        )
        if conflicts or kept >= keep_limit:
            _remove_furniture_object(self, chair)
            continue
        _set_furniture_pose(chair, position, chair_yaw)
        kept += 1
    for chair in chairs[len(chair_sides):]:
        _remove_furniture_object(self, chair)


def _bathroom_corner_candidates(self):
    entries = [
        np.asarray(entry["center"], dtype=float)
        for entry in getattr(self, "door_access_entries", ())
    ]
    if not entries:
        entries = [
            np.array(
                [zone.centroid.x, zone.centroid.y],
                dtype=float,
            )
            for zone in self.door_zones
        ]
    candidates = []
    for vertex in self.room_m:
        corner = np.asarray(vertex, dtype=float)
        entry_clearance = min(
            (
                float(np.linalg.norm(corner - entry))
                for entry in entries
            ),
            default=4.0,
        )
        candidates.append((entry_clearance, corner))
    return [
        corner
        for _clearance, corner in sorted(
            candidates,
            key=lambda item: -item[0],
        )
    ]


def _place_bathroom_shower(self, shower_builder):
    vertices = [
        np.asarray(vertex, dtype=float)
        for vertex in self.room_m
    ]
    if len(vertices) > 2 and np.linalg.norm(vertices[0] - vertices[-1]) < 1e-6:
        vertices = vertices[:-1]
    for size in (0.92, 0.80, 0.72):
        ranked_corners = _bathroom_corner_candidates(self)
        for corner in ranked_corners:
            index = min(
                range(len(vertices)),
                key=lambda item: float(np.linalg.norm(vertices[item] - corner)),
            )
            previous = vertices[(index - 1) % len(vertices)] - corner
            following = vertices[(index + 1) % len(vertices)] - corner
            previous_length = float(np.linalg.norm(previous))
            following_length = float(np.linalg.norm(following))
            if previous_length < 1e-6 or following_length < 1e-6:
                continue
            previous /= previous_length
            following /= following_length
            # Ignore nearly straight vertices introduced by traced plans.
            if abs(float(np.dot(previous, following))) > 0.94:
                continue
            position = (
                corner
                + previous * (size / 2 + 0.055)
                + following * (size / 2 + 0.055)
            )
            yaw = math.atan2(previous[1], previous[0])
            facing = np.array([-math.sin(yaw), math.cos(yaw)], dtype=float)
            if float(np.dot(facing, following)) < 0:
                yaw += math.pi
            footprint = original.footprint_poly(
                position,
                yaw,
                size,
                size,
            )
            service_zone = _front_service_zone(
                position,
                yaw,
                size,
                size,
                0.62,
            )
            if (
                not self._ok(footprint)
                or not _service_zone_is_clear(
                    self,
                    service_zone,
                    avoid_doors=True,
                    allowed_overlap=0.03,
                )
            ):
                continue
            if self.add(
                shower_builder(self.P, w=size, d=size),
                position,
                yaw,
            ):
                return True
    # A compact bathroom still needs a wet fixture. If the conservative
    # service-zone test consumed the whole room, use the farthest valid corner
    # with a compact tray while continuing to protect the actual door leaf and
    # entry footprint. This runs before the vanity and toilet are placed.
    safe_room = self.poly.buffer(-0.02)
    for size in (0.68, 0.62):
        for corner in _bathroom_corner_candidates(self):
            index = min(
                range(len(vertices)),
                key=lambda item: float(np.linalg.norm(vertices[item] - corner)),
            )
            previous = vertices[(index - 1) % len(vertices)] - corner
            following = vertices[(index + 1) % len(vertices)] - corner
            previous_length = float(np.linalg.norm(previous))
            following_length = float(np.linalg.norm(following))
            if previous_length < 1e-6 or following_length < 1e-6:
                continue
            previous /= previous_length
            following /= following_length
            if abs(float(np.dot(previous, following))) > 0.94:
                continue
            position = (
                corner
                + previous * (size / 2 + 0.035)
                + following * (size / 2 + 0.035)
            )
            yaw = math.atan2(previous[1], previous[0])
            footprint = original.footprint_poly(position, yaw, size, size)
            if (
                safe_room.is_empty
                or not footprint.within(safe_room)
                or any(
                    footprint.intersection(zone).area > 0.015
                    for zone in self.door_zones
                )
            ):
                continue
            if self.add(
                shower_builder(self.P, w=size, d=size),
                position,
                yaw,
                avoid_doors=False,
                check=False,
            ):
                return True
    return False


def _place_wall_accessory(
    self,
    anchor,
    builder,
    *,
    lateral=0.0,
    **kwargs,
):
    if not anchor:
        return False
    built = builder(self.P, **kwargs)
    _meshes, _width, depth = built
    wall_position = (
        np.asarray(anchor["pos"], dtype=float)
        - np.asarray(anchor["n"], dtype=float)
        * (float(anchor["d"]) / 2 + original.WALL_GAP)
    )
    position = (
        wall_position
        + np.asarray(anchor["n"], dtype=float)
        * (original.WALL_GAP + float(depth) / 2)
        + np.asarray(anchor["s"], dtype=float) * float(lateral)
    )
    return self.add(
        built,
        position,
        float(anchor["yaw"]),
        block=False,
        avoid_doors=True,
        check=True,
    )


def _furnish_aligned_bathroom(self):
    """Zone wet, wash and toilet fixtures from the entrance outward."""
    # A full-room circulation lane is useful in living spaces, but its 1.85 m
    # depth can consume an entire compact bathroom. Keep a real, shallow
    # entrance-clear zone here so the door remains usable without preventing
    # every fixture from being placed.
    if self.door_access_entries:
        self.door_zones = [
            original.footprint_poly(
                np.asarray(entry["center"], dtype=float)
                + np.asarray(entry["inward"], dtype=float) * 0.41,
                original.yaw_facing(entry["inward"]),
                float(entry.get("width", 0.82)) + 0.28,
                0.82,
            ).intersection(self.poly)
            for entry in self.door_access_entries
        ]

    vanity_builder = self.furniture_builder(
        "vanity",
        original.build_vanity,
    )
    toilet_builder = self.furniture_builder(
        "toilet",
        original.build_toilet,
    )
    shower_builder = self.furniture_builder(
        "shower",
        original.build_shower,
    )
    bathtub_builder = self.furniture_builder(
        "bathtub",
        original.build_bathtub,
    )

    rectangle = list(self.poly.minimum_rotated_rectangle.exterior.coords)
    spans = [
        float(
            np.linalg.norm(
                np.asarray(rectangle[index + 1])
                - np.asarray(rectangle[index])
            )
        )
        for index in range(min(4, len(rectangle) - 1))
    ]
    major = max(spans, default=0.0)
    minor = min(spans, default=0.0)
    use_bathtub = (
        float(self.poly.area) >= 8.8
        and major >= 3.35
        and minor >= 1.85
    )

    entry_points = [
        np.asarray(entry["center"], dtype=float)
        for entry in getattr(self, "door_access_entries", ())
    ]

    def far_wall(slot):
        clearance = min(
            (
                float(
                    np.linalg.norm(
                        np.asarray(slot["mid"], dtype=float)
                        - entry
                    )
                )
                for entry in entry_points
            ),
            default=0.0,
        )
        return (-clearance, -float(slot["len"]))

    wet_info = None
    if use_bathtub:
        wet_info = (
            _shifted_against_wall(
                self,
                bathtub_builder,
                min_side=1.58,
                prefer=far_wall,
                front_clearance=0.68,
                w=1.52,
                d=0.74,
            )
            or _shifted_against_wall(
                self,
                bathtub_builder,
                min_side=1.34,
                prefer=far_wall,
                front_clearance=0.64,
                w=1.28,
                d=0.70,
            )
        )
    if wet_info is None:
        _place_bathroom_shower(self, shower_builder)
        wet_object = next(
            (
                item
                for item in reversed(self.editable_objects)
                if str(item.get("asset_key", "")).endswith("shower")
            ),
            None,
        )
    else:
        wet_object = next(
            (
                item
                for item in reversed(self.editable_objects)
                if str(item.get("asset_key", "")).endswith("bathtub")
            ),
            None,
        )

    wet_position = (
        np.asarray(wet_object["position"], dtype=float)
        if wet_object
        else np.asarray(self.centroid, dtype=float)
    )

    def vanity_preference(slot):
        distance_from_wet = float(
            np.linalg.norm(
                np.asarray(slot["mid"], dtype=float)
                - wet_position
            )
        )
        entry_distance = min(
            (
                float(
                    np.linalg.norm(
                        np.asarray(slot["mid"], dtype=float)
                        - entry
                    )
                )
                for entry in entry_points
            ),
            default=2.0,
        )
        return (
            -distance_from_wet,
            abs(entry_distance - 1.5),
            -float(slot["len"]),
        )

    vanity = (
        _shifted_against_wall(
            self,
            vanity_builder,
            min_side=0.96,
            prefer=vanity_preference,
            front_clearance=DESIGN_CLEARANCES["vanity_front"],
            side_clearance=0.08,
            w=0.90,
            d=0.48,
        )
        or _shifted_against_wall(
            self,
            vanity_builder,
            min_side=0.74,
            prefer=vanity_preference,
            front_clearance=0.70,
            side_clearance=0.05,
            w=0.70,
            d=0.44,
        )
    )
    if vanity:
        mirror_position = (
            np.asarray(vanity["pos"], dtype=float)
            - vanity["n"] * (vanity["d"] / 2 + 0.012)
        )
        self.add(
            _editable_builder(
                self,
                "bathroom_mirror",
                original.build_round_mirror,
            )(
                self.P,
                diameter=max(0.70, min(0.88, vanity["w"] * 0.92)),
                z=1.48,
            ),
            mirror_position,
            vanity["yaw"],
            block=False,
            avoid_doors=False,
            check=False,
        )

    def toilet_preference(slot):
        vanity_distance = (
            float(
                np.linalg.norm(
                    np.asarray(slot["mid"], dtype=float)
                    - np.asarray(vanity["pos"], dtype=float)
                )
            )
            if vanity
            else 0.0
        )
        wet_distance = float(
            np.linalg.norm(
                np.asarray(slot["mid"], dtype=float)
                - wet_position
            )
        )
        return (
            -min(vanity_distance, wet_distance),
            -float(slot["len"]),
        )

    toilet = (
        _shifted_against_wall(
            self,
            toilet_builder,
            min_side=0.66,
            prefer=toilet_preference,
            front_clearance=DESIGN_CLEARANCES["toilet_front"],
            side_clearance=0.10,
            w=0.42,
            d=0.66,
        )
        or _shifted_against_wall(
            self,
            toilet_builder,
            min_side=0.58,
            prefer=toilet_preference,
            front_clearance=0.68,
            side_clearance=0.08,
            w=0.38,
            d=0.58,
        )
    )

    if vanity:
        for side in (-1, 1):
            if _place_wall_accessory(
                self,
                vanity,
                original.build_towel_rail,
                lateral=side * (vanity["w"] / 2 + 0.38),
                w=0.56,
            ):
                break
    if toilet:
        _place_wall_accessory(
            self,
            toilet,
            original.build_bathroom_shelf,
            w=min(0.64, max(0.46, toilet["w"] + 0.14)),
        )
    mat_position = (
        np.asarray(vanity["pos"], dtype=float)
        + vanity["n"] * (vanity["d"] / 2 + 0.42)
        if vanity
        else np.asarray(self.centroid, dtype=float)
    )
    self.place_rug(
        mat_position,
        vanity["yaw"] if vanity else 0.0,
        0.80,
        0.50,
    )
    self.pendant()


def _furnish_entry_or_hall(self):
    """Keep circulation rooms open and add only one correctly scaled landing piece."""
    area = float(self.poly.area)
    _major, minor = _room_span_metrics(self)
    anchor = None
    if minor >= 2.0 and area >= 6.0:
        anchor = _shifted_against_wall(
            self,
            original.build_bench,
            min_side=1.06,
            front_clearance=0.62,
            w=0.98,
            d=0.40,
        )
    elif minor >= 1.45 and area >= 4.0:
        anchor = _shifted_against_wall(
            self,
            _editable_builder(
                self,
                "entry_drawer_storage",
                _build_drawer_dresser,
            ),
            min_side=0.84,
            front_clearance=0.66,
            w=0.78,
            d=0.30,
        )
    if anchor:
        _place_mirror_over(
            self,
            anchor,
            diameter=min(0.66, max(0.48, anchor["w"] * 0.64)),
        )
    else:
        self.against_wall(
            _editable_builder(
                self,
                "full_length_mirror",
                _build_full_length_mirror,
            ),
            min_side=0.72,
            block=False,
            w=0.56,
            d=0.10,
        )
    if anchor is None and minor >= 1.65:
        self.against_wall(
            _editable_builder(
                self,
                "wall_shelves",
                _build_wall_shelves,
            ),
            min_side=0.72,
            block=False,
            w=0.68,
            d=0.13,
        )
    if self.wants_plants and area >= 7.0 and minor >= 1.8:
        self.in_corner(original.build_plant, tall=False)
    self.pendant()


def _build_laundry_storage(palette, w=1.46, d=0.62):
    """Two front-loading appliances with counter and upper storage."""
    cabinet = original._mix_color(
        palette["cabinet"],
        palette["wall"],
        0.34,
    )
    appliance = original._mix_color([0.88, 0.90, 0.90], cabinet, 0.20)
    front = d / 2 + 0.015
    meshes = [
        original._bx(w, d, 0.90, cabinet),
        original._bx(w + 0.04, d + 0.03, 0.045, palette["counter"], z=0.90),
        original._bx(w, d * 0.56, 0.66, cabinet, cy=-(d * 0.18), z=1.42),
    ]
    machine_width = w / 2 - 0.035
    for side in (-1, 1):
        center_x = side * w * 0.25
        meshes.append(
            original._bx(
                machine_width,
                0.035,
                0.80,
                appliance,
                cx=center_x,
                cy=front,
                z=0.05,
            )
        )
        door = original.o3d.geometry.TriangleMesh.create_cylinder(
            radius=min(0.24, machine_width * 0.34),
            height=0.035,
            resolution=36,
        )
        door.rotate(
            original.o3d.geometry.get_rotation_matrix_from_xyz(
                (math.pi / 2, 0.0, 0.0)
            ),
            center=(0.0, 0.0, 0.0),
        )
        door.translate((center_x, front + 0.025, 0.42))
        original._paint(door, [0.20, 0.25, 0.27])
        meshes.append(door)
        meshes.append(
            original._bx(
                machine_width * 0.72,
                0.026,
                0.10,
                [0.72, 0.75, 0.76],
                cx=center_x,
                cy=front + 0.024,
                z=0.72,
            )
        )
    apply_archviz_material(
        meshes[1],
        "marble",
        tint=palette["counter"],
        tint_strength=0.12,
        repeat_m=0.72,
    )
    return meshes, w, d


def _furnish_laundry_or_utility(self):
    """Use functional cabinetry instead of generic living-room decor."""
    storage = (
        _shifted_against_wall(
            self,
            _editable_builder(
                self,
                "laundry_storage",
                _build_laundry_storage,
            ),
            min_side=1.40,
            front_clearance=0.82,
            w=1.34,
            d=0.60,
            avoid_doors=True,
        )
        or _shifted_against_wall(
            self,
            _editable_builder(
                self,
                "laundry_storage",
                _build_laundry_storage,
            ),
            min_side=1.02,
            front_clearance=0.76,
            w=0.98,
            d=0.56,
            avoid_doors=True,
        )
    )
    other_slots = self.wall_slots()
    if storage:
        other_slots = [
            slot
            for slot in other_slots
            if slot["edge"] is not storage["slot"]["edge"]
        ] or other_slots
    self.against_wall(
        _editable_builder(
            self,
            "utility_wall_shelves",
            _build_wall_shelves,
        ),
        slots=other_slots,
        min_side=0.82,
        block=False,
        w=0.80,
        d=0.18,
    )
    self.pendant()


def _kitchen_run_has_window(slot):
    return any(
        "window" in str(opening[0]).lower()
        for opening in slot.get("edge", {}).get("openings", ())
    )


def _build_fitted_kitchen_run(palette, w=2.4, under_window=False):
    """Build cabinetry without letting wall units cover a kitchen window."""
    try:
        meshes, width, depth = original.build_kitchen_run(
            palette,
            w=w,
            include_sink=False,
            include_cooktop=False,
        )
    except TypeError:
        # Compatibility with an older Interior_Plan checkout. The modern
        # source accepts the two flags; retaining this fallback keeps Livinai
        # launchable while still guaranteeing fitted cabinetry.
        meshes, width, depth = original.build_kitchen_run(palette, w=w)
    if under_window:
        filtered = []
        for mesh in meshes:
            try:
                if float(np.asarray(mesh.get_min_bound())[2]) >= 1.18:
                    continue
            except Exception:
                pass
            filtered.append(mesh)
        meshes = filtered
    return meshes, width, depth


def _place_designer_kitchen_run(
    self,
    slot,
    asset_key,
    max_length=3.4,
    reserve_end=0.0,
    reserve_sign=1.0,
    corner_anchor=None,
    corner_clearance=0.10,
):
    """Place a fitted run from its wall geometry, not a broad door buffer.

    A wall slot already excludes the physical doorway plus a 30 cm landing.
    Rechecking it against the full approach corridor made wide-open kitchens
    reject every counter and fall back to a lone refrigerator. This path uses
    a conservative wall stand-off and verifies the run against the actual room
    shell, so cabinetry remains guaranteed without obstructing the opening.
    """
    edge_allowance = (
        max(0.20, float(corner_clearance) + 0.10)
        if corner_anchor is not None
        else 0.20
    )
    available = float(slot["len"]) - edge_allowance
    reserved = min(max(0.0, float(reserve_end)), max(0.0, available - 0.86))
    reserved_sign = 1.0 if float(reserve_sign) >= 0 else -1.0
    run_available = available - reserved
    if run_available < 0.86:
        return None
    safe_room = self.poly.buffer(-0.075)
    if safe_room.is_empty:
        safe_room = self.poly
    builder = _editable_builder(
        self,
        asset_key,
        _build_fitted_kitchen_run,
    )
    for target in (
        min(max_length, run_available),
        min(2.40, run_available),
        min(1.80, run_available),
        min(1.20, run_available),
        run_available,
    ):
        width = max(0.86, float(target))
        built = builder(
            self.P,
            w=width,
            under_window=_kitchen_run_has_window(slot),
        )
        depth = float(built[2])
        if corner_anchor is not None:
            edge_start = np.asarray(slot["p1"], dtype=float)
            edge_span = (
                np.asarray(slot["p2"], dtype=float) - edge_start
            )
            free_a = edge_start + edge_span * float(slot["t0"])
            free_b = edge_start + edge_span * float(slot["t1"])
            corner_anchor = np.asarray(corner_anchor, dtype=float)
            if float(np.linalg.norm(free_a - corner_anchor)) <= float(
                np.linalg.norm(free_b - corner_anchor)
            ):
                wall_anchor = free_a
                run_direction = np.asarray(slot["dir"], dtype=float)
            else:
                wall_anchor = free_b
                run_direction = -np.asarray(slot["dir"], dtype=float)
            position = (
                wall_anchor
                + run_direction * (width / 2 + float(corner_clearance))
                + np.asarray(slot["n"], dtype=float)
                * (original.WALL_GAP + depth / 2)
            )
        else:
            position = (
                np.asarray(slot["mid"], dtype=float)
                + np.asarray(slot["n"], dtype=float)
                * (original.WALL_GAP + depth / 2)
                - np.asarray(slot["dir"], dtype=float)
                * (reserved / 2)
                * reserved_sign
            )
        yaw = original.yaw_facing(slot["n"])
        footprint = original.footprint_poly(position, yaw, width, depth)
        if not footprint.within(safe_room):
            continue
        if self.add(
            built,
            position,
            yaw,
            block=False,
            avoid_doors=False,
            check=False,
        ):
            self.placed.append(footprint.buffer(0.025))
            return {
                "slot": slot,
                "pos": position,
                "n": np.asarray(slot["n"], dtype=float),
                "s": np.asarray(slot["dir"], dtype=float),
                "L": width,
                "d": depth,
                "yaw": yaw,
                "reservedEnd": reserved,
                "reservedSign": reserved_sign,
            }
    return None


def _rank_kitchen_slots(self):
    """Prefer long service walls and a sink-friendly window wall."""
    slots = list(self.wall_slots(include_windows=True))

    def score(slot):
        openings = slot.get("edge", {}).get("openings", ())
        has_door = any("door" in str(item[0]).lower() for item in openings)
        has_window = any("window" in str(item[0]).lower() for item in openings)
        return (
            float(slot["len"])
            + (0.34 if has_window else 0.0)
            - (0.80 if has_door else 0.0)
        )

    return sorted(slots, key=score, reverse=True)


def _kitchen_secondary_slots(primary, slots, plan):
    perpendicular = [
        slot
        for slot in slots
        if slot["edge"] is not primary["slot"]["edge"]
        and abs(float(np.dot(slot["dir"], primary["s"]))) < 0.28
        and slot["len"] >= 1.08
    ]
    opposite = [
        slot
        for slot in slots
        if slot["edge"] is not primary["slot"]["edge"]
        and float(np.dot(slot["n"], primary["n"])) < -0.62
        and slot["len"] >= 1.20
    ]
    if plan == "galley":
        return list(opposite) + list(perpendicular), 1
    if plan == "u":
        return list(perpendicular) + list(opposite), 2
    if plan == "l":
        return list(perpendicular) + list(opposite), 1
    return [], 0


def _kitchen_fridge_reserve_sign(primary_slot, slots, plan):
    """Reserve the tall-unit bay opposite the most usable return wall."""
    if plan not in ("l", "u"):
        return 1.0
    perpendicular = [
        slot
        for slot in slots
        if slot["edge"] is not primary_slot["edge"]
        and abs(float(np.dot(slot["dir"], primary_slot["dir"]))) < 0.28
        and slot["len"] >= 1.08
    ]
    if not perpendicular:
        return 1.0
    return_slot = max(perpendicular, key=lambda slot: float(slot["len"]))
    projection = float(
        np.dot(
            np.asarray(return_slot["mid"], dtype=float)
            - np.asarray(primary_slot["mid"], dtype=float),
            np.asarray(primary_slot["dir"], dtype=float),
        )
    )
    return -1.0 if projection >= 0 else 1.0


def _place_kitchen_feature(self, primary, feature):
    builder = self.furniture_builder(
        "kitchen_island",
        original.build_island,
    )
    sizes = (
        ((1.55, 0.84), (1.32, 0.76))
        if feature == "peninsula"
        else ((1.72, 0.90), (1.42, 0.78))
    )
    for width, depth in sizes:
        probe = builder(self.P, w=width, d=depth)
        group_width, group_depth = float(probe[1]), float(probe[2])
        preferred = (
            np.asarray(primary["pos"], dtype=float)
            + primary["n"] * (1.35 if feature == "peninsula" else 2.00)
            + (
                primary["s"] * max(0.0, primary["L"] / 2 - 0.78)
                if feature == "peninsula"
                else 0.0
            )
        )
        pose = self.find_open_pose(
            group_width,
            group_depth,
            preferred=preferred,
            yaws=[primary["yaw"], primary["yaw"] + math.pi / 2],
        )
        if pose and self.add(
            builder(self.P, w=width, d=depth),
            pose["pos"],
            pose["yaw"],
        ):
            return np.asarray(pose["pos"], dtype=float)
    return None


def _integrated_kitchen_fridge_candidate(self, run, fridge_builder):
    """Use the tall-unit bay deliberately reserved beside the primary run."""
    if float(run.get("reservedEnd", 0.0)) < 0.68:
        return None
    probe = fridge_builder(self.P)
    width, depth = float(probe[1]), float(probe[2])
    position = (
        np.asarray(run["pos"], dtype=float)
        + run["s"]
        * float(run.get("reservedSign", 1.0))
        * (run["L"] / 2 + 0.12 + width / 2)
        + run["n"] * ((depth - run["d"]) / 2)
    )
    yaw = original.yaw_facing(run["n"])
    footprint = original.footprint_poly(position, yaw, width, depth)
    if not footprint.within(self.poly.buffer(-0.075)):
        return None
    if any(footprint.intersection(item).area > 0.025 for item in self.placed):
        return None
    return position, yaw


def _furnish_designer_kitchen(self):
    """Type-faithful fitted kitchen with a measured work triangle/work line."""
    kitchen_key = _kitchen_type_key(self.config.get("kitchen_type"))
    rule = KITCHEN_TYPE_RULES[kitchen_key]
    slots = _rank_kitchen_slots(self)
    plan = rule["cabinet_plan"]
    if plan == "adaptive":
        _major, minor = _room_span_metrics(self)
        plan = "l" if self.poly.area >= 9.5 and minor >= 2.35 else "single"
    primary = None
    for slot in slots:
        reserve_sign = _kitchen_fridge_reserve_sign(slot, slots, plan)
        primary = _place_designer_kitchen_run(
            self,
            slot,
            f"{kitchen_key}_primary_cabinet_run",
            max_length=3.55,
            reserve_end=0.92,
            reserve_sign=reserve_sign,
        )
        if primary:
            break

    if primary is None:
        # Extremely irregular detected rooms may not expose a conventional
        # wall slot. Retain a visible, functional minimum kitchen rather than
        # silently returning a refrigerator in an empty tiled room.
        fallback_slots = list(self.wall_slots(include_windows=True))
        if fallback_slots:
            primary = _place_designer_kitchen_run(
                self,
                fallback_slots[0],
                f"{kitchen_key}_compact_cabinet_run",
                max_length=1.40,
            )

    fridge_builder = self.furniture_builder("fridge", original.build_fridge)
    if primary is None:
        self.against_wall(fridge_builder, slots=slots, avoid_doors=False)
        self.pendant()
        return

    runs = [primary]
    candidates, wanted = _kitchen_secondary_slots(primary, slots, plan)
    used_edges = {id(primary["slot"]["edge"])}
    for slot in candidates:
        if id(slot["edge"]) in used_edges:
            continue
        extra = _place_designer_kitchen_run(
            self,
            slot,
            f"{kitchen_key}_secondary_cabinet_run",
            max_length=3.10 if plan == "galley" else 2.35,
            corner_anchor=(
                primary["pos"]
                if abs(float(np.dot(slot["dir"], primary["s"]))) < 0.28
                else None
            ),
            corner_clearance=float(primary["d"]) + 0.06,
        )
        if extra:
            runs.append(extra)
            used_edges.add(id(slot["edge"]))
            if len(runs) - 1 >= wanted:
                break

    # The source engine's search evaluates all fixture combinations using the
    # accepted 1.2-2.7 m legs and 4-8 m perimeter, while automatically using a
    # sink-centred work line in a true single-wall kitchen.
    triangle = None
    integrated_fridge = _integrated_kitchen_fridge_candidate(
        self,
        primary,
        fridge_builder,
    )
    try:
        fridge_candidates = (
            [integrated_fridge]
            if integrated_fridge is not None
            else self._kitchen_fridge_candidates(primary, slots)
        )
        triangle = self._place_work_triangle(runs, fridge_candidates)
    except Exception as exc:
        print(f"[WALK] Kitchen work-triangle search degraded: {exc}")
    if triangle is not None:
        if not self.add(
            fridge_builder(self.P),
            triangle["fridge"],
            triangle["fridge_yaw"],
            avoid_doors=integrated_fridge is None,
        ):
            self._place_kitchen_fridge(primary, slots)
    else:
        try:
            self._place_kitchen_fridge(primary, slots)
        except Exception:
            self.against_wall(fridge_builder, slots=slots, avoid_doors=False)

    feature_position = None
    if rule.get("peninsula"):
        feature_position = _place_kitchen_feature(self, primary, "peninsula")
    elif rule.get("island"):
        feature_position = _place_kitchen_feature(self, primary, "island")
    elif kitchen_key == "open" and self.poly.area >= 15.0:
        # "Open" controls the architecture first. Add an island only when the
        # room still passes real clearance checks after the fitted work zone.
        feature_position = _place_kitchen_feature(self, primary, "island")

    self.pendant(feature_position)


def _furnish_complete_room(self, room_type):
    room_key = str(room_type or "").lower()
    if any(word in room_key for word in ("laundry", "utility")):
        try:
            _furnish_laundry_or_utility(self)
        except Exception as exc:
            print(f"[WALK] Utility furnishing failed for '{room_type}': {exc}")
        return self.meshes, self.placed
    if any(
        word in room_key
        for word in ("entry", "hall", "corridor", "foyer")
    ):
        try:
            _furnish_entry_or_hall(self)
        except Exception as exc:
            print(f"[WALK] Entry furnishing failed for '{room_type}': {exc}")
        return self.meshes, self.placed
    return _ORIGINAL_FURNISH(self, room_type)


def _build_opening_curtains(
    room_m,
    edges,
    palette,
    curtain_design,
):
    """Build one identical textile treatment for windows and balconies."""
    if curtain_design == "none":
        return []
    polygon = original.Polygon([(point[0], point[1]) for point in room_m])
    if not polygon.is_valid:
        polygon = polygon.buffer(0)
    meshes = []
    drape = original._shade(palette["shade"], 0.94)
    rod_color = original._mix_color(
        palette["metal"],
        [0.18, 0.16, 0.14],
        0.58,
    )
    curtain_top = (
        float(original.WINDOW_SILL)
        + float(original.WINDOW_HEIGHT)
        + 0.22
    )
    curtain_bottom = 0.10
    room_centroid = np.asarray(
        [polygon.centroid.x, polygon.centroid.y],
        dtype=float,
    )
    balcony_owners = _ACTIVE_BALCONY_CURTAIN_OWNERS.get()

    for edge in edges:
        p1 = np.asarray(edge["p1"], dtype=float)
        p2 = np.asarray(edge["p2"], dtype=float)
        length = float(edge["length"])
        if length < 0.30:
            continue
        direction = (p2 - p1) / length
        normal = np.array([-direction[1], direction[0]])
        wall_offset = float(original.WALL_THICKNESS) / 2

        for kind, start, end in edge.get("openings", []):
            if kind not in ("window", "balcony", "balcony_hole"):
                continue
            opening_a = p1 + (p2 - p1) * float(start)
            opening_b = p1 + (p2 - p1) * float(end)
            opening_width = float(np.linalg.norm(opening_b - opening_a))
            if opening_width < 0.35:
                continue
            opening_midpoint = (opening_a + opening_b) / 2
            positive_probe = opening_midpoint + normal * 0.24
            negative_probe = opening_midpoint - normal * 0.24
            positive_inside = polygon.buffer(0.015).covers(
                original.Point(*positive_probe)
            )
            negative_inside = polygon.buffer(0.015).covers(
                original.Point(*negative_probe)
            )
            if positive_inside != negative_inside:
                inward = normal if positive_inside else -normal
            else:
                # Concave traced rooms can put the edge midpoint outside even
                # though the opening itself is valid. The centroid-side test is
                # deterministic and keeps the treatment inside the room.
                inward = (
                    normal
                    if float(np.dot(room_centroid - opening_midpoint, normal)) >= 0
                    else -normal
                )
            template_width = opening_width
            if kind in ("balcony", "balcony_hole") and balcony_owners:
                matching_owner = min(
                    balcony_owners,
                    key=lambda record: (
                        float(
                            np.linalg.norm(
                                opening_midpoint - record["midpoint"]
                            )
                        )
                        + abs(opening_width - record["length"])
                    ),
                )
                midpoint_error = float(
                    np.linalg.norm(
                        opening_midpoint - matching_owner["midpoint"]
                    )
                )
                length_error = abs(opening_width - matching_owner["length"])
                if midpoint_error <= 0.12 and length_error <= 0.16:
                    if (
                        np.linalg.norm(
                            room_centroid - matching_owner["room_centroid"]
                        )
                        > 0.12
                    ):
                        continue

            rod_a = (
                opening_a
                - direction * 0.14
                + inward * (wall_offset + 0.10)
            )
            rod_b = (
                opening_b
                + direction * 0.14
                + inward * (wall_offset + 0.10)
            )
            rod = original._cylinder_between(
                (rod_a[0], rod_a[1], curtain_top),
                (rod_b[0], rod_b[1], curtain_top),
                0.016,
                rod_color,
                resolution=18,
            )
            if rod is not None:
                meshes.append(rod)
                for point in (rod_a, rod_b):
                    meshes.append(
                        original._sph(
                            0.028,
                            rod_color,
                            cx=point[0],
                            cy=point[1],
                            z=curtain_top,
                        )
                    )

            if curtain_design in (
                "sheer panels",
                "layered sheers + drapes",
            ):
                sheer = original._mix_color(
                    original.WHITE_SOFT,
                    palette["shade"],
                    0.18,
                )
                sheer_spans = (
                    ((opening_a, opening_b),)
                    if curtain_design == "layered sheers + drapes"
                    else (
                        (
                            opening_a,
                            opening_a + direction * template_width * 0.48,
                        ),
                        (
                            opening_b - direction * template_width * 0.48,
                            opening_b,
                        ),
                    )
                )
                for sheer_a, sheer_b in sheer_spans:
                    panel = original._pleated_curtain_panel(
                        sheer_a,
                        sheer_b,
                        curtain_bottom,
                        curtain_top,
                        sheer,
                        inward,
                        wall_offset + 0.065,
                        tint_strength=0.20,
                    )
                    if panel is not None:
                        meshes.append(panel)

            if curtain_design in (
                "linen drapes",
                "layered sheers + drapes",
            ):
                panel_width = max(
                    0.20,
                    template_width
                    * (
                        0.30
                        if curtain_design == "layered sheers + drapes"
                        else 0.25
                    ),
                )
                outer_offset = wall_offset + (
                    0.135
                    if curtain_design == "layered sheers + drapes"
                    else 0.10
                )
                for endpoint, sign in ((opening_a, 1), (opening_b, -1)):
                    panel_a = endpoint + direction * sign * 0.02
                    panel_b = endpoint + direction * sign * (
                        0.02 + panel_width
                    )
                    panel = original._pleated_curtain_panel(
                        panel_a,
                        panel_b,
                        curtain_bottom,
                        curtain_top,
                        drape,
                        inward,
                        outer_offset,
                        tint_strength=0.58,
                    )
                    if panel is not None:
                        meshes.append(panel)
    return meshes


def _build_room_trim_with_balconies(room_m, edges, palette, config=None):
    """Skip balcony thresholds and use the same curtains on every glazed opening."""
    replaced = []
    for edge in edges:
        openings = edge.get("openings", [])
        for index, opening in enumerate(openings):
            kind, start, end = opening
            if kind in ("balcony", "balcony_hole"):
                replaced.append((openings, index, opening))
                openings[index] = (
                    "door" if kind == "balcony" else "door_hole",
                    start,
                    end,
                )
    trim_config = dict(config or {})
    trim_config["curtain_design"] = "none"
    try:
        meshes = _ORIGINAL_BUILD_ROOM_TRIM(
            room_m,
            edges,
            palette,
            trim_config,
        )
    finally:
        for openings, index, opening in replaced:
            openings[index] = opening

    room_type = str((config or {}).get("room_type", "")).lower()
    if "kitchen" in room_type:
        # Kitchens never get fabric curtains on a window or balcony door: grease,
        # moisture and reach over a counter make them impractical, and they read
        # as unprofessional in a render. This is the authoritative curtain path
        # (the original trim call above is already forced to "none").
        curtain_design = "none"
    else:
        choices = original.room_design_choices(
            config,
            (config or {}).get("room_type", ""),
        )
        curtain_design = choices["curtain_design"]
    meshes.extend(
        _build_opening_curtains(
            room_m,
            edges,
            palette,
            curtain_design,
        )
    )
    return meshes


original.assign_openings = _assign_openings_with_balconies
original.get_palette = _professional_room_palette
original.build_walls = _build_walls_with_balconies
original.build_wall_finish_skins = _build_wall_finish_skins_with_balconies
original.build_room_design_surfaces = _professional_room_design_surfaces
original.build_room_trim = _build_room_trim_with_balconies
original._professional_detail = _professional_detail_with_supported_pillows
original.RoomFurnisher.__init__ = _room_furnisher_init_with_balconies
original.RoomFurnisher._place_floating_media = _place_floating_media_safely
original.RoomFurnisher.furnish_living = _furnish_aligned_living
original.RoomFurnisher.furnish_bedroom = _furnish_complete_bedroom
original.RoomFurnisher.furnish_dining = _furnish_complete_dining
original.RoomFurnisher.furnish_office = _furnish_complete_office
original.RoomFurnisher.furnish_bathroom = _furnish_aligned_bathroom
original.RoomFurnisher.furnish_kitchen = _furnish_designer_kitchen
original.RoomFurnisher.furnish = _furnish_complete_room


def scene_cache_key(payload: dict) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()[:24]


def interior_plan_source_version() -> str:
    """Invalidate exports whenever Interior_Plan logic or catalog assets change."""
    digest = hashlib.sha256()
    digest.update(Path(__file__).resolve().read_bytes())
    for filename in (
        "plan_walkthrough.py",
        "ai_designer.py",
        "furniture_catalog.py",
        "archviz_materials.py",
    ):
        path = INTERIOR_PLAN_ROOT / filename
        if path.is_file():
            digest.update(filename.encode())
            digest.update(path.read_bytes())
    asset_root = INTERIOR_PLAN_ROOT / "assets" / "furniture_catalog"
    if asset_root.is_dir():
        for path in sorted(item for item in asset_root.rglob("*") if item.is_file()):
            stat = path.stat()
            digest.update(path.relative_to(asset_root).as_posix().encode())
            digest.update(str(stat.st_size).encode())
            digest.update(str(stat.st_mtime_ns).encode())
    variations_path = Path(__file__).resolve().with_name("furniture_variations.py")
    if variations_path.is_file():
        digest.update(variations_path.read_bytes())
    return digest.hexdigest()[:16]


def _image_array(image):
    if image is None:
        return None
    pixels = np.asarray(image)
    if pixels.size == 0:
        return None
    if pixels.ndim == 2:
        pixels = np.repeat(pixels[:, :, None], 3, axis=2)
    pixels = np.ascontiguousarray(pixels[:, :, :3].astype(np.uint8))
    height, width = pixels.shape[:2]
    if max(width, height) > WEB_TEXTURE_MAX_SIZE:
        scale = WEB_TEXTURE_MAX_SIZE / max(width, height)
        resized = Image.fromarray(pixels, "RGB").resize(
            (max(1, round(width * scale)), max(1, round(height * scale))),
            Image.Resampling.LANCZOS,
        )
        pixels = np.ascontiguousarray(np.asarray(resized, dtype=np.uint8))
    return pixels


def _image_hash(pixels):
    if pixels is None:
        return ""
    digest = hashlib.blake2b(digest_size=12)
    digest.update(np.asarray(pixels.shape, dtype=np.int32).tobytes())
    digest.update(pixels.tobytes())
    return digest.hexdigest()


def _material_spec(mesh):
    record = material_record_for_mesh(mesh)
    color = np.clip(np.asarray(record.base_color, dtype=float), 0, 1)
    albedo = _image_array(getattr(record, "albedo_img", None))
    normal = _image_array(getattr(record, "normal_img", None))
    arm = _image_array(getattr(record, "ao_rough_metal_img", None))
    if arm is None:
        ao = _image_array(getattr(record, "ao_img", None))
        rough = _image_array(getattr(record, "roughness_img", None))
        if ao is not None or rough is not None:
            shape = (ao if ao is not None else rough).shape[:2]
            arm = np.empty((*shape, 3), dtype=np.uint8)
            arm[:, :, 0] = ao[:, :, 0] if ao is not None else 255
            arm[:, :, 1] = rough[:, :, 0] if rough is not None else int(float(record.base_roughness) * 255)
            arm[:, :, 2] = int(float(record.base_metallic) * 255)
    key = (
        tuple(np.round(color, 3)),
        round(float(record.base_roughness), 3),
        round(float(record.base_metallic), 3),
        _image_hash(albedo),
        _image_hash(normal),
        _image_hash(arm),
    )
    return key, {
        "color": color,
        "roughness": float(record.base_roughness),
        "metallic": float(record.base_metallic),
        "albedo": albedo,
        "normal": normal,
        "arm": arm,
    }


def _geometry_arrays(mesh):
    vertices = np.asarray(mesh.vertices, dtype=np.float32)
    faces = np.asarray(mesh.triangles, dtype=np.int64)
    if not len(vertices) or not len(faces):
        return None
    normals = np.asarray(mesh.vertex_normals, dtype=np.float32)
    if len(normals) != len(vertices):
        mesh.compute_vertex_normals()
        normals = np.asarray(mesh.vertex_normals, dtype=np.float32)
    # Interior_Plan is Z-up. glTF/Three is Y-up; this is a pure -90° X turn.
    vertices = vertices[:, [0, 2, 1]] * np.array([1, 1, -1], dtype=np.float32)
    normals = normals[:, [0, 2, 1]] * np.array([1, 1, -1], dtype=np.float32)
    uvs = np.asarray(mesh.triangle_uvs, dtype=np.float32)
    if len(uvs) == len(faces) * 3:
        # Open3D stores UVs per triangle corner. Expanding every corner into a
        # separate glTF vertex made otherwise modest walkthroughs tens of
        # megabytes larger. Re-index equal source-vertex/UV pairs instead:
        # seams remain exact, while repeated vertices are sent to the browser
        # only once.
        source_indices = faces.reshape(-1)
        quantized_uvs = np.rint(uvs * 1_000_000).astype(np.int64)
        vertex_uv_pairs = np.column_stack((source_indices, quantized_uvs))
        _unique_pairs, first_occurrence, compact_indices = np.unique(
            vertex_uv_pairs,
            axis=0,
            return_index=True,
            return_inverse=True,
        )
        vertices = vertices[source_indices[first_occurrence]]
        normals = normals[source_indices[first_occurrence]]
        compact_uvs = uvs[first_occurrence]
        faces = compact_indices.astype(np.int64).reshape((-1, 3))
        return vertices, faces, normals, compact_uvs
    return vertices, faces, normals, None


def _make_material(name, spec):
    color = np.rint(spec["color"] * 255).astype(np.uint8)
    kwargs = {
        "name": name,
        "baseColorFactor": color,
        "roughnessFactor": spec["roughness"],
        "metallicFactor": spec["metallic"],
        "doubleSided": True,
    }
    if spec["albedo"] is not None:
        kwargs["baseColorTexture"] = Image.fromarray(spec["albedo"], "RGB")
    if spec["normal"] is not None:
        kwargs["normalTexture"] = Image.fromarray(spec["normal"], "RGB")
    if spec["arm"] is not None:
        arm = Image.fromarray(spec["arm"], "RGB")
        kwargs["metallicRoughnessTexture"] = arm
        kwargs["occlusionTexture"] = arm
    return trimesh.visual.material.PBRMaterial(**kwargs)


def _combine(parts, material, name):
    vertices = []
    normals = []
    faces = []
    uvs = []
    offset = 0
    has_uv = all(part[3] is not None for part in parts)
    for part_vertices, part_faces, part_normals, part_uvs in parts:
        vertices.append(part_vertices)
        normals.append(part_normals)
        faces.append(part_faces + offset)
        if has_uv:
            uvs.append(part_uvs)
        offset += len(part_vertices)
    vertices = np.concatenate(vertices)
    normals = np.concatenate(normals)
    faces = np.concatenate(faces)
    visual = trimesh.visual.TextureVisuals(
        uv=np.concatenate(uvs) if has_uv else None,
        material=material,
    )
    return trimesh.Trimesh(
        vertices=vertices,
        faces=faces,
        vertex_normals=normals,
        visual=visual,
        process=False,
        validate=False,
        metadata={"name": name},
    )


def _is_ceiling_mesh(mesh) -> bool:
    """Identify removable ceiling/cap geometry without touching furniture."""
    vertices = np.asarray(mesh.vertices, dtype=float)
    if not len(vertices):
        return False
    minimum = float(vertices[:, 2].min())
    maximum = float(vertices[:, 2].max())
    return (
        minimum >= float(original.WALL_H) - 0.08
        and maximum <= float(original.WALL_H) + 0.10
    )


def _is_overhead_mesh(mesh) -> bool:
    """Identify fixed pendant/downlight geometry that should not block bird view."""
    vertices = np.asarray(mesh.vertices, dtype=float)
    if not len(vertices):
        return False
    minimum = float(vertices[:, 2].min())
    maximum = float(vertices[:, 2].max())
    return (
        minimum >= float(original.WALL_H) - 0.95
        and maximum <= float(original.WALL_H) + 0.10
    )


def _is_door_threshold(mesh) -> bool:
    """Recognize Interior_Plan's temporary doorway bridge strips."""
    vertices = np.asarray(mesh.vertices, dtype=float)
    if not len(vertices):
        return False
    extents = np.ptp(vertices, axis=0)
    horizontal = sorted((float(extents[0]), float(extents[1])))
    return (
        0.008 <= float(extents[2]) <= 0.018
        and 0.62 <= horizontal[0] <= 1.15
        and 1.05 <= horizontal[1] <= 6.5
        and float(vertices[:, 2].min()) >= -0.002
        and float(vertices[:, 2].max()) <= 0.018
    )


def _carve_balcony_openings(mesh, balcony_segments):
    """Raise legacy door cuts to full-height, clear balcony passages."""
    if not balcony_segments:
        return
    vertices = np.asarray(mesh.vertices, dtype=float)
    faces = np.asarray(mesh.triangles, dtype=np.int64)
    if not len(vertices) or not len(faces):
        return
    vertical_span = float(np.ptp(vertices[:, 2]))
    if vertical_span < 0.08 or float(vertices[:, 2].min()) >= BALCONY_OPENING_HEIGHT:
        return

    centroids = vertices[faces].mean(axis=1)
    remove = np.zeros(len(faces), dtype=bool)
    for start, end in balcony_segments:
        start = np.asarray(start, dtype=float)
        end = np.asarray(end, dtype=float)
        segment = end - start
        length_sq = float(np.dot(segment, segment))
        if length_sq < 1e-8:
            continue
        relative = centroids[:, :2] - start
        position = np.clip((relative @ segment) / length_sq, 0.0, 1.0)
        nearest = start + position[:, None] * segment
        distance = np.linalg.norm(centroids[:, :2] - nearest, axis=1)
        remove |= (
            (distance <= max(float(original.WALL_THICKNESS) * 1.8, 0.18))
            & (centroids[:, 2] < BALCONY_OPENING_HEIGHT - 0.002)
        )
    if not remove.any():
        return

    triangle_uvs = np.asarray(mesh.triangle_uvs, dtype=float)
    keep = ~remove
    mesh.triangles = original.o3d.utility.Vector3iVector(faces[keep])
    if len(triangle_uvs) == len(faces) * 3:
        kept_uvs = triangle_uvs.reshape((-1, 3, 2))[keep].reshape((-1, 2))
        mesh.triangle_uvs = original.o3d.utility.Vector2dVector(kept_uvs)
    mesh.remove_unreferenced_vertices()
    mesh.compute_vertex_normals()


def _is_curtain_fabric(mesh):
    """Recognize mapped curtain textiles so wall carving never deletes them."""
    registered = getattr(archviz_materials, "_MESH_MATERIALS", {}).get(id(mesh))
    return bool(
        registered is not None
        and registered[0] is mesh
        and registered[1] == "curtain_fabric"
    )


def _refine_door_threshold(mesh):
    """Turn the oversized brown bridge into a slim, flush timber transition."""
    vertices = np.asarray(mesh.vertices, dtype=float).copy()
    xy = vertices[:, :2]
    centre = xy.mean(axis=0)
    centred = xy - centre
    _values, axes = np.linalg.eigh(np.cov(centred.T))
    local = centred @ axes
    spans = np.ptp(local, axis=0)
    major = int(np.argmax(spans))
    minor = 1 - major
    target_major = max(1.02, float(spans[major]) - 0.26)
    target_minor = min(0.26, float(spans[minor]))
    if spans[major] > 1e-6:
        local[:, major] *= target_major / spans[major]
    if spans[minor] > 1e-6:
        local[:, minor] *= target_minor / spans[minor]
    vertices[:, :2] = local @ axes.T + centre
    vertices[:, 2] = np.interp(
        vertices[:, 2],
        [float(vertices[:, 2].min()), float(vertices[:, 2].max())],
        [0.001, 0.004],
    )
    mesh.vertices = original.o3d.utility.Vector3dVector(vertices)
    mesh.compute_vertex_normals()
    apply_archviz_material(
        mesh,
        "warm_oak",
        tint=[0.56, 0.41, 0.27],
        tint_strength=0.34,
        repeat_m=0.72,
    )


def _wardrobe_finish(spec):
    """Use one quiet cabinet finish across wardrobe doors, carcass and sides."""
    if float(spec.get("metallic", 0.0)) > 0.28:
        return spec
    return {
        **spec,
        "color": np.asarray([0.72, 0.69, 0.62, 1.0], dtype=float),
        "roughness": 0.58,
        "metallic": 0.0,
        "albedo": None,
        "normal": None,
        "arm": None,
    }


def plan_kitchen_openings(rooms, doors, configs, pixels_per_meter=None):
    """Preserve every user-drawn doorway exactly as authored.

    Kitchen type controls cabinetry, islands/peninsulas and the appliance work
    triangle. It must never infer a different wall opening: the floor-plan
    editor already captures the user's intended doorway location and width.
    This function now provides metadata only and deliberately returns the door
    geometry unchanged for realtime, CPU and exact walkthroughs.
    """
    planned = [list(item) for item in (doors or [])]
    if not rooms:
        return planned, []
    source_scale = (
        float(pixels_per_meter)
        if pixels_per_meter
        else float(original.estimate_px_per_m(rooms, doors or []))
    )
    geometry_scale = source_scale / float(original.SCALE_BOOST)
    tolerance = max(4.0, geometry_scale * 0.42)
    summaries = []
    for kitchen_index, config in enumerate(configs or []):
        if kitchen_index >= len(rooms):
            break
        if "kitchen" not in str(config.get("room_type", "")).lower():
            continue
        kitchen_key = _kitchen_type_key(config.get("kitchen_type"))
        rule = KITCHEN_TYPE_RULES[kitchen_key]
        room_polygon = original.Polygon(
            [tuple(np.asarray(point, dtype=float)) for point in rooms[kitchen_index]]
        ).buffer(0)
        boundary = room_polygon.boundary
        authored_openings = []
        for door_index, item in enumerate(planned):
            if len(item) < 2:
                continue
            door_line = original.LineString(
                [np.asarray(item[0], dtype=float), np.asarray(item[1], dtype=float)]
            )
            if boundary.distance(door_line) <= tolerance:
                authored_openings.append(
                    {
                        "doorIndex": door_index,
                        "width": round(
                            float(door_line.length) / max(geometry_scale, 1e-9),
                            3,
                        ),
                    }
                )
        summary = {
            "roomIndex": kitchen_index,
            "type": kitchen_key,
            "cabinetPlan": rule["cabinet_plan"],
            "opening": "user-drawn" if authored_openings else "none-drawn",
            "requestedOpeningCharacter": rule["opening"],
            "authoredOpenings": authored_openings,
        }
        summaries.append(summary)
    return planned, summaries


def build_realtime_scene(output_path: Path, rooms, doors, windows, balconies, configs, pixels_per_meter):
    measured_pixels_per_meter = (
        float(pixels_per_meter)
        if pixels_per_meter
        else original.estimate_px_per_m(rooms, doors)
    )
    scene_pixels_per_meter = measured_pixels_per_meter / WEB_SPATIAL_BOOST
    scene_doors, kitchen_plans = plan_kitchen_openings(
        rooms,
        doors,
        configs,
        scene_pixels_per_meter,
    )
    balcony_scale = scene_pixels_per_meter / original.SCALE_BOOST
    normalized_balconies = _normalize_balcony_door_segments(
        balconies,
        balcony_scale,
    )
    with balcony_opening_context(
        normalized_balconies,
        scene_pixels_per_meter,
        rooms=rooms,
        doors=scene_doors,
        configs=configs,
    ):
        scene_data = original.build_scene(
            rooms,
            scene_doors,
            windows,
            px_per_m=scene_pixels_per_meter,
            room_configs=configs,
            furnished=True,
        )
    scale = scene_pixels_per_meter / original.SCALE_BOOST
    room_shapes = []
    room_polygons = []
    for room in rooms:
        world = [original.px_to_m_real(point, scale) for point in room]
        polygon = original.Polygon([(point[0], point[1]) for point in world]).buffer(0)
        room_shapes.append(polygon)
        room_polygons.append([[float(x), float(-y)] for x, y in polygon.exterior.coords])
    balcony_segments = [
        (
            np.asarray(original.px_to_m_real(item[0], scale), dtype=float),
            np.asarray(original.px_to_m_real(item[1], scale), dtype=float),
        )
        for item in normalized_balconies
        if len(item) >= 2
    ]

    def room_index_for_point(x, y):
        point = original.Point(float(x), float(y))
        containing = [index for index, polygon in enumerate(room_shapes) if polygon.buffer(0.03).covers(point)]
        if containing:
            return containing[0]
        return min(range(len(room_shapes)), key=lambda index: room_shapes[index].distance(point))

    object_by_mesh = {}
    asset_by_mesh = {}
    furniture = []
    for index, item in enumerate(scene_data.get("furniture_objects", [])):
        for mesh in item["meshes"]:
            object_by_mesh[id(mesh)] = index
            asset_by_mesh[id(mesh)] = item["asset_key"]
        furniture.append({
            "index": index,
            "label": item["asset_key"].replace("_", " ").title(),
            "nodePrefix": f"furniture_{index:03d}_",
            "pivot": [float(item["position"][0]), 0.0, float(-item["position"][1])],
            "roomIndex": room_index_for_point(item["position"][0], item["position"][1]),
            "yaw": float(item.get("yaw", 0.0)),
            "width": float(item.get("width", 0.0)),
            "depth": float(item.get("depth", 0.0)),
        })

    groups = defaultdict(list)
    specs = {}
    for mesh_index, mesh in enumerate(scene_data["meshes"]):
        object_index = object_by_mesh.get(id(mesh))
        if object_index is None and not _is_curtain_fabric(mesh):
            _carve_balcony_openings(mesh, balcony_segments)
        if object_index is None and _is_door_threshold(mesh):
            _refine_door_threshold(mesh)
        arrays = _geometry_arrays(mesh)
        if arrays is None:
            continue
        material_key, spec = _material_spec(mesh)
        if str(asset_by_mesh.get(id(mesh), "")).endswith("wardrobe"):
            spec = _wardrobe_finish(spec)
            material_key = (
                "wardrobe_unified_finish",
                round(float(spec["roughness"]), 3),
                round(float(spec["metallic"]), 3),
            )
        if object_index is not None:
            owner = f"furniture_{object_index:03d}"
        elif _is_ceiling_mesh(mesh):
            owner = "ceiling"
        elif _is_overhead_mesh(mesh):
            owner = "overhead"
        else:
            # Keep architectural pieces individually addressable in the browser.
            # The walkthrough can then hide only the camera-facing fourth wall
            # instead of clipping the room, floor, and furniture as one volume.
            owner = f"architecture_{mesh_index:04d}"
        group_key = (owner, material_key)
        groups[group_key].append(arrays)
        specs[material_key] = spec

    export_scene = trimesh.Scene()
    for group_index, ((owner, material_key), parts) in enumerate(groups.items()):
        node_name = f"{owner}_material_{group_index:03d}"
        material = _make_material(f"livinai_{group_index:03d}", specs[material_key])
        export_scene.add_geometry(
            _combine(parts, material, node_name),
            node_name=node_name,
            geom_name=node_name,
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = output_path.with_suffix(".building.glb")
    temporary.write_bytes(export_scene.export(file_type="glb"))
    temporary.replace(output_path)

    spawn = np.asarray(scene_data["spawn"], dtype=float)
    room_centers = []
    for polygon in room_shapes:
        point = polygon.representative_point()
        room_centers.append([float(point.x), original.EYE_HEIGHT, float(-point.y)])

    def opening_record(item, opening_type):
        a = original.px_to_m_real(item[0], scale)
        b = original.px_to_m_real(item[1], scale)
        midpoint = original.Point((float(a[0]) + float(b[0])) / 2, (float(a[1]) + float(b[1])) / 2)
        nearest = sorted(
            range(len(room_shapes)),
            key=lambda index: room_shapes[index].boundary.distance(midpoint),
        )
        room_indices = [
            index for index in nearest
            if room_shapes[index].boundary.distance(midpoint) <= 0.38
        ][:2]
        if not room_indices and nearest:
            room_indices = [nearest[0]]
        return {
            "type": opening_type,
            "points": [
                [float(a[0]), float(-a[1])],
                [float(b[0]), float(-b[1])],
            ],
            "roomIndices": room_indices,
        }

    openings = [opening_record(item, "door") for item in scene_doors]
    openings.extend(opening_record(item, "window") for item in windows)
    openings.extend(opening_record(item, "balcony") for item in (balconies or []))
    walkable = []
    allowed = scene_data["allowed"]
    polygons = list(allowed.geoms) if hasattr(allowed, "geoms") else [allowed]
    for polygon in polygons:
        walkable.append([[float(x), float(-y)] for x, y in polygon.exterior.coords])
    return {
        "layoutStandard": "residential-clearance-v2-kitchen-triangle",
        "kitchenPlans": kitchen_plans,
        "meshes": len(scene_data["meshes"]),
        "drawCalls": len(groups),
        "walkableArea": float(allowed.area),
        "spawn": [float(spawn[0]), original.EYE_HEIGHT, float(-spawn[1])],
        "spawnYaw": float(scene_data.get("spawn_yaw", 0.0) - math.pi / 2),
        "roomCenters": room_centers,
        "roomPolygons": room_polygons,
        "openings": openings,
        "walkable": walkable,
        "furniture": furniture,
    }
