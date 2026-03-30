## Deploying PocketPy docs MCP to Render (Python)

Use a **Python 3.10+** environment (the `mcp` package requires it).

- **Build command**: `pip install -r requirements.txt`
- **Start command**: `python server.py` (or `uvicorn server:app --host 0.0.0.0 --port $PORT`)
- **Environment variables**:
  - `PORT`: provided by Render; defaults to `8000` locally.
  - `DOCS_PATH` (optional): override path to `docs.json` if you place it elsewhere.

- **Health check path**: `/health`
- **Raw docs**: `GET /docs.json`

## Cursor / MCP client configuration

- **Transport**: **HTTP** / **streamable HTTP** (this server is not the old Node SSE stack).
- **URL**: `https://<your-service>.onrender.com/mcp`

## Local run

```bash
python -m pip install -r requirements.txt
python server.py
```

Then point the MCP client at `http://localhost:8000/mcp` (or whatever `PORT` you set).

**CORS**: the app uses Starlette `CORSMiddleware` with `expose_headers=["Mcp-Session-Id"]` so browser-based MCP clients can follow sessions.
