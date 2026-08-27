import { NextRequest, NextResponse } from "next/server";
import { getSiteUrl } from "@/lib/env";
import { parseMcpUrl } from "@/lib/mcp-connection";
import { apiError } from "@/lib/http";

export function GET(request: NextRequest) {
  const resource = request.nextUrl.searchParams.get("resource") || "";
  if (!parseMcpUrl(resource)) return apiError("INVALID_RESOURCE", "MCP resource URL이 올바르지 않습니다.", 400);
  return NextResponse.json({
    resource,
    authorization_servers: [getSiteUrl()],
    scopes_supported: ["mcp:tools"],
    resource_documentation: `${getSiteUrl()}/dashboard`,
  });
}
