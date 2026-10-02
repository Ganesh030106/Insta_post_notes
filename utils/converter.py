import os
import re
import json
import uuid
import time
import shutil
import requests
import instaloader
from pathlib import Path
from PIL import Image
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.units import cm


# ── Directories ──────────────────────────────────────────────────────────────
BASE_DIR    = Path(__file__).parent.parent   # project root (not utils/)
DOWNLOAD_DIR = BASE_DIR / "downloads"
OUTPUT_DIR   = BASE_DIR / "output"
DOWNLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)


# ── Helpers ───────────────────────────────────────────────────────────────────
def extract_shortcode(url: str) -> str | None:
    """Extract Instagram shortcode from a post URL.
    Handles both:
      https://www.instagram.com/p/SHORTCODE/
      https://www.instagram.com/USERNAME/p/SHORTCODE/
    """
    patterns = [
        r"instagram\.com(?:/[^/?#]+)?/p/([A-Za-z0-9_-]+)",
        r"instagram\.com(?:/[^/?#]+)?/reel/([A-Za-z0-9_-]+)",
        r"instagram\.com(?:/[^/?#]+)?/tv/([A-Za-z0-9_-]+)",
    ]
    for pat in patterns:
        m = re.search(pat, url)
        if m:
            return m.group(1)
    return None


def fetch_post_images_instaloader(shortcode: str, session_dir: Path) -> list[Path]:
    """
    Use instaloader to download all images from a post IN CAROUSEL ORDER.
    Iterates sidecar nodes directly so the sequence always matches Instagram's order.
    """
    L = instaloader.Instaloader(
        download_pictures=False,   # we handle downloading ourselves
        download_videos=False,
        download_video_thumbnails=False,
        download_geotags=False,
        download_comments=False,
        save_metadata=False,
        compress_json=False,
        quiet=True,
    )

    try:
        post = instaloader.Post.from_shortcode(L.context, shortcode)
    except Exception as e:
        raise RuntimeError(f"instaloader failed: {e}")

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        )
    }

    downloaded: list[Path] = []

    try:
        if post.typename == "GraphSidecar":
            # Carousel — iterate nodes IN ORDER as Instagram returns them
            for i, node in enumerate(post.get_sidecar_nodes()):
                img_url = node.display_url  # highest-res image/thumbnail
                out_path = session_dir / f"{i+1:03d}.jpg"
                r = requests.get(img_url, headers=headers, timeout=20)
                r.raise_for_status()
                out_path.write_bytes(r.content)
                downloaded.append(out_path)
        else:
            # Single image or video thumbnail
            img_url = post.url
            out_path = session_dir / "001.jpg"
            r = requests.get(img_url, headers=headers, timeout=20)
            r.raise_for_status()
            out_path.write_bytes(r.content)
            downloaded.append(out_path)
    except Exception as e:
        raise RuntimeError(f"Failed to download images: {e}")

    return downloaded  # already sorted: 001.jpg, 002.jpg, …



def fetch_post_images_fallback(shortcode: str, session_dir: Path) -> list[Path]:
    """
    Fallback: scrape the embedded JSON from Instagram's page to get image URLs,
    then download them with requests.
    """
    url = f"https://www.instagram.com/p/{shortcode}/?__a=1&__d=dis"
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "x-ig-app-id": "936619743392459",
    }

    resp = requests.get(url, headers=headers, timeout=15)
    if resp.status_code != 200:
        raise RuntimeError(
            f"Instagram returned HTTP {resp.status_code}. "
            "The post may be private or the link is invalid."
        )

    try:
        data = resp.json()
    except Exception:
        raise RuntimeError(
            "Could not parse Instagram response. "
            "Instagram may have rate-limited this request."
        )

    # Navigate the JSON to collect display URLs
    image_urls: list[str] = []
    try:
        media = data["graphql"]["shortcode_media"]
        if media.get("edge_sidecar_to_children"):
            # Carousel post
            for edge in media["edge_sidecar_to_children"]["edges"]:
                node = edge["node"]
                if node.get("is_video"):
                    url_ = node.get("display_resources", [{}])[-1].get("src", "")
                else:
                    url_ = node.get("display_url", "")
                if url_:
                    image_urls.append(url_)
        else:
            url_ = media.get("display_url", "")
            if url_:
                image_urls.append(url_)
    except (KeyError, TypeError):
        raise RuntimeError("Unexpected Instagram JSON structure.")

    if not image_urls:
        raise RuntimeError("No images found in the Instagram post.")

    # Download the images
    downloaded: list[Path] = []
    for i, img_url in enumerate(image_urls):
        out_path = session_dir / f"image_{i+1:03d}.jpg"
        r = requests.get(img_url, headers=headers, timeout=20)
        r.raise_for_status()
        out_path.write_bytes(r.content)
        downloaded.append(out_path)

    return downloaded


