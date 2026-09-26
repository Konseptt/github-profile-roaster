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

function usableReply(text: string | null | undefined): string {
  const trimmed = text?.trim() ?? "";
  if (!trimmed || /^!+$/.test(trimmed)) return "";
  return trimmed;
}

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

        const completion = await openai.chat.completions.create({
          model: "moonshotai/kimi-k3",
          messages: [
            { role: "system", content: ROAST_SYSTEM },
            {
              role: "user",
              content: buildRoastUserMessage(analysisText, username),
            },
          ],
          temperature: 1,
          top_p: 0.95,
          max_tokens: 1024,
          stream: false,
          reasoning_effort: "low",
        } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);

        const message = completion.choices[0]?.message as
          | { content?: string | null; reasoning_content?: string | null }
          | undefined;
        const text = usableReply(message?.content) || usableReply(message?.reasoning_content);
        if (text) controller.enqueue(encoder.encode(text));
        controller.close();
      } catch (err) {
        console.error("roast failed", err instanceof Error ? err.message : err);
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
