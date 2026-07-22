from __future__ import annotations

from urllib.parse import urlsplit


_BLOCKED_PAGE_HOSTS = (
    "dailymotion.com",
    "facebook.com",
    "instagram.com",
    "loom.com",
    "tiktok.com",
    "vimeo.com",
    "youtu.be",
    "youtube.com",
)
_BLOCKED_PATH_SUFFIXES = (
    ".avi",
    ".doc",
    ".docx",
    ".htm",
    ".html",
    ".m4v",
    ".mkv",
    ".mov",
    ".mp3",
    ".mp4",
    ".mpeg",
    ".mpg",
    ".pdf",
    ".ppt",
    ".pptx",
    ".webm",
)


def is_supported_remote_image_url(value: object) -> bool:
    """Reject obvious page/video/document URLs before they reach image decoders.

    Many licensed image CDNs use extensionless paths, so this intentionally uses a
    conservative deny-list instead of requiring an image filename extension.
    """

    url = str(value or "").strip()
    if not url.lower().startswith(("http://", "https://")):
        return False
    try:
        parsed = urlsplit(url)
    except ValueError:
        return False
    hostname = (parsed.hostname or "").lower().rstrip(".")
    if not hostname:
        return False
    if any(hostname == blocked or hostname.endswith(f".{blocked}") for blocked in _BLOCKED_PAGE_HOSTS):
        return False
    path = (parsed.path or "").lower().rstrip("/")
    return not path.endswith(_BLOCKED_PATH_SUFFIXES)
