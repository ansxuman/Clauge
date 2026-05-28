// Provider × Model registry — TypeScript mirror of
// `src-tauri/src/shared/ai/providers.rs`.
//
// Single source of truth for the provider dropdowns and model badges in the
// Settings AI tab, AIPanel header, and onboarding screen. Rust drives the
// actual request — this file exists so the UI doesn't have to keep its own
// hardcoded list in lockstep.

export type ProviderId =
  | 'claude'
  | 'groq'
  | 'mistral'
  | 'openai_gh'
  | 'nvidia'
  | 'openrouter'
  | 'openai_direct'
  | 'gemini'
  | 'local';

export type ApiKind = 'anthropicMessages' | 'openAICompat';

export interface ProviderConfig {
  providerId: ProviderId;
  modelId: string;
  /** Full descriptive name, e.g. "Claude Haiku 4.5". */
  displayName: string;
  /** Short label shown in dropdowns, e.g. "Claude (Anthropic)". */
  providerLabel: string;
  /** Short model name shown in the model badge, e.g. "Haiku 4.5". */
  modelLabel: string;
  apiUrl: string;
  apiKind: ApiKind;
  maxInputTokens: number;
  maxOutputTokens: number;
  defaultTemperature: number;
  supportsCaching: boolean;
  supportsParallelTools: boolean;
  supportsThinking: boolean;
  /** None = no soft cap. */
  dailyTokenBudget: number | null;
  /** Settings key holding the API key for this provider. */
  keySettingName: string;
  /** Required key prefix for client-side validation, or `null`. */
  keyPrefix: string | null;
  /** Placeholder shown in the API key input. */
  keyPlaceholder: string;
  /** External URL where the user can obtain a key. */
  keyUrl: string;
}

