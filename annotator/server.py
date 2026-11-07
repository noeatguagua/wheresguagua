"""本機標記工具伺服器（內部使用，與正式 demo 分開）。

- 只綁 127.0.0.1:8766，不對外開放
- 靜態檔：annotator/ 資料夾；唯讀參考資料 /data.js 對應到 ../app/data.js
- 標記資料：../data/annotations.json（每次儲存前先備份到 ../data/annotations_backup/）
usage: python server.py
"""
import http.server, json, os, shutil, time

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.normpath(os.path.join(ROOT, '..', 'data'))
ANNO = os.path.join(DATA_DIR, 'annotations.json')
BACKUP = os.path.join(DATA_DIR, 'annotations_backup')
REF = os.path.normpath(os.path.join(ROOT, '..', 'app', 'data.js'))
PORT = 8766
os.makedirs(BACKUP, exist_ok=True)


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')  # 標記工具頁面一律不快取，避免用到舊版
        super().end_headers()

    def _send(self, code, body, ctype='application/json; charset=utf-8'):
        b = body if isinstance(body, bytes) else body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(b)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path.startswith('/data.js'):
            return self._send(200, open(REF, 'rb').read(), 'application/javascript; charset=utf-8')
        if self.path.startswith('/api/annotations'):
            body = open(ANNO, 'rb').read() if os.path.exists(ANNO) else b'{"version":1,"items":{}}'
            return self._send(200, body)
        return super().do_GET()

    def do_POST(self):
        if not self.path.startswith('/api/annotations'):
            return self._send(404, '{"error":"not found"}')
        n = int(self.headers.get('Content-Length', 0))
        try:
            doc = json.loads(self.rfile.read(n).decode('utf-8'))
            assert isinstance(doc.get('items'), dict)
        except Exception:
            return self._send(400, '{"error":"bad json"}')
        if os.path.exists(ANNO):  # keep a rolling backup, at most one per minute
            stamp = time.strftime('%Y%m%d_%H%M')
            shutil.copyfile(ANNO, os.path.join(BACKUP, f'annotations_{stamp}.json'))
        tmp = ANNO + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(doc, f, ensure_ascii=False, indent=1)
        os.replace(tmp, ANNO)
        return self._send(200, json.dumps({'ok': True, 'saved': len(doc['items'])}))

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    print(f'標記工具：http://127.0.0.1:{PORT}  （資料檔：{ANNO}）')
    http.server.ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
