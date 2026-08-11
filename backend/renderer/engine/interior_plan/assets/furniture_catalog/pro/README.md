# Professional local catalog

This directory contains an offline 1K glTF furniture and decoration set
downloaded from [Poly Haven](https://polyhaven.com/).

It holds **every model in Poly Haven's furniture category** — all 85 — plus the
lighting, plant, mirror, art and styling pieces the walkthrough stages rooms
with. The full category is here on purpose: `furniture_catalog.py` builds one
kit per design style, and a kit can only be as distinct as the models available
to it. A handful of the 85 are outdoor or institutional pieces (picnic table,
fire pit, street seating, school desk) that no interior kit references; they are
kept so the set stays complete and re-runnable rather than a hand-pruned subset
nobody can reproduce.

Re-download or extend the set with `scripts/fetch_polyhaven_catalog.py`.

Included categories:

- sofas, armchairs, coffee tables, cabinets, a bed, and nightstands
- dining table and chair, desk, console, and display shelves
- framed art, ornate mirror, wall clock, wall sconce, and ceiling light
- potted plant, throw pillows, and ceramic décor

Every asset remains real textured 3D geometry with its original mesh and
material dependencies. The application converts its PBR color detail to
vertex material detail for the local Open3D walkthrough, then applies only a
restrained tint to coordinate it with the user's design palette.

Poly Haven asset pages and license:

- https://polyhaven.com/
- https://polyhaven.com/license

All assets in this folder are published by Poly Haven under CC0.
