"""Download Poly Haven's furniture catalogue into the local renderer assets.

Poly Haven publishes everything under CC0, which is the only licence class this
app can actually use: the walkthrough serves its GLB to a WebView, so the
geometry is downloadable by anyone, and the royalty-free licences the 3D
marketplaces sell explicitly forbid shipping a model in a form users can extract.

The set is fetched *by category* rather than from a hand-written list, so what
lands on disk is reproducible — re-running gives the same catalogue, plus
anything Poly Haven has published since. `furniture_catalog.py` then builds one
kit per design style out of it; a kit can only be as distinct as the models
available to it, which is why the whole category is pulled rather than a subset.

Each asset is fetched at 1k glTF, matching the entries already in `pro/`, and
laid out the way the loader expects:

    pro/<asset_id>/<asset_id>_1k.gltf
    pro/<asset_id>/<asset_id>.bin
    pro/<asset_id>/textures/*.jpg

Run from the repository root. Anything already on disk is skipped, so this is
safe to re-run and cheap when it has nothing to do.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

API = "https://api.polyhaven.com"
CATALOG = Path("backend/renderer/engine/interior_plan/assets/furniture_catalog/pro")

# Poly Haven's CDN answers 403 to urllib's default agent.
HEADERS = {"User-Agent": "Livinai-catalog-fetch/1.0 (+https://polyhaven.com/license)"}


def open_url(url: str, timeout: int):
    return urllib.request.urlopen(
        urllib.request.Request(url, headers=HEADERS), timeout=timeout
    )


def get_json(url: str):
    with open_url(url, 90) as response:
        return json.load(response)


def download(url: str, target: Path) -> int:
    target.parent.mkdir(parents=True, exist_ok=True)
    with open_url(url, 180) as response:
        data = response.read()
    target.write_bytes(data)
    return len(data)


def wanted_ids() -> list[str]:
    """Every model Poly Haven files under `furniture`."""
    return sorted(get_json(f"{API}/assets?t=models&c=furniture"))


def fetch(asset_id: str) -> tuple[str, int]:
    """Pull one asset's 1k glTF and every file it includes."""
    folder = CATALOG / asset_id
    primary = folder / f"{asset_id}_1k.gltf"
    if primary.is_file():
        return "skipped", 0

    files = get_json(f"{API}/files/{asset_id}")
    gltf = files.get("gltf", {}).get("1k", {}).get("gltf")
    if not gltf or not gltf.get("url"):
        return "no 1k glTF", 0

    total = download(gltf["url"], primary)
    for relative, spec in (gltf.get("include") or {}).items():
        if spec.get("url"):
            total += download(spec["url"], folder / relative)
    return "ok", total


def verify() -> list[str]:
    """Assets whose glTF points at a buffer or texture that is not on disk."""
    broken = []
    for folder in sorted(p for p in CATALOG.iterdir() if p.is_dir()):
        models = list(folder.glob("*_1k.gltf"))
        if not models:
            continue
        document = json.loads(models[0].read_text(encoding="utf-8"))
        parts = document.get("buffers", []) + document.get("images", [])
        for part in parts:
            uri = part.get("uri")
            if uri and not (folder / uri).is_file():
                broken.append(f"{folder.name}: missing {uri}")
    return broken


def main() -> int:
    if not CATALOG.parent.is_dir():
        print(f"catalogue not found: {CATALOG}", file=sys.stderr)
        print("Run this from the repository root.", file=sys.stderr)
        return 1

    ids = wanted_ids()
    print(f"Poly Haven furniture category: {len(ids)} models")

    total, fetched, failures = 0, 0, []
    for asset_id in ids:
        try:
            status, size = fetch(asset_id)
        except (urllib.error.URLError, urllib.error.HTTPError, OSError) as error:
            status, size = f"FAILED ({error})", 0
            failures.append(asset_id)
        if size:
            fetched += 1
        total += size
        note = f"{size / 1024:,.0f} KB" if size else status
        print(f"  {asset_id:<34} {note}")

    print(f"\nfetched {fetched} new, {total / 1024 / 1024:.1f} MB")
    broken = verify()
    print("incomplete assets:", "; ".join(broken) if broken else "none")
    if failures:
        print("failed:", ", ".join(failures))
    return 1 if failures or broken else 0


if __name__ == "__main__":
    raise SystemExit(main())
