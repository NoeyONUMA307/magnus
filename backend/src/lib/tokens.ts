import type { TokenUsage } from "./llm.js";

export interface TokenSummary {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  llm_calls: number;
  estimated_cost_usd: number;
}

interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

const PRICING: Record<string, ModelPricing> = {
  // Anthropic
  "claude-opus-4-6":       { inputPerMillion: 15,   outputPerMillion: 75 },
  "claude-sonnet-4-6":     { inputPerMillion: 3,    outputPerMillion: 15 },
  "claude-haiku-4-5-20251001": { inputPerMillion: 0.80, outputPerMillion: 4 },
  // OpenAI
  "gpt-5.2":               { inputPerMillion: 1.75, outputPerMillion: 14 },
  "gpt-5.1":               { inputPerMillion: 1.25, outputPerMillion: 10 },
  "o4-mini":               { inputPerMillion: 1.10, outputPerMillion: 4.40 },
  "gpt-4o":                { inputPerMillion: 2.50, outputPerMillion: 10 },
  "gpt-4o-mini":           { inputPerMillion: 0.15, outputPerMillion: 0.60 },
  "o3":                    { inputPerMillion: 10,   outputPerMillion: 40 },
  "o3-mini":               { inputPerMillion: 1.10, outputPerMillion: 4.40 },
};

function getPricing(model: string): ModelPricing {
  if (PRICING[model]) return PRICING[model];
  // Fuzzy match: check if any key is a prefix
  for (const [key, pricing] of Object.entries(PRICING)) {
    if (model.startsWith(key)) return pricing;
  }
  // Ollama / unknown models: free
  return { inputPerMillion: 0, outputPerMillion: 0 };
}

export class TokenAccumulator {
  private input = 0;
  private output = 0;
  private calls = 0;

  add(usage: TokenUsage): void {
    this.input += usage.input_tokens;
    this.output += usage.output_tokens;
    this.calls++;
  }

  summarize(model: string): TokenSummary {
    const pricing = getPricing(model);
    const inputCost = (this.input / 1_000_000) * pricing.inputPerMillion;
    const outputCost = (this.output / 1_000_000) * pricing.outputPerMillion;
    return {
      input_tokens: this.input,
      output_tokens: this.output,
      total_tokens: this.input + this.output,
      llm_calls: this.calls,
      estimated_cost_usd: parseFloat((inputCost + outputCost).toFixed(4)),
    };
  }
}
