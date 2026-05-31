import OpenAI from "openai";
import {
  bundleToAnalysisText,
  fetchGitHubProfile,
  isValidGitHubUsername,
} from "@/lib/github";
import { capAnalysisText } from "@/lib/sanitize-prompt";
import { ROAST_SYSTEM, buildRoastUserMessage } from "@/lib/roast-prompt";
import { STREAM_ERROR_PREFIX } from "@/lib/constants";
import { parseRoastBody, publicError } from "@/lib/security";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const body = await parseRoastBody(req);
  if (body instanceof Response) return body;

  const username = (body.username ?? "").trim();
  if (!isValidGitHubUsername(username)) {
    return new Response("That does not look like a valid GitHub username.", {
      status: 400,
    });
  }

  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    return publicError(500, "Server missing NVIDIA_API_KEY", "Service unavailable");
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const fail = (message: string) => {
        controller.enqueue(
          encoder.encode(`${STREAM_ERROR_PREFIX}${message}`)
        );
        controller.close();
      };

      try {
        // Flush headers immediately so the client is not stuck on fetch()
        controller.enqueue(encoder.encode(""));

        const bundle = await fetchGitHubProfile(username);
        if (!bundle) {
          fail("User not found");
          return;
        }

        const openai = new OpenAI({
          apiKey,
          baseURL: "https://integrate.api.nvidia.com/v1",
          timeout: 90_000,
        });

        const analysisText = capAnalysisText(bundleToAnalysisText(bundle));
        const maxTokens = Math.min(
          Number(process.env.NVIDIA_MAX_TOKENS ?? "8192"),
          16384
        );

        const stream = await openai.chat.completions.create({
          model: process.env.NVIDIA_MODEL ?? "z-ai/glm-5.1",
          messages: [
            { role: "system", content: ROAST_SYSTEM },
            {
              role: "user",
              content: buildRoastUserMessage(analysisText, username),
            },
          ],
          temperature: 1,
          top_p: 1,
          max_tokens: Number.isFinite(maxTokens) ? maxTokens : 8192,
          stream: true,
        });

        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content ?? "";
          if (text) controller.enqueue(encoder.encode(text));
        }
        controller.close();
      } catch (err) {
        const detail =
          err instanceof Error ? err.message : "Roast generation failed";
        const message =
          process.env.NODE_ENV === "production"
            ? "Could not complete roast"
            : detail;
        fail(message);
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
