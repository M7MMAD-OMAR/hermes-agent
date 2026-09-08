"""Recognize complete, substantial generated documents in assistant fences.

Small examples and prose remain conversation content. The thresholds match the
Desktop artifact detector's document/graphic/code categories. Nothing is run.
"""
from __future__ import annotations

from dataclasses import dataclass
import re

_OPEN = re.compile(r"^ {0,3}(`{3,}|~{3,})([^\r\n]*)$")
_NON_ARTIFACT = {"", "console", "diff", "listing", "log", "logs", "markdown", "md",
                 "mermaid", "output", "patch", "plain", "plaintext", "shell-session",
                 "stdout", "text", "txt"}
_EXTENSIONS = {"javascript": ".js", "js": ".js", "typescript": ".ts", "ts": ".ts",
               "tsx": ".tsx", "jsx": ".jsx", "python": ".py", "py": ".py",
               "css": ".css", "json": ".json", "rust": ".rs", "go": ".go",
               "sql": ".sql", "bash": ".sh", "sh": ".sh", "yaml": ".yaml"}


@dataclass(frozen=True)
class GeneratedResult:
    key: str
    label: str
    extension: str
    kind: str
    content: str


def _title(content, tag):
    match = re.search(rf"<{tag}[^>]*>([\s\S]*?)</{tag}>", content, re.I)
    return re.sub(r"\s+", " ", re.sub(r"<[^>]*>", " ", match[1])).strip()[:80] if match else ""


def _detect(language, content):
    content = content.strip()
    if language in {"html", "htm", "xhtml"}:
        document = re.search(r"<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]", content, re.I)
        if len(content) < (160 if document else 1200) or not re.search(r"<[a-z][a-z0-9-]*[\s>]", content, re.I):
            return None
        kind, ext = "file", ".html"
        title = _title(content, "title") or _title(content, "h1") or "HTML"
    elif language == "svg":
        if len(content) < 2000 or not re.search(r"<svg[\s>]", content, re.I):
            return None
        kind, ext, title = "image", ".svg", _title(content, "title") or "SVG"
    elif language not in _NON_ARTIFACT and (len(content) >= 3000 or len(content.splitlines()) >= 48):
        kind, ext = "file", _EXTENSIONS.get(language, ".txt")
        named = re.search(r"^\s*(?://|#|--|<!--|/\*)\s*([\w./-]+\.[a-z0-9]{1,8})\b", content[:2000], re.I)
        declaration = re.search(r"(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|struct|interface|enum|trait|impl|def|fn)\s+([A-Za-z_$][\w$]*)", content[:2000])
        title = named[1].rsplit("/", 1)[-1] if named else declaration[1] if declaration else language
    else:
        return None
    slug = re.sub(r"[^\w]+", "-", title.lower(), flags=re.UNICODE).strip("-")[:48] or "untitled"
    label = title if title.lower().endswith(ext) else title + ext
    return GeneratedResult(f"inline:{language}:{slug}", label, ext, kind, content)


def generated_results(text):
    """Yield only closed fences, including tilde fences and longer delimiters."""
    marker, language, body = None, "", []
    for line in text.splitlines():
        if marker is None:
            match = _OPEN.match(line)
            if match:
                marker = match[1]
                language = match[2].strip().split()[0].lower() if match[2].strip() else ""
                body = []
        elif re.fullmatch(r" {0,3}" + re.escape(marker[0]) + "{" + str(len(marker)) + r",}\s*", line):
            detected = _detect(language, "\n".join(body))
            if detected:
                yield detected
            marker, body = None, []
        else:
            body.append(line)
