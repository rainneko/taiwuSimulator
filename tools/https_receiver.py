#!/usr/bin/env python3
"""HTTPS server that receives wiki data POSTed from the browser and saves to disk."""
import json, os, re, ssl, sys
from http.server import HTTPServer, BaseHTTPRequestHandler

BASE = "/Users/Rainy/PycharmProjects/taiwuSimulator/data/wiki"
for d in ["raw/wikitext","raw/html","text","templates","modules","data_ns","meta"]:
    os.makedirs(os.path.join(BASE, d), exist_ok=True)

progress = {"saved": 0, "errors": 0}

def safe_filename(title):
    name = title.replace("/", "__").replace(":", "_")
    return re.sub(r'[<>"|?*\\]', '_', name)

class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_GET(self):
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(progress).encode())

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        try:
            pages = json.loads(body)
            for p in pages:
                title = p.get("title","")
                fn = safe_filename(title)
                wt = p.get("wikitext")

                if title.startswith("模板:") or title.startswith("Template:"):
                    d = os.path.join(BASE, "templates")
                elif title.startswith("模块:") or title.startswith("Module:"):
                    d = os.path.join(BASE, "modules")
                elif title.startswith("Data:"):
                    d = os.path.join(BASE, "data_ns")
                else:
                    d = os.path.join(BASE, "raw", "wikitext")

                if wt is not None:
                    with open(os.path.join(d, fn + ".wiki"), "w", encoding="utf-8") as f:
                        f.write(wt)

                meta = {k: p[k] for k in ["title","pageid","revid","timestamp","redirect","redirectTarget","categories","templates","images"] if k in p}
                with open(os.path.join(BASE, "meta", fn + ".json"), "w", encoding="utf-8") as f:
                    json.dump(meta, f, ensure_ascii=False, indent=1)

                progress["saved"] += 1

            self._ok({"saved": len(pages), "total": progress["saved"]})
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
        if progress["saved"] % 1000 == 0 or progress["saved"] < 10:
            sys.stderr.write(f"[receiver] saved={progress['saved']}\n")

if __name__ == "__main__":
    port = 8766
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain('/tmp/localhost.crt', '/tmp/localhost.key')
    server = HTTPServer(("127.0.0.1", port), Handler)
    server.socket = ctx.wrap_socket(server.socket, server_side=True)
    print(f"HTTPS receiver on https://127.0.0.1:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    print(f"\nFinal: saved={progress['saved']} errors={progress['errors']}", flush=True)
