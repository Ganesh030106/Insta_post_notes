"""
Instagram → PDF Converter
Flask application entry point
"""

import os
import uuid
from pathlib import Path
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
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024  # 16 MB limit

OUTPUT_DIR = Path(__file__).parent / "output"
OUTPUT_DIR.mkdir(exist_ok=True)


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/convert", methods=["POST"])
def convert():
    """
    POST /convert
    Body (JSON): { "url": "https://www.instagram.com/p/SHORTCODE/" }
    Returns: JSON with { "pdf_filename": "..." } or { "error": "..." }
    """
    data = request.get_json(silent=True)
    if not data or not data.get("url"):
        return jsonify({"error": "No URL provided."}), 400

    url = data["url"].strip()
    if "instagram.com" not in url:
        return jsonify({"error": "Please provide a valid Instagram post URL."}), 400

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
    """Serve a previously generated PDF for download."""
    # Security: only allow safe filenames
    safe_name = Path(filename).name
    pdf_path = OUTPUT_DIR / safe_name
    if not pdf_path.exists() or not safe_name.endswith(".pdf"):
        abort(404)
    return send_file(
        pdf_path,
        mimetype="application/pdf",
        as_attachment=True,
        download_name=safe_name,
    )


# ── Entry Point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"\n[*] Instagram -> PDF Converter running at http://0.0.0.0:{port}\n")
    app.run(debug=False, host="0.0.0.0", port=port)