export const PROVIDERS: ProviderConfig[] = [
  {
    providerId: 'claude',
    modelId: 'claude-haiku-4-5-20251001',
    displayName: 'Claude Haiku 4.5',
    providerLabel: 'Claude (Anthropic)',
    modelLabel: 'Haiku 4.5',
    apiUrl: 'https://api.anthropic.com/v1/messages',
    apiKind: 'anthropicMessages',
    maxInputTokens: 200_000,
    maxOutputTokens: 4096,
    defaultTemperature: 1.0,
    supportsCaching: true,
    supportsParallelTools: false,
    supportsThinking: true,
    dailyTokenBudget: null,
    keySettingName: 'ai_api_key_claude',
    keyPrefix: 'sk-ant-',
    keyPlaceholder: 'sk-ant-api03-...',
    keyUrl: 'https://console.anthropic.com',
  },
  {
    providerId: 'groq',
    modelId: 'meta-llama/llama-4-scout-17b-16e-instruct',
    displayName: 'Llama 4 Scout 17B (Groq)',
    providerLabel: 'Groq',
    modelLabel: 'Llama 4 Scout 17B',
    apiUrl: 'https://api.groq.com/openai/v1/chat/completions',
    apiKind: 'openAICompat',
    maxInputTokens: 128_000,
    maxOutputTokens: 4096,
    defaultTemperature: 0.1,
    supportsCaching: false,
    supportsParallelTools: true,
    supportsThinking: false,
    dailyTokenBudget: null,
    keySettingName: 'ai_api_key_groq',
    keyPrefix: 'gsk_',
    keyPlaceholder: 'gsk_...',
    keyUrl: 'https://console.groq.com/keys',
  },
  {
    providerId: 'mistral',
    modelId: 'mistral-large-latest',
    displayName: 'Mistral Large',
    providerLabel: 'Mistral AI',
    modelLabel: 'Mistral Large 3',
    apiUrl: 'https://api.mistral.ai/v1/chat/completions',
    apiKind: 'openAICompat',
    maxInputTokens: 128_000,
    maxOutputTokens: 4096,
    defaultTemperature: 0.1,
    supportsCaching: false,
    supportsParallelTools: true,
    supportsThinking: false,
    dailyTokenBudget: null,
    keySettingName: 'ai_api_key_mistral',
    keyPrefix: null,
    keyPlaceholder: 'API key...',
    keyUrl: 'https://console.mistral.ai/api-keys',
  },
  {
    providerId: 'openai_gh',
    modelId: 'gpt-4.1-mini',
    displayName: 'GPT-4.1 Mini (GitHub Models)',
    providerLabel: 'OpenAI (GitHub)',
    modelLabel: 'GPT-4.1 Mini',
    apiUrl: 'https://models.inference.ai.azure.com/chat/completions',
    apiKind: 'openAICompat',
    maxInputTokens: 128_000,
    maxOutputTokens: 4096,
    defaultTemperature: 0.1,
    supportsCaching: false,
    supportsParallelTools: true,
    supportsThinking: false,
    dailyTokenBudget: null,
    keySettingName: 'ai_api_key_openai_gh',
    keyPrefix: null,
    keyPlaceholder: 'GitHub token...',
    keyUrl: 'https://github.com/marketplace/models',
  },
  {
    providerId: 'nvidia',
    modelId: 'nvidia/nemotron-3-super-120b-a12b',
    displayName: 'Nemotron 3 Super 120B (NVIDIA NIM)',
    providerLabel: 'NVIDIA NIM',
    modelLabel: 'Nemotron 3 Super 120B',
    apiUrl: 'https://integrate.api.nvidia.com/v1/chat/completions',
    apiKind: 'openAICompat',
    maxInputTokens: 128_000,
    maxOutputTokens: 4096,
    defaultTemperature: 0.1,
    supportsCaching: false,
    supportsParallelTools: true,
    supportsThinking: false,
    dailyTokenBudget: null,
    keySettingName: 'ai_api_key_nvidia',
    keyPrefix: null,
    keyPlaceholder: 'API key...',
    keyUrl: 'https://build.nvidia.com',
  },
  {
    providerId: 'openrouter',
    modelId: 'meta-llama/llama-3.3-70b-instruct:free',
    displayName: 'Llama 3.3 70B (OpenRouter)',
    providerLabel: 'OpenRouter',
    modelLabel: 'Llama 3.3 70B',
    apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
    apiKind: 'openAICompat',
    maxInputTokens: 128_000,
    maxOutputTokens: 4096,
    defaultTemperature: 0.1,
    supportsCaching: false,
    supportsParallelTools: true,
    supportsThinking: false,
    dailyTokenBudget: null,
    keySettingName: 'ai_api_key_openrouter',
    keyPrefix: null,
    keyPlaceholder: 'sk-or-...',
    keyUrl: 'https://openrouter.ai/keys',
  },
  {
    providerId: 'openai_direct',
    modelId: 'gpt-4.1-mini',
    displayName: 'GPT-4.1 Mini',
    providerLabel: 'OpenAI',
    modelLabel: 'GPT-4.1 Mini',
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    apiKind: 'openAICompat',
    maxInputTokens: 128_000,
    maxOutputTokens: 4096,
    defaultTemperature: 0.1,
    supportsCaching: false,
    supportsParallelTools: true,
    supportsThinking: false,
    dailyTokenBudget: null,
    keySettingName: 'ai_api_key_openai_direct',
    keyPrefix: 'sk-',
    keyPlaceholder: 'sk-...',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    providerId: 'gemini',
    modelId: 'gemini-3.1-flash-lite',
    displayName: 'Gemini 3.1 Flash-Lite',
    providerLabel: 'Google Gemini',
    modelLabel: 'Gemini 3.1 Flash-Lite',
    apiUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    apiKind: 'openAICompat',
    maxInputTokens: 1_000_000,
    maxOutputTokens: 4096,
    defaultTemperature: 0.1,
    supportsCaching: false,
    supportsParallelTools: true,
    supportsThinking: false,
    dailyTokenBudget: null,
    keySettingName: 'ai_api_key_gemini',
    keyPrefix: null,
    keyPlaceholder: 'API key...',
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  {
    // Local / self-hosted OpenAI-compatible server. apiUrl + modelId are
    // user-configurable (settings keys `ai_local_base_url` / `ai_local_model`)
    // — the values here are only UI defaults. No API key required.
    providerId: 'local',
    modelId: '',
    displayName: 'Local Model',
    providerLabel: 'Local (OpenAI-compatible)',
    modelLabel: 'Local',
    apiUrl: 'http://localhost:11434/v1/chat/completions',
    apiKind: 'openAICompat',
    maxInputTokens: 128_000,
    maxOutputTokens: 4096,
    defaultTemperature: 0.1,
    supportsCaching: false,
    supportsParallelTools: true,
    supportsThinking: false,
    dailyTokenBudget: null,
    keySettingName: '',
    keyPrefix: null,
    keyPlaceholder: 'Optional — leave blank for Ollama',
    keyUrl: 'https://ollama.com',
  },
];

/** Exact (provider, model) lookup. */
export function getProviderConfig(provider: ProviderId, modelId: string): ProviderConfig | undefined {
  return PROVIDERS.find((p) => p.providerId === provider && p.modelId === modelId);
}

/** Returns the registry default for a provider (first entry). */
export function getDefaultModelFor(provider: ProviderId): ProviderConfig | undefined {
  return PROVIDERS.find((p) => p.providerId === provider);
}

/** All registered models for a provider, in registry order. */
export function listModelsFor(provider: ProviderId): ProviderConfig[] {
  return PROVIDERS.filter((p) => p.providerId === provider);
}

/** Distinct provider ids in registry order. */
export function listAllProviders(): ProviderId[] {
  const seen: ProviderId[] = [];
  for (const cfg of PROVIDERS) {
    if (!seen.includes(cfg.providerId)) seen.push(cfg.providerId);
  }
  return seen;
}
