import { handleV1 } from "@/lib/gateway/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (request: Request) =>
  handleV1(request, { path: "/chat/completions", endpoint: "chat" });
