#!/usr/bin/env python3
"""List every Spine skeleton and animation in a Unity game folder that you own.

Purpose: private study of the Scroll of Taiwu combat figures ("小黑人").
Do not share the exported files.

Usage:
    pip install UnityPy
    python taiwu_spine_inventory.py "<game folder>/<Game>_Data" out
    python taiwu_spine_inventory.py "<game folder>/<Game>_Data" out --export

Output (in the folder "out"):
    animations.csv        one row per Spine animation: source file, skeleton, Spine version,
                          animation name, duration in seconds, name prefix, event names
    skeletons.csv         one row per skeleton, atlas or binary skeleton that was found
    skill_animations.csv  rows of CSV-like data tables (for example the old GongFa_Date table)
                          whose cells hold animation names such as S_70709
    export/               with --export: the skeleton .json/.skel, the .atlas text and the
                          atlas PNG pages
"""
import argparse
import collections
import csv
import io
import json
import os
import re
import sys

ANIM_NAME = re.compile(r"^[A-Z]{1,2}_\d+$")
VERSION_IN_BINARY = re.compile(rb"([234]\.\d{1,2}\.\d{1,3})")
ATLAS_PAGE = re.compile(r"^(\S[^\r\n]*\.png)\s*$", re.MULTILINE)


def text_of(ta):
    """Return the bytes of a TextAsset (UnityPy keeps them as a surrogate-escaped str)."""
    value = getattr(ta, "m_Script", None)
    if isinstance(value, str):
        return value.encode("utf-8", "surrogateescape")
    if isinstance(value, (bytes, bytearray, memoryview)):
        return bytes(value)
    value = getattr(ta, "script", b"")
    return bytes(value) if value else b""


def max_time(node):
    """The largest "time" value in a Spine animation: its length in seconds."""
    best = 0.0
    if isinstance(node, dict):
        t = node.get("time")
        if isinstance(t, (int, float)):
            best = float(t)
        for v in node.values():
            best = max(best, max_time(v))
    elif isinstance(node, list):
        for v in node:
            best = max(best, max_time(v))
    return best


def spine_json(raw):
    """Parse Spine skeleton JSON, or return None."""
    head = raw[:4096].lstrip(b"\xef\xbb\xbf \t\r\n")
    if not head.startswith(b"{") or b'"skeleton"' not in raw[:8192]:
        return None
    try:
        data = json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, ValueError):
        return None
    if not isinstance(data, dict) or "bones" not in data:
        return None
    return data


def atlas_pages(raw):
    """Page file names of a Spine atlas, or an empty list."""
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return []
    if "size:" not in text or "filter:" not in text:
        return []
    return ATLAS_PAGE.findall(text)


def binary_version(raw, name):
    """Spine version of a binary skeleton (.skel), or None."""
    if b"\x00" not in raw[:256] and not name.lower().endswith(("skel", ".skel.bytes")):
        return None
    m = VERSION_IN_BINARY.search(raw[:96])
    return m.group(1).decode() if m else None


def table_links(raw, table):
    """Cells that hold animation names in a CSV-like table whose first line starts with '#,'."""
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return []
    if not text.startswith("#,"):
        return []
    rows = list(csv.reader(io.StringIO(text)))
    header = rows[0]
    name_col = header.index("0") if "0" in header else 1
    links = []
    for row in rows[1:]:
        for key, cell in zip(header, row):
            if ANIM_NAME.match(cell.strip()):
                name = row[name_col] if name_col < len(row) else ""
                links.append((table, row[0], name, key, cell.strip()))
    return links


