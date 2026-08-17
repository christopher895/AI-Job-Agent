import { NextRequest } from "next/server";
import { forwardedClientIp, playgroundAgentPath } from "@/lib/proxy-path";

const AGENT_API_URL = process.env.AGENT_API_URL ?? "http://localhost:3001/api";

async function handle(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  const { path } = await params;
  const safePath = playgroundAgentPath(path);
  if (!safePath) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  const targetUrl = `${AGENT_API_URL}/playground/${safePath}${req.nextUrl.search}`;

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const body = hasBody ? await req.arrayBuffer() : undefined;

  const headers: Record<string, string> = {
    "X-Internal-Secret": process.env.INTERNAL_API_SECRET ?? "",
  };
  const contentType = req.headers.get("content-type");
  if (contentType) headers["Content-Type"] = contentType;
  const clientIp = forwardedClientIp(req);
  if (clientIp) headers["X-Forwarded-For"] = clientIp;

  let agentRes: Response;
  try {
    agentRes = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: hasBody && body && body.byteLength > 0 ? body : undefined,
    });
  } catch {
    return Response.json({ error: "Playground service unreachable" }, { status: 502 });
  }

  const resHeaders = new Headers();
  const outContentType = agentRes.headers.get("content-type");
  if (outContentType) resHeaders.set("content-type", outContentType);

  return new Response(agentRes.body, { status: agentRes.status, headers: resHeaders });
}

export { handle as POST };
