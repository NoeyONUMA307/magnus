import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-4-6";

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic();
  }
  return _client;
}

export async function streamChat(
  systemPrompt: string,
  userMessage: string,
  maxTokens = 16384
) {
  return getClient().messages.stream({
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });
}