def scan(data_dir, out_dir, export):
    import UnityPy  # imported here so the parsing helpers can be tested without it

    env = UnityPy.load(data_dir)
    textures = {}
    anim_rows, skel_rows, link_rows = [], [], []
    wanted_pages = set()
    export_dir = os.path.join(out_dir, "export")
    if export:
        os.makedirs(export_dir, exist_ok=True)

    for obj in env.objects:
        kind = obj.type.name
        if kind == "Texture2D":
            textures.setdefault(obj.peek_name() if hasattr(obj, "peek_name") else None, []).append(obj)
            continue
        if kind != "TextAsset":
            continue
        ta = obj.read()
        name = getattr(ta, "m_Name", "") or ""
        raw = text_of(ta)
        source = os.path.basename(getattr(obj.assets_file, "name", "") or "")

        data = spine_json(raw)
        if data is not None:
            version = str(data.get("skeleton", {}).get("spine", "?"))
            animations = data.get("animations", {}) or {}
            skel_rows.append((source, name, "json", version, len(animations)))
            for anim, body in animations.items():
                events = sorted({e.get("name", "") for e in body.get("events", []) if isinstance(e, dict)})
                prefix = anim.split("_", 1)[0] if "_" in anim else ""
                anim_rows.append((source, name, version, anim, round(max_time(body), 4), prefix, " ".join(events)))
            if export:
                with open(os.path.join(export_dir, safe(name) + ".json"), "wb") as f:
                    f.write(raw)
            continue

        pages = atlas_pages(raw)
        if pages:
            skel_rows.append((source, name, "atlas", "", len(pages)))
            wanted_pages.update(os.path.splitext(p)[0] for p in pages)
            if export:
                stem = safe(name)
                stem = stem if stem.endswith(".atlas") else stem + ".atlas"
                with open(os.path.join(export_dir, stem), "wb") as f:
                    f.write(raw)
            continue

        version = binary_version(raw, name)
        if version:
            skel_rows.append((source, name, "binary", version, ""))
            if export:
                stem = safe(name)
                stem = stem if stem.endswith(".skel") else stem + ".skel"
                with open(os.path.join(export_dir, stem), "wb") as f:
                    f.write(raw)
            continue

        link_rows.extend(table_links(raw, name))

    if export:
        for page in sorted(wanted_pages):
            for obj in textures.get(page, []):
                tex = obj.read()
                tex.image.save(os.path.join(export_dir, safe(page) + ".png"))
                break

    write_csv(os.path.join(out_dir, "animations.csv"),
              ("source_file", "skeleton", "spine_version", "animation", "duration_s", "prefix", "events"), anim_rows)
    write_csv(os.path.join(out_dir, "skeletons.csv"),
              ("source_file", "asset", "kind", "spine_version", "animations_or_pages"), skel_rows)
    write_csv(os.path.join(out_dir, "skill_animations.csv"),
              ("table", "row_id", "row_name", "column_key", "animation"), link_rows)
    return anim_rows, skel_rows, link_rows


def safe(name):
    return re.sub(r"[^\w.\-]+", "_", name) or "unnamed"


def write_csv(path, header, rows):
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("data_dir", help="the game's <Game>_Data folder")
    p.add_argument("out_dir", help="folder for the CSV files (created if missing)")
    p.add_argument("--export", action="store_true", help="also save the Spine files and atlas PNGs")
    a = p.parse_args(argv)
    os.makedirs(a.out_dir, exist_ok=True)
    anims, skels, links = scan(a.data_dir, a.out_dir, a.export)
    prefixes = collections.Counter(r[5] for r in anims)
    versions = collections.Counter(r[3] for r in skels if r[2] in ("json", "binary"))
    print(f"skeleton data: {sum(1 for s in skels if s[2] in ('json', 'binary'))}, atlases: {sum(1 for s in skels if s[2] == 'atlas')}")
    print(f"animations listed: {len(anims)}  by prefix: {dict(prefixes)}  Spine versions: {dict(versions)}")
    print(f"table cells naming an animation: {len(links)}")
    if any(s[2] == "binary" for s in skels):
        print("Binary skeletons were found: open them in Spine's Skeleton Viewer of the same version to list their animations.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
