#!/usr/bin/env python3
"""Read a JSON chunk from stdin and save each page to the right directory."""
import json, os, re, sys

BASE = "/Users/Rainy/PycharmProjects/taiwuSimulator/data/wiki"
DIRS = {
    "wikitext":  os.path.join(BASE, "raw", "wikitext"),
    "html":      os.path.join(BASE, "raw", "html"),
    "text":      os.path.join(BASE, "text"),
    "templates": os.path.join(BASE, "templates"),
    "modules":   os.path.join(BASE, "modules"),
    "data_ns":   os.path.join(BASE, "data_ns"),
    "meta":      os.path.join(BASE, "meta"),
}
for d in DIRS.values():
    os.makedirs(d, exist_ok=True)

def safe_filename(title):
    name = title.replace("/", "__").replace(":", "_")
    name = re.sub(r'[<>"|?*\\]', '_', name)
    return name

data = json.load(sys.stdin)
saved = 0
errors = 0
for p in data:
    if "error" in p:
        print(f"ERROR: {p['error']} for {p.get('batch','?')}", file=sys.stderr)
        errors += 1
        continue
    title = p["t"]
    fn = safe_filename(title)

    # Determine directory
    if title.startswith("Template:") or title.startswith("模板:"):
        d = DIRS["templates"]
    elif title.startswith("Module:") or title.startswith("模块:"):
        d = DIRS["modules"]
    elif title.startswith("Data:"):
        d = DIRS["data_ns"]
    else:
        d = DIRS["wikitext"]

    # Save wikitext
    if p.get("wt") is not None:
        with open(os.path.join(d, fn + ".wiki"), "w", encoding="utf-8") as f:
            f.write(p["wt"])

    # Save metadata
    meta = {
        "title": title,
        "pageid": p.get("id"),
        "revid": p.get("rid"),
        "timestamp": p.get("ts"),
        "redirect": p.get("redir", False),
        "categories": p.get("cats", []),
        "templates": p.get("tpls", []),
        "images": p.get("imgs", []),
    }
    with open(os.path.join(DIRS["meta"], fn + ".json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)

    saved += 1

print(json.dumps({"saved": saved, "errors": errors}))
