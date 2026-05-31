const MAX_BODY_BYTES = 256;

export type RoastRequestBody = {
  username?: string;
};

export async function parseRoastBody(
  req: Request
): Promise<RoastRequestBody | Response> {
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) {
    return new Response("Request body too large", { status: 413 });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return new Response("Request body too large", { status: 413 });
  }

  try {
    return JSON.parse(raw) as RoastRequestBody;
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
}

export function publicError(
  status: number,
  detail: string,
  fallback = "Request failed"
): Response {
  const message =
    process.env.NODE_ENV === "production" ? fallback : detail;
  return new Response(message, { status });
}