def fetch_post_images(url: str) -> tuple[list[Path], str]:
    """
    Download all images from an Instagram post URL.
    Returns (list_of_image_paths, session_dir_str).
    """
    shortcode = extract_shortcode(url)
    if not shortcode:
        raise ValueError(
            "Invalid Instagram URL. Please use a link like:\n"
            "https://www.instagram.com/p/SHORTCODE/"
        )

    session_id = uuid.uuid4().hex[:10]
    session_dir = DOWNLOAD_DIR / session_id
    session_dir.mkdir(parents=True, exist_ok=True)

    # Try instaloader first
    try:
        images = fetch_post_images_instaloader(shortcode, session_dir)
        if images:
            return images, str(session_dir)
    except Exception:
        pass  # Fall through to fallback

    # Fallback: direct scraping
    images = fetch_post_images_fallback(shortcode, session_dir)
    return images, str(session_dir)


# ── PDF Generation ────────────────────────────────────────────────────────────
def create_pdf(image_paths: list[Path], output_path: Path, post_url: str = "") -> Path:
    """
    Create a PDF with one image per page (A4, centered, with padding).
    """
    page_w, page_h = A4  # 595.27 x 841.89 points
    margin = 1.5 * cm
    usable_w = page_w - 2 * margin
    usable_h = page_h - 2 * margin

    c = canvas.Canvas(str(output_path), pagesize=A4)
    c.setTitle("Instagram Post")
    c.setAuthor("Instagram → PDF Converter")
    c.setSubject(post_url)

    for idx, img_path in enumerate(image_paths):
        # Convert to RGB JPEG in memory (handles PNGs, RGBA, etc.)
        try:
            with Image.open(img_path) as pil_img:
                pil_img = pil_img.convert("RGB")
                img_w, img_h = pil_img.size

                # Scale to fit the usable area while preserving aspect ratio
                scale = min(usable_w / img_w, usable_h / img_h)
                draw_w = img_w * scale
                draw_h = img_h * scale

                x = margin + (usable_w - draw_w) / 2
                y = margin + (usable_h - draw_h) / 2

                # Dark background for the page
                c.setFillColor(colors.HexColor("#0f0f0f"))
                c.rect(0, 0, page_w, page_h, fill=1, stroke=0)

                # Draw image
                img_reader = ImageReader(pil_img)
                c.drawImage(img_reader, x, y, width=draw_w, height=draw_h,
                            preserveAspectRatio=True, mask="auto")

                # Page number (subtle)
                c.setFont("Helvetica", 8)
                c.setFillColor(colors.HexColor("#555555"))
                c.drawCentredString(
                    page_w / 2,
                    0.6 * cm,
                    f"{idx + 1} / {len(image_paths)}"
                )

                c.showPage()
        except Exception as e:
            # Skip unreadable images silently
            continue

    if c.getPageNumber() == 1:
        raise RuntimeError("No valid images could be processed into the PDF.")

    c.save()
    return output_path


# ── Main Pipeline ─────────────────────────────────────────────────────────────
def convert_instagram_to_pdf(url: str) -> Path:
    """
    Full pipeline: fetch images → generate PDF → clean up temp files.
    Returns the path to the generated PDF.
    """
    images, session_dir = fetch_post_images(url)

    shortcode = extract_shortcode(url)
    pdf_path = OUTPUT_DIR / f"instagram_{shortcode}.pdf"

    try:
        create_pdf(images, pdf_path, post_url=url)
    finally:
        # Clean up downloaded images
        shutil.rmtree(session_dir, ignore_errors=True)

    return pdf_path
