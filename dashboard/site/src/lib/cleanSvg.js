export function cleanSvg(raw) {
  return raw
    .replace(/<\?xml[^>]*\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<path[^>]*fill="#ffffff"[^>]*\/>/gi, "")
    .replace(/<path[^>]*fill="#fff"[^>]*\/>/gi, "")
    .replace(/<rect[^>]*fill="#ffffff"[^>]*\/>/gi, "")
    .replace(/<rect[^>]*fill="#fff"[^>]*\/>/gi, "")
    .replace(/fill="#[0-9a-fA-F]{3,6}"/g, (m) => {
      const hex = m.match(/#([0-9a-fA-F]{3,6})/)[1].toLowerCase();
      const norm =
        hex.length === 3
          ? hex
              .split("")
              .map((c) => c + c)
              .join("")
          : hex;
      if (norm === "ffffff") return 'fill="none"';
      return 'fill="currentColor"';
    })
    .replace(/fill="black"/gi, 'fill="currentColor"')
    .replace(/fill="white"/gi, 'fill="none"')
    .replace(/<svg([^>]*)width="[^"]*"/g, "<svg$1")
    .replace(/<svg([^>]*)height="[^"]*"/g, "<svg$1");
}
