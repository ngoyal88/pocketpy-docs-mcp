## PocketPy Docs MCP Server

This repository provides a **Model Context Protocol (MCP)** server that exposes the PocketPy documentation (scraped into `docs.json`) as tools an AI agent can call.

It is designed to:

- Run **locally** for development.
- Be deployed as a **Python web service on Render**.
- Be consumed by MCP‑aware IDEs and agents (e.g. Cursor) over **HTTP / streamable HTTP**.

The server offers two main tools:

- `search_docs` – keyword search over PocketPy docs with excerpts.
- `list_topics` – list all documentation pages (`title (url)`).

---

## How to use the hosted MCP server (`https://pocketpy-docs-mcp.onrender.com`)

The Render‑hosted instance exposes the same tools as local development, over **HTTP / streamable HTTP** at:

- **MCP endpoint**: `https://pocketpy-docs-mcp.onrender.com/mcp/`
- **Health**: `https://pocketpy-docs-mcp.onrender.com/health`
- **Raw docs JSON**: `https://pocketpy-docs-mcp.onrender.com/docs.json`

You should always access it through an **MCP‑aware client** for `/mcp/`. Browsers and plain `curl` are fine for `/health` and `/docs.json`, but `/mcp/` expects MCP protocol messages.

### Cursor (IDE)

1. Open Cursor → MCP / Tools settings.
2. Add a new **remote MCP server**:
   - **Type / Transport**: HTTP / streamable HTTP.
   - **URL**: `https://pocketpy-docs-mcp.onrender.com/mcp/`
3. Save and let Cursor connect. It should discover two tools:
   - `search_docs`
   - `list_topics`
4. Use them in a chat:
   - “Call `list_topics`” → lists all docs with titles and URLs.
   - “Call `search_docs` with query `py_bind` and limit 3” → shows the top 3 relevant PocketPy docs with excerpts and links.

### Claude Desktop / Claude Artifacts (if you add it there)

Claude supports MCP servers via its MCP configuration file. A typical entry would look like:

```jsonc
{
  "servers": {
    "pocketpy-docs": {
      "type": "http",
      "url": "https://pocketpy-docs-mcp.onrender.com/mcp/"
    }
  }
}
```

After adding this in Claude’s MCP config and restarting Claude, the `pocketpy-docs` server should appear under Tools, and you can invoke `search_docs` and `list_topics` in chats.

### MCP Inspector (for debugging)

If you use the official MCP Inspector:

1. Start MCP Inspector (`npx @modelcontextprotocol/inspector` or your installed variant).
2. Add a server with:
   - **Transport**: HTTP / streamable HTTP.
   - **URL**: `https://pocketpy-docs-mcp.onrender.com/mcp/`
3. Use the Inspector UI to:
   - Call `list_topics` and inspect the raw response.
   - Call `search_docs` with different queries and see the JSON RPC and text content that your IDE/agent would see.

> If any client reports an “Invalid Host header” or `421` from the Render URL, double‑check:
> - The URL includes `/mcp/` and not just the bare origin.
> - The client is configured for **HTTP / streamable HTTP**, not SSE.
> Local testing at `http://localhost:8000/mcp/` is the quickest way to confirm the server itself is behaving correctly.

---

## Project layout

- `docs.json` – scraped PocketPy documentation. Each entry is an object:
  - `title`: page title.
  - `content`: plain‑text content of the page.
  - `url`: original PocketPy docs URL.
- `server.py` – Starlette + FastMCP app exposing:
  - `GET /health` – health check.
  - `GET /docs.json` – raw docs JSON.
  - MCP streamable HTTP transport mounted at `/mcp`.
- `requirements.txt` – Python dependencies.
- `render.yaml` – Render Blueprint for deploying the Python web service.
- `render-notes.md` – short deployment + client configuration notes.

---

## How the MCP server works

The server uses the **official Python MCP SDK** (`mcp`) and its **FastMCP** helper to define tools, and **Starlette** to provide HTTP endpoints:

