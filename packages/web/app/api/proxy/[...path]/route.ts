import { NextRequest } from "next/server";
import { auth } from "@/auth";

const AGENT_API_URL = process.env.AGENT_API_URL ?? "http://localhost:3001/api";

async function handle(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  const session = await auth();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { path } = await params;
  const targetUrl = `${AGENT_API_URL}/${path.join("/")}${req.nextUrl.search}`;

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const body = hasBody ? await req.arrayBuffer() : undefined;

  const headers: Record<string, string> = {
    "X-Internal-Secret": process.env.INTERNAL_API_SECRET ?? "",
  };
  const contentType = req.headers.get("content-type");
  if (contentType) headers["Content-Type"] = contentType;

  const agentRes = await fetch(targetUrl, {
    method: req.method,
    headers,
    body: hasBody && body && body.byteLength > 0 ? body : undefined,
  });

  const resHeaders = new Headers();
  const outContentType = agentRes.headers.get("content-type");
  if (outContentType) resHeaders.set("content-type", outContentType);
  const disposition = agentRes.headers.get("content-disposition");
  if (disposition) resHeaders.set("content-disposition", disposition);

  return new Response(agentRes.body, { status: agentRes.status, headers: resHeaders });
}

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE };
