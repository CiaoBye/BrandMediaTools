"""xhshow 签名 HTTP 服务 — 提供给 Node.js 端调用生成小红书 API 签名"""
import json
import http.server
import urllib.parse
from xhshow import Xhshow

_client = Xhshow()

class SignHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/status":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true,"status":"running"}')
            return
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length else {}
        uri = body.get("uri", "")
        cookies = body.get("cookies", {})
        method = body.get("method", "get")
        params = body.get("params", {})
        payload = body.get("payload", {})
        x_rap = body.get("x_rap", False)
        # 签名格式：xys（默认，旧版）/ xyw（数据类 API 必需）
        sign_format = body.get("sign_format", "xys")

        try:
            if method == "post":
                headers = _client.sign_headers_post(
                    uri=uri, cookies=cookies, payload=payload,
                    x_rap=x_rap, sign_format=sign_format
                )
            else:
                headers = _client.sign_headers_get(
                    uri=uri, cookies=cookies, params=params,
                    x_rap=x_rap, sign_format=sign_format
                )
            result = {"ok": True, "headers": headers}
        except Exception as e:
            result = {"ok": False, "error": str(e)}

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(result, ensure_ascii=False).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

def start(port=9223):
    server = http.server.HTTPServer(("127.0.0.1", port), SignHandler)
    print(f"[sign-server] listening on http://127.0.0.1:{port}")
    server.serve_forever()

if __name__ == "__main__":
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9223
    start(port)
