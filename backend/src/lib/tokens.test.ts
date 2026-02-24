import { describe, it, expect } from "vitest";
import { TokenAccumulator } from "./tokens.js";

describe("TokenAccumulator", () => {
  it("accumulates tokens across multiple calls", () => {
    const acc = new TokenAccumulator();
    acc.add({ input_tokens: 1000, output_tokens: 500 });
    acc.add({ input_tokens: 2000, output_tokens: 1000 });

    const summary = acc.summarize("claude-opus-4-6");
    expect(summary.input_tokens).toBe(3000);
    expect(summary.output_tokens).toBe(1500);
    expect(summary.total_tokens).toBe(4500);
    expect(summary.llm_calls).toBe(2);
  });

  it("calculates Anthropic Opus pricing correctly", () => {
    const acc = new TokenAccumulator();
    // 1M input + 1M output at Opus pricing ($15/$75)
    acc.add({ input_tokens: 1_000_000, output_tokens: 1_000_000 });

    const summary = acc.summarize("claude-opus-4-6");
    expect(summary.estimated_cost_usd).toBe(90); // $15 input + $75 output
  });

  it("calculates Anthropic Sonnet pricing correctly", () => {
    const acc = new TokenAccumulator();
    acc.add({ input_tokens: 100_000, output_tokens: 50_000 });

    const summary = acc.summarize("claude-sonnet-4-6");
    // $3/M input: 100k = $0.30, $15/M output: 50k = $0.75
    expect(summary.estimated_cost_usd).toBe(1.05);
  });

  it("calculates OpenAI GPT-4o pricing correctly", () => {
    const acc = new TokenAccumulator();
    acc.add({ input_tokens: 100_000, output_tokens: 50_000 });

    const summary = acc.summarize("gpt-4o");
    // $2.50/M input: 100k = $0.25, $10/M output: 50k = $0.50
    expect(summary.estimated_cost_usd).toBe(0.75);
  });

  it("returns $0 for Ollama models", () => {
    const acc = new TokenAccumulator();
    acc.add({ input_tokens: 500_000, output_tokens: 200_000 });

    const summary = acc.summarize("llama3.2");
    expect(summary.estimated_cost_usd).toBe(0);
  });

  it("returns $0 for unknown models", () => {
    const acc = new TokenAccumulator();
    acc.add({ input_tokens: 100_000, output_tokens: 50_000 });

    const summary = acc.summarize("some-random-model");
    expect(summary.estimated_cost_usd).toBe(0);
  });

  it("handles zero usage", () => {
    const acc = new TokenAccumulator();
    const summary = acc.summarize("claude-opus-4-6");
    expect(summary.total_tokens).toBe(0);
    expect(summary.llm_calls).toBe(0);
    expect(summary.estimated_cost_usd).toBe(0);
  });

  it("handles multiple small calls", () => {
    const acc = new TokenAccumulator();
    for (let i = 0; i < 10; i++) {
      acc.add({ input_tokens: 1000, output_tokens: 500 });
    }
    const summary = acc.summarize("gpt-4o-mini");
    expect(summary.llm_calls).toBe(10);
    expect(summary.total_tokens).toBe(15000);
    // $0.15/M input: 10k = $0.0015, $0.60/M output: 5k = $0.003
    expect(summary.estimated_cost_usd).toBe(0.0045);
  });
});
