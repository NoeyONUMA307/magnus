import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { settings } from "./db.js";

// Unified chunk type that all consumers already expect
export interface LLMChunk {
  type: "content_block_delta";
  delta: { type: "text_delta"; text: string };
}

// Async iterable wrapper
export interface LLMStream extends AsyncIterable<LLMChunk> {}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface LLMResult {
  stream: LLMStream;
  getUsage: () => Promise<TokenUsage>;
}

let _anthropic: Anthropic | null = null;
let _openai: OpenAI | null = null;
let _ollama: OpenAI | null = null;

function getAnthropicClient(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic();
  return _anthropic;
}

function getOpenAIClient(): OpenAI {
  if (!_openai) _openai = new OpenAI();
  return _openai;
}

function getOllamaClient(): OpenAI {
  if (!_ollama)
    _ollama = new OpenAI({
      baseURL: "http://localhost:11434/v1",
      apiKey: "ollama",
    });
  return _ollama;
}

export function getActiveProvider(): "anthropic" | "openai" | "ollama" {
  const val = settings.get("llm_provider");
  if (val === "openai") return "openai";
  if (val === "ollama") return "ollama";
  return "anthropic";
}

export function getActiveModel(): string {
  const val = settings.get("llm_model");
  if (val) return val;
  const provider = getActiveProvider();
  if (provider === "openai") return "gpt-4o";
  if (provider === "ollama") return "llama3.2";
  return "claude-opus-4-6";
}

async function streamAnthropic(
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  model: string,
): Promise<LLMResult> {
  const messageStream = getAnthropicClient().messages.stream({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  return {
    stream: messageStream as unknown as LLMStream,
    getUsage: async () => {
      const msg = await messageStream.finalMessage();
      return { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens };
    },
  };
}

async function streamOpenAI(
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  model: string,
): Promise<LLMResult> {
  const stream = await getOpenAIClient().chat.completions.create({
    model,
    max_completion_tokens: maxTokens,
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
  });

  let usage: TokenUsage = { input_tokens: 0, output_tokens: 0 };

  async function* adapt(): AsyncGenerator<LLMChunk> {
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) {
        yield {
          type: "content_block_delta",
          delta: { type: "text_delta", text },
        };
      }
      if (chunk.usage) {
        usage = {
          input_tokens: chunk.usage.prompt_tokens ?? 0,
          output_tokens: chunk.usage.completion_tokens ?? 0,
        };
      }
    }
  }

  return {
    stream: adapt(),
    getUsage: async () => usage,
  };
}

async function streamOllama(
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  model: string,
): Promise<LLMResult> {
  const stream = await getOllamaClient().chat.completions.create({
    model,
    max_tokens: maxTokens,
    stream: true,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
  });

  let usage: TokenUsage = { input_tokens: 0, output_tokens: 0 };

  async function* adapt(): AsyncGenerator<LLMChunk> {
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) {
        yield {
          type: "content_block_delta",
          delta: { type: "text_delta", text },
        };
      }
      if (chunk.usage) {
        usage = {
          input_tokens: chunk.usage.prompt_tokens ?? 0,
          output_tokens: chunk.usage.completion_tokens ?? 0,
        };
      }
    }
  }

  return {
    stream: adapt(),
    getUsage: async () => usage,
  };
}

export async function streamChat(
  systemPrompt: string,
  userMessage: string,
  maxTokens = 16384,
): Promise<LLMResult> {
  const provider = getActiveProvider();
  const model = getActiveModel();

  if (provider === "openai") {
    return streamOpenAI(systemPrompt, userMessage, maxTokens, model);
  }
  if (provider === "ollama") {
    return streamOllama(systemPrompt, userMessage, maxTokens, model);
  }
  return streamAnthropic(systemPrompt, userMessage, maxTokens, model);
}