- **Docs loading**
  - At startup, `server.py` loads `docs.json` from:
    - `DOCS_PATH` env var (if set), or
    - `./docs.json` next to `server.py`.

- **FastMCP configuration**
  - A FastMCP instance is created:
    - `mcp = FastMCP("pocketpy-docs", stateless_http=True, json_response=True)`
  - `stateless_http=True` means each request is self‑contained and friendly to horizontal scaling.
  - `mcp.streamable_http_app()` produces an ASGI app that handles the **streamable HTTP** MCP transport under `/mcp`.

- **Starlette application**
  - A Starlette app is built with:
    - `Route("/health", ...)`
    - `Route("/docs.json", ...)`
    - `Mount("/", app=mcp.streamable_http_app())` – this exposes `/mcp` internally.
  - A lifespan context runs `mcp.session_manager.run()` for proper MCP session handling.
  - `CORSMiddleware` is applied so web‑based MCP clients can reach the server and read the `Mcp-Session-Id` header:
    - `allow_origins=["*"]`
    - `allow_methods=["GET", "POST", "DELETE", "OPTIONS"]`
    - `expose_headers=["Mcp-Session-Id"]`

- **Tools**
  - `search_docs(query: str, limit: int = 3) -> str`
    - Uses a simple scoring algorithm over `title` and `content`.
    - Returns a human‑readable text block:
      - “Found N relevant page(s)” followed by sections:
        - `--- <title> (<url>) ---`
        - An excerpt of the page (default 800 characters).
  - `list_topics() -> str`
    - Returns:
      - `"Available PocketPy documentation pages:\n"` +
      - One line per page: `- <title> (<url>)`.

Agents see these as MCP tools and can call them directly.

---

## Requirements

- **Python**: 3.10+ (3.11 recommended; `render.yaml` pins `PYTHON_VERSION` to 3.11.11).
- Internet access only needed if you deploy to Render; local development works offline once `docs.json` is present.

Dependencies (from `requirements.txt`):

- `mcp` – official Python MCP SDK (FastMCP).
- `uvicorn` – ASGI server.
- `starlette` – lightweight ASGI framework for routes and middleware.

Install them with:

```bash
python -m pip install -r requirements.txt
```

---

## Running locally

1. **Clone the repository** (or open the folder in your IDE).

2. **Install dependencies**:

```bash
python -m pip install -r requirements.txt
```

3. **Run the server**:

```bash
python server.py
```

This starts uvicorn on `http://0.0.0.0:8000` by default (port is taken from `PORT` env var if set).

4. **Sanity‑check HTTP endpoints**:

```bash
curl http://localhost:8000/health
# -> {"ok": true}

curl http://localhost:8000/docs.json | head
# -> raw JSON array with PocketPy docs
```

You should *not* expect human‑friendly results from `GET /mcp` in a browser or curl; that path is reserved for MCP transport and expects a protocol‑aware MCP client.

---

## Using this MCP server from an MCP client (Cursor)

### 1. Local development with Cursor

1. Run the server locally:

```bash
python server.py
```

2. In Cursor’s MCP settings (or equivalent MCP client configuration), add a **remote MCP server**:

- **Transport / Type**: HTTP / streamable HTTP (not SSE).
- **URL**: `http://localhost:8000/mcp/`
  - The trailing slash `/` is usually expected by the client and matches redirects the server emits from `/mcp` → `/mcp/`.

3. Use the tools in Cursor:

- Call `list_topics` – you should see:
  - `Available PocketPy documentation pages:`
  - `- Welcome to pocketpy ...`, etc.
- Call `search_docs` with a query, for example:
  - `query = "py_bind"`
  - `limit = 3`
  - The response will be a text block summarizing the top matches with excerpts and canonical URLs.

### 2. Remote usage (Render deployment)

Once deployed to Render (see below), you can point Cursor (or any MCP client that supports streamable HTTP) at:

- **URL**: `https://pocketpy-docs-mcp.onrender.com/mcp/`
- **Transport**: HTTP / streamable HTTP

