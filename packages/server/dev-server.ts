/**
 * Lightweight dev server that bypasses vercel dev overhead.
 * Run with: npm run dev
 */
import { createServer, IncomingMessage, ServerResponse } from "http";

// dynamically import handlers
async function loadHandler(name: string) {
	const mod = await import(`./api/${name}.ts`);
	return mod.default;
}

// parse request body for POST requests
async function parseBody(req: IncomingMessage): Promise<any> {
	return new Promise((resolve) => {
		let body = "";
		req.on("data", (chunk) => { body += chunk; });
		req.on("end", () => {
			if (!body) return resolve(null);
			try {
				resolve(JSON.parse(body));
			} catch {
				resolve(body);
			}
		});
	});
}

// convert Node req/res to Vercel-like objects
function createVercelRequest(req: IncomingMessage, query: Record<string, string | string[] | undefined>, body: any) {
	return {
		method: req.method,
		headers: req.headers,
		query,
		body,
	};
}

function createVercelResponse(res: ServerResponse) {
	let headersSent = false;
	const vercelRes: any = {
		statusCode: 200,
		_headers: {} as Record<string, string>,
		setHeader(name: string, value: string) {
			this._headers[name] = value;
			if (!headersSent) {
				res.setHeader(name, value);
			}
			return this;
		},
		status(code: number) {
			this.statusCode = code;
			return this;
		},
		json(data: any) {
			if (!headersSent) {
				res.writeHead(this.statusCode, { "Content-Type": "application/json", ...this._headers });
				headersSent = true;
			}
			res.end(JSON.stringify(data));
			return this;
		},
		// SSE support
		flushHeaders() {
			if (!headersSent) {
				res.writeHead(this.statusCode, this._headers);
				headersSent = true;
			}
		},
		write(data: string) {
			if (!headersSent) {
				res.writeHead(this.statusCode, this._headers);
				headersSent = true;
			}
			res.write(data);
			return this;
		},
		end(data?: string) {
			if (!headersSent) {
				res.writeHead(this.statusCode, this._headers);
				headersSent = true;
			}
			res.end(data);
			return this;
		},
		// for disconnect detection
		on(event: string, handler: () => void) {
			res.on(event, handler);
		},
		off(event: string, handler: () => void) {
			res.off(event, handler);
		},
	};
	return vercelRes;
}

const PORT = 3000;

const server = createServer(async (req, res) => {
	const startTime = Date.now();
	const url = new URL(req.url || "/", `http://localhost:${PORT}`);
	const pathname = url.pathname;
	const query: Record<string, string> = {};
	url.searchParams.forEach((value, key) => { query[key] = value; });

	// CORS preflight
	const origin = req.headers.origin as string | undefined;
	if (origin) {
		res.setHeader("Access-Control-Allow-Origin", origin);
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Wagtail-Session, X-SF-Gov-Extension");
	}

	if (req.method === "OPTIONS") {
		res.writeHead(200);
		res.end();
		return;
	}

	// route to handlers
	const routes: Record<string, string> = {
		"/api/auth/token": "auth/token",
		"/api/feedback": "feedback",
		"/api/link-check": "link-check",
		"/api/health": "health",
		"/api/test": "test",
	};

	const handlerName = routes[pathname];
	if (!handlerName) {
		res.writeHead(404, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: "Not found" }));
		return;
	}

	try {
		const handler = await loadHandler(handlerName);
		const body = req.method === "POST" ? await parseBody(req) : null;
		const vercelReq = createVercelRequest(req, query, body);
		const vercelRes = createVercelResponse(res);
		await handler(vercelReq, vercelRes);
		console.log(`${req.method} ${pathname} - ${Date.now() - startTime}ms`);
	} catch (error) {
		console.error("Handler error:", error);
		res.writeHead(500, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: "Internal server error" }));
	}
});

server.listen(PORT, () => {
	console.log(`Dev server running at http://localhost:${PORT}`);
});
