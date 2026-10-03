"""
Instagram → PDF Converter
Production-Hardened Flask Application Entry Point
"""

import os
import re
import time
import threading
from pathlib import Path
from urllib.parse import urlparse
from collections import defaultdict
from flask import (
    Flask,
    render_template,
    request,
    jsonify,
    send_file,
    abort,
)

from utils.converter import convert_instagram_to_pdf

app = Flask(__name__)

# Security: Limit maximum request size to 128 KB (prevents memory exhaustion DOS)
app.config["MAX_CONTENT_LENGTH"] = 128 * 1024

OUTPUT_DIR = (Path(__file__).parent / "output").resolve()
OUTPUT_DIR.mkdir(exist_ok=True)

# ── Security & Validation ─────────────────────────────────────────────────────

SAFE_FILENAME_REGEX = re.compile(r"^instagram_[A-Za-z0-9_-]{3,64}\.pdf$")
INSTAGRAM_PATH_REGEX = re.compile(r"^/(?:[^/?#]+/)?(p|reel|tv)/([A-Za-z0-9_-]+)")

def validate_instagram_url(url: str) -> bool:
    """Strict SSRF & Schema Validation for Instagram URLs."""
    if not url or len(url) > 500:
        return False
    try:
        parsed = urlparse(url.strip())
        if parsed.scheme not in ("http", "https"):
            return False
        hostname = (parsed.hostname or "").lower()
        if hostname not in ("www.instagram.com", "instagram.com", "instagr.am"):
            return False
        return bool(INSTAGRAM_PATH_REGEX.search(parsed.path))
    except Exception:
        return False

# ── In-Memory IP Rate Limiter (No Redis needed) ───────────────────────────────

class RateLimiter:
    """Thread-safe sliding-window rate limiter per client IP."""
    def __init__(self, max_requests: int = 10, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.requests = defaultdict(list)
        self.lock = threading.Lock()

    def is_allowed(self, ip: str) -> bool:
        now = time.time()
        with self.lock:
            # Clean expired timestamps
            valid_window = now - self.window_seconds
            self.requests[ip] = [t for t in self.requests[ip] if t > valid_window]

            if len(self.requests[ip]) >= self.max_requests:
                return False

            self.requests[ip].append(now)
            return True

# Allow max 10 conversion requests per minute per IP
limiter = RateLimiter(max_requests=10, window_seconds=60)

def get_client_ip() -> str:
    """Accurately identify client IP through reverse proxies (Render, Cloudflare)."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.remote_addr or "127.0.0.1"

# ── Auto-Disk Cleanup (Prevents Disk Exhaustion DoS) ──────────────────────────

def cleanup_old_files(max_age_seconds: int = 1800):
    """Deletes generated PDFs older than 30 minutes to free disk space."""
    try:
        now = time.time()
        for f in OUTPUT_DIR.glob("*.pdf"):
            if f.is_file() and (now - f.stat().st_mtime) > max_age_seconds:
                f.unlink(missing_ok=True)
    except Exception as e:
        app.logger.warning(f"File cleanup error: {e}")

# ── HTTP Security Headers (OWASP Hardening) ───────────────────────────────────

@app.after_request
def apply_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com; "
        "img-src 'self' data: https://*.cdninstagram.com https://*.fbcdn.net; "
        "connect-src 'self';"
    )
    return response

# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/convert", methods=["POST"])
def convert():
    """
    POST /convert
    Body (JSON): { "url": "https://www.instagram.com/p/SHORTCODE/" }
    """
    # 1. IP Rate Limiting
    client_ip = get_client_ip()
    if not limiter.is_allowed(client_ip):
        return jsonify({
            "error": "Rate limit exceeded. Please wait a minute before converting another post."
        }), 429

    # 2. Lazy cleanup of old PDFs to prevent disk filling
    cleanup_old_files()

    # 3. Payload & URL Validation
    data = request.get_json(silent=True)
    if not data or not data.get("url"):
        return jsonify({"error": "No URL provided."}), 400

    url = data["url"].strip()
    if not validate_instagram_url(url):
        return jsonify({
            "error": "Invalid Instagram URL. Only public post, carousel, or reel links are permitted."
        }), 400

    # 4. Pipeline Execution
    try:
        pdf_path = convert_instagram_to_pdf(url)
        return jsonify({"pdf_filename": pdf_path.name})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": f"Unexpected error: {str(e)}"}), 500

@app.route("/download/<filename>")
def download(filename: str):
    """
    Serve generated PDF with strict Path Traversal & regex protection.
    """
    if not SAFE_FILENAME_REGEX.match(filename):
        abort(400)

    # Canonical path resolution prevents directory traversal
    pdf_path = (OUTPUT_DIR / filename).resolve()
    if not pdf_path.is_file() or pdf_path.parent != OUTPUT_DIR:
        abort(404)

    return send_file(
        pdf_path,
        mimetype="application/pdf",
        as_attachment=True,
        download_name=filename,
    )

# ── Entry Point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"\n[*] Secure Instagram -> PDF Converter running at http://0.0.0.0:{port}\n")
    app.run(debug=False, host="0.0.0.0", port=port)
