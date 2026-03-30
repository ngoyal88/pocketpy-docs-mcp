import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());


app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

const DOCS_PATH =
  process.env.DOCS_PATH || path.join(__dirname, "docs.json");

let docs = [];
try {
  const raw = fs.readFileSync(DOCS_PATH, "utf-8");
  docs = JSON.parse(raw);
  console.log(`Loaded ${docs.length} PocketPy docs entries from ${DOCS_PATH}`);
} catch (err) {
  console.error("Failed to load docs.json:", err);
}

const transports = new Map();

function searchDocs(query, limit = 3) {
  if (!query || !docs.length) return [];
  const q = String(query).toLowerCase();
  const terms = q
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2);

  const scored = docs.map((doc) => {
    const title = (doc.title || "").toLowerCase();
    const content = (doc.content || "").toLowerCase();
    let score = 0;
    for (const term of terms.length ? terms : [q]) {
      if (title.includes(term)) score += 5;
      if (content.includes(term)) score += 1;
    }
    return { doc, score };
  });

  return scored
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.doc);
}

function buildExcerpt(content, maxLength = 800) {
  if (!content) return "";
  if (content.length <= maxLength) return content;
  return content.slice(0, maxLength) + "...";
}

app.get("/mcp", async (req, res) => {
  console.log("New MCP SSE connection");

  const server = new Server(
    { name: "pocketpy-docs", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "search_docs",
        description:
          "Search PocketPy documentation pages by text query over titles and content.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            limit: { type: "number" },
          },
          required: ["query"],
        },
      },
      {
        name: "list_topics",
        description: "List all available PocketPy documentation pages.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    if (name === "search_docs") {
      const query = String(args.query || "");
      const limit =
        typeof args.limit === "number" && args.limit > 0 && args.limit <= 10
          ? args.limit
          : 3;

      const results = searchDocs(query, limit);
      if (!results.length) {
        return {
          content: [
            {
              type: "text",
              text: `No docs found for "${query}".`,
            },
          ],
        };
      }

      let text = `Found ${results.length} relevant page(s):\n\n`;
      for (const doc of results) {
        text += `--- ${doc.title} (${doc.url}) ---\n`;
        text += buildExcerpt(doc.content);
        text += "\n\n";
      }

      return {
        content: [
          {
            type: "text",
            text,
          },
        ],
      };
    }

    if (name === "list_topics") {
      if (!docs.length) {
        return {
          content: [
            {
              type: "text",
              text: "No documentation pages are loaded.",
            },
          ],
        };
      }
      const lines = docs.map(
        (d) => `- ${d.title || "(untitled)"} (${d.url || "no url"})`
      );
      return {
        content: [
          {
            type: "text",
            text: `Available PocketPy documentation pages:\n${lines.join(
              "\n"
            )}`,
          },
        ],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  const transport = new SSEServerTransport("/mcp/message", res);
  await server.connect(transport);

  transports.set(transport.sessionId, transport);
  req.on("close", () => {
    transports.delete(transport.sessionId);
  });
});

app.post("/mcp/message", async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports.get(sessionId);
  if (!transport) {
    res.status(404).send("Session not found");
    return;
  }

  await transport.handlePostMessage(req, res);
});

app.get("/docs.json", (req, res) => {
  if (!docs.length) {
    res.status(500).json({ error: "Documentation not loaded" });
    return;
  }
  res.json(docs);
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PocketPy MCP server listening on port ${PORT}`);
});