The behavior of the tools will be identical to local usage, but the data comes from your hosted service.

> Note: Browsers or curl hitting `/mcp/` directly without MCP headers will see low‑level JSON-RPC errors like `Not Acceptable: Client must accept text/event-stream`. This is expected and simply means the client is not speaking the MCP transport protocol.

---

## Deploying to Render

There are two supported approaches:

### A. Using `render.yaml` (Blueprint)

The repository includes a **Render Blueprint** at `render.yaml`:

```yaml
services:
  - type: web
    name: pocketpy-docs-mcp
    runtime: python
    plan: free
    region: oregon
    buildCommand: pip install -r requirements.txt
    startCommand: python server.py
    healthCheckPath: /health
    envVars:
      - key: PYTHON_VERSION
        value: "3.11.11"
      # - key: DOCS_PATH
      #   value: /opt/render/project/src/docs.json
```

Steps:

1. Push this repo to GitHub/GitLab.
2. In Render:
   - Go to **Blueprints** → **New Blueprint Instance**.
   - Point it at your repo and `render.yaml`.
3. Render will:
   - Build with `pip install -r requirements.txt`
   - Start the app with `python server.py`
   - Use `GET /health` to verify the service.
4. Your service will be available at a URL like:
   - `https://pocketpy-docs-mcp.onrender.com`

Then, point your MCP client to:

- `https://pocketpy-docs-mcp.onrender.com/mcp/`

### B. Creating a Web Service manually

1. Create a **new Web Service** from your repo.
2. Set:
   - **Runtime**: Python
   - **Build command**: `pip install -r requirements.txt`
   - **Start command**: `python server.py`
   - **Health check path**: `/health`
   - **Environment variable**: `PYTHON_VERSION=3.11.11`
3. Deploy.

Once live, configure your MCP client as above with the Render URL.

---

## Configuration and environment variables

- `PORT`
  - Port to bind the ASGI server to.
  - Default: `8000`.
  - Render injects this automatically; `server.py` reads it via `os.environ.get("PORT", "8000")`.

- `DOCS_PATH`
  - Optional path to `docs.json`.
  - Default: `docs.json` in the project root.
  - Useful if you mount the docs file somewhere else or use a persistent volume.

- `PYTHON_VERSION` (Render-specific)
  - Recommended to set to `3.11.11` on Render so the `mcp` package installs cleanly.

---

## Error handling and common issues

- **Local GET `/mcp/` returns JSON error**:
  - Example: `{"jsonrpc":"2.0","id":"server-error","error":{"code":-32600,"message":"Not Acceptable: Client must accept text/event-stream"}}`
  - This is expected when hitting `/mcp/` with a normal browser or curl.
  - Use a proper MCP client (Cursor, MCP Inspector, etc.) configured with streamable HTTP.

- **Cursor shows “Invalid Host header” / 421 when talking to Render URL**:
  - This indicates a mismatch between how the HTTP Host header is being forwarded by the platform and how the MCP/ASGI server is validating the host.
  - The current server is wired using the official FastMCP pattern (Starlette mount + `streamable_http_app`), so this is usually solvable by:
    - Ensuring your MCP client is configured for **HTTP / streamable HTTP**, not SSE.
    - Using the **exact** service URL including `/mcp/` and avoiding extra proxies.
  - Local usage (`http://localhost:8000/mcp/`) remains the simplest way to validate server behavior.

---

## Extending the server

Ideas for future enhancements:

- **Additional tools**:
  - `get_page(url: str)` → full content of a specific docs page.
  - `search_c_api(symbol: str)` → narrower search over C‑API documentation entries only.
- **Better ranking**:
  - Replace the simple term frequency scoring with BM25 or embeddings where appropriate.
- **Metadata**:
  - Return structured JSON responses (via MCP structured output) in addition to text, e.g. `{ title, url, score, snippet }[]`.

Because the server is built with FastMCP and Starlette, adding new tools is as simple as defining more `@mcp.tool()` functions that read from `docs_data` and return either text or structured objects.

