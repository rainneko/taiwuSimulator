#!/usr/bin/env python3
"""Local HTTP server that receives wiki data POSTed from the browser and saves to disk."""
import json, os, re, sys, signal
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import unquote

BASE = "/Users/Rainy/PycharmProjects/taiwuSimulator/data/wiki"
DIRS = {
    "wikitext":  os.path.join(BASE, "raw", "wikitext"),
    "html":      os.path.join(BASE, "raw", "html"),
    "text":      os.path.join(BASE, "text"),
    "templates": os.path.join(BASE, "templates"),
    "modules":   os.path.join(BASE, "modules"),
    "data_ns":   os.path.join(BASE, "data_ns"),
}
for d in DIRS.values():
    os.makedirs(d, exist_ok=True)
os.makedirs(os.path.join(BASE, "import"), exist_ok=True)

# Progress tracking
progress = {"saved": 0, "errors": 0, "pages_total": 0, "pages_done": set()}
progress_file = os.path.join(BASE, "crawl_progress.json")

def safe_filename(title):
    """Convert a wiki title to a safe filename."""
    name = title.replace("/", "__").replace(":", "_")
    name = re.sub(r'[<>"|?*\\]', '_', name)
    return name

class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self, *a):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_GET(self, *a):
        # Status endpoint
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        status = {
            "saved": progress["saved"],
            "errors": progress["errors"],
            "pages_total": progress["pages_total"],
            "pages_done": len(progress["pages_done"]),
        }
        self.wfile.write(json.dumps(status).encode())

    def do_POST(self, *a):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        try:
            payload = json.loads(body)
            action = payload.get("action", "save_batch")

            if action == "set_total":
                progress["pages_total"] = payload["total"]
                self._ok({"status": "ok"})
                return

            if action == "save_batch":
                pages = payload.get("pages", [])
                for p in pages:
                    title = p["title"]
                    fn = safe_filename(title)

                    # Determine directory based on namespace
                    if title.startswith("Template:") or title.startswith("模板:"):
                        d = DIRS["templates"]
                    elif title.startswith("Module:") or title.startswith("模块:"):
                        d = DIRS["modules"]
                    elif title.startswith("Data:"):
                        d = DIRS["data_ns"]
                    else:
                        d = DIRS["wikitext"]

                    # Save wikitext
                    if "wikitext" in p and p["wikitext"] is not None:
                        with open(os.path.join(d, fn + ".wiki"), "w", encoding="utf-8") as f:
                            f.write(p["wikitext"])

                    # Save HTML if present
                    if "html" in p and p["html"]:
                        with open(os.path.join(DIRS["html"], fn + ".html"), "w", encoding="utf-8") as f:
                            f.write(p["html"])

                    # Save metadata
                    if "meta" in p:
                        meta_dir = os.path.join(BASE, "meta")
                        os.makedirs(meta_dir, exist_ok=True)
                        with open(os.path.join(meta_dir, fn + ".json"), "w", encoding="utf-8") as f:
                            json.dump(p["meta"], f, ensure_ascii=False, indent=1)

                    progress["pages_done"].add(title)
                    progress["saved"] += 1

                self._ok({"status": "ok", "saved": len(pages), "total_saved": progress["saved"]})
                return

            if action == "save_index":
                with open(os.path.join(BASE, "index.json"), "w", encoding="utf-8") as f:
                    json.dump(payload["data"], f, ensure_ascii=False, indent=1)
                self._ok({"status": "ok"})
                return

            if action == "save_images_manifest":
                with open(os.path.join(BASE, "images_manifest.json"), "w", encoding="utf-8") as f:
                    json.dump(payload["data"], f, ensure_ascii=False, indent=1)
                self._ok({"status": "ok"})
                return

            self._ok({"status": "unknown_action"})

        except Exception as e:
            progress["errors"] += 1
            self.send_response(500)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _ok(self, data):
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def log_message(self, fmt, *args):
        # Quieter logging - only errors and milestones
        msg = fmt % args
        if "POST" in msg:
            if progress["saved"] % 500 == 0 or progress["saved"] < 10:
                sys.stderr.write(f"[receiver] saved={progress['saved']} errors={progress['errors']}\n")

if __name__ == "__main__":
    port = 8765
    server = HTTPServer(("127.0.0.1", port), Handler)
    print(f"Wiki receiver listening on http://127.0.0.1:{port}", flush=True)
    print(f"Saving to {BASE}", flush=True)
    signal.signal(signal.SIGTERM, lambda *a: sys.exit(0))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    print(f"\nFinal: saved={progress['saved']} errors={progress['errors']}", flush=True)
