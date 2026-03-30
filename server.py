"""
PocketPy docs MCP server: streamable HTTP at /mcp, plus /health and /docs.json.

Run: uvicorn server:app --host 0.0.0.0 --port 8000
Or: python server.py
"""

from __future__ import annotations

import contextlib
import json
import os
from pathlib import Path

from mcp.server.fastmcp import FastMCP
from starlette.applications import Starlette
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route

DOCS_PATH = Path(os.environ.get("DOCS_PATH", "docs.json")).resolve()

try:
    docs_data = json.loads(DOCS_PATH.read_text(encoding="utf-8"))
except Exception as exc:  # pragma: no cover
    print(f"Failed to load docs.json from {DOCS_PATH}: {exc}")
    docs_data = []


mcp = FastMCP("pocketpy-docs", stateless_http=True, json_response=True)
# Serve MCP at https://host/mcp (not /mcp/mcp)
mcp.settings.streamable_http_path = "/"


def _search_docs(query: str, limit: int = 3):
    if not query or not docs_data:
        return []

    q = query.lower()
    terms = [t for t in q.split() if len(t) > 2]

    scored: list[tuple[int, dict]] = []
    for doc in docs_data:
        title = (doc.get("title") or "").lower()
        content = (doc.get("content") or "").lower()
        score = 0
        for term in (terms or [q]):
            if term in title:
                score += 5
            if term in content:
                score += 1
        if score > 0:
            scored.append((score, doc))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [doc for _, doc in scored[: max(1, min(limit, 10))]]


def _excerpt(text: str, max_len: int = 800) -> str:
    if not text:
        return ""
    if len(text) <= max_len:
        return text
    return text[:max_len] + "..."


@mcp.tool()
def search_docs(query: str, limit: int = 3) -> str:
    """Search PocketPy documentation pages by text query over titles and content."""

    results = _search_docs(query, limit)
    if not results:
        return f'No docs found for "{query}".'

    lines: list[str] = [f"Found {len(results)} relevant page(s):", ""]
    for doc in results:
        lines.append(f"--- {doc.get('title')} ({doc.get('url')}) ---")
        lines.append(_excerpt(str(doc.get("content", ""))))
        lines.append("")
    return "\n".join(lines)


@mcp.tool()
def list_topics() -> str:
    """List all available PocketPy documentation pages."""

    if not docs_data:
        return "No documentation pages are loaded."

    lines = [
        f"- {doc.get('title') or '(untitled)'} ({doc.get('url') or 'no url'})"
        for doc in docs_data
    ]
    return "Available PocketPy documentation pages:\n" + "\n".join(lines)


async def health(_request):
    return JSONResponse({"ok": True})


async def docs_json(_request):
    if not docs_data:
        return JSONResponse({"error": "Documentation not loaded"}, status_code=500)
    return JSONResponse(docs_data)


@contextlib.asynccontextmanager
async def lifespan(app: Starlette):
    async with mcp.session_manager.run():
        yield


starlette_app = Starlette(
    routes=[
        Route("/health", health, methods=["GET"]),
        Route("/docs.json", docs_json, methods=["GET"]),
        Mount("/mcp", app=mcp.streamable_http_app()),
    ],
    lifespan=lifespan,
)

app = CORSMiddleware(
    starlette_app,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    expose_headers=["Mcp-Session-Id"],
)


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
