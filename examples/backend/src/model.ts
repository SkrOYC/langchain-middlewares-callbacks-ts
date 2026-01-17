/**
 * Model Configuration
 * 
 * This file provides configuration for different LLM models and providers,
 * supporting Anthropic, OpenAI, and local models.
 */

import { ChatOpenAI, ChatOpenAIResponses } from "@langchain/openai";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";

/**
 * Model provider types
 */
export type ModelProvider = "openai" | "openai-responses" | "local";

/**
 * Configuration for a model
 */
export interface ModelConfigInterface {
  provider: ModelProvider;
  modelName: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Default model configurations
 */
const DEFAULT_CONFIGS: Record<string, ModelConfigInterface> = {
  "gpt-5-nano": {
    provider: "openai-responses",
    modelName: "gpt-5-nano",
    temperature: 0.7,
    maxTokens: 4096,
    baseUrl: "https://opencode.ai/zen/v1",
  },
};

/**
 * ModelConfig class for managing LLM configurations
 */
export class ModelConfig implements ModelConfigInterface {
  provider: ModelProvider;
  modelName: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  private modelInstance: BaseChatModel | null = null;

  /**
   * Create a model configuration
   */
  constructor(config?: string | ModelConfigInterface) {
    if (typeof config === "string") {
      // Use default configuration for known models
      const defaultConfig = DEFAULT_CONFIGS[config];
      if (defaultConfig) {
        this.provider = defaultConfig.provider;
        this.modelName = defaultConfig.modelName;
        this.apiKey = defaultConfig.apiKey;
        this.baseUrl = defaultConfig.baseUrl;
        this.temperature = defaultConfig.temperature;
        this.maxTokens = defaultConfig.maxTokens;
      } else {
        // Default to OpenAI for unknown string identifiers
        this.provider = "openai";
        this.modelName = config;
        this.temperature = 0.7;
        this.maxTokens = 4096;
      }
    } else if (config) {
      // Use provided config
      this.provider = config.provider;
      this.modelName = config.modelName;
      this.apiKey = config.apiKey;
      this.baseUrl = config.baseUrl;
      this.temperature = config.temperature;
      this.maxTokens = config.maxTokens;
    } else {
      // Default configuration
      this.provider = "openai-responses";
      this.modelName = "gpt-5-nano";
      this.temperature = 0.7;
      this.maxTokens = 4096;
      this.baseUrl = "https://opencode.ai/zen/v1";
    }
  }

  /**
   * Get the current configuration
   */
  getConfig(): ModelConfigInterface {
    return {
      provider: this.provider,
      modelName: this.modelName,
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
    };
  }

  /**
   * Update the configuration
   */
  updateConfig(newConfig: Partial<ModelConfigInterface>): void {
    this.provider = newConfig.provider ?? this.provider;
    this.modelName = newConfig.modelName ?? this.modelName;
    this.apiKey = newConfig.apiKey ?? this.apiKey;
    this.baseUrl = newConfig.baseUrl ?? this.baseUrl;
    this.temperature = newConfig.temperature ?? this.temperature;
    this.maxTokens = newConfig.maxTokens ?? this.maxTokens;
    this.modelInstance = null; // Reset cached instance
  }

  /**
   * Set API key for the current provider
   */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
    this.modelInstance = null; // Reset cached instance
  }

  /**
   * Set temperature
   */
  setTemperature(temperature: number): void {
    this.temperature = Math.max(0, Math.min(1, temperature));
    this.modelInstance = null;
  }

  /**
   * Set max tokens
   */
  setMaxTokens(maxTokens: number): void {
    this.maxTokens = Math.max(1, maxTokens);
    this.modelInstance = null;
  }

  /**
   * Get or create the LangChain model instance
   */
  async getModel(): Promise<BaseChatModel> {
    if (this.modelInstance) {
      return this.modelInstance;
    }

    this.modelInstance = await this.createModel();
    return this.modelInstance;
  }

  /**
   * Create the LangChain model instance based on provider
   */
  private async createModel(): Promise<BaseChatModel> {
    // Ensure API key is always set - some endpoints (like OpenCode) require it
    // Priority: config.apiKey > env var > empty string
    const apiKey = this.apiKey || process.env.OPENAI_API_KEY || "";
    
    // Ensure environment variable is set for OpenAI SDK
    if (!process.env.OPENAI_API_KEY) {
      process.env.OPENAI_API_KEY = apiKey;
    }
    
    switch (this.provider) {
      case "openai":
        return this.createOpenAIModel(apiKey);
      case "openai-responses":
        return this.createOpenAIResponsesModel(apiKey);
      case "local":
        return this.createLocalModel();
      default:
        throw new Error(`Unknown model provider: ${this.provider}`);
    }
  }

  /**
   * Create OpenAI model
   */
  private createOpenAIModel(apiKey?: string): ChatOpenAI {
    // Ensure API key is always set - some endpoints require it even if empty
    const finalApiKey = apiKey || "";
    
    const modelConfig: Record<string, any> = {
      model: this.modelName,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
      // Use configuration object like AG-UI example
      configuration: {
        apiKey: finalApiKey,
      },
      // Enable LangChain v1 content blocks for standardized content format
      outputVersion: "v1",
    };

    if (this.baseUrl) {
      modelConfig.configuration.baseURL = this.baseUrl;
    }

    return new ChatOpenAI(modelConfig);
  }

  /**
   * Create OpenAI Responses API model (for reasoning models)
   * Uses ChatOpenAIResponses which properly handles reasoning_content in callbacks
   */
  private createOpenAIResponsesModel(apiKey?: string): ChatOpenAIResponses {
    const finalApiKey = apiKey || "";
    
    const modelConfig: Record<string, any> = {
      model: this.modelName,
      // Enable reasoning with summaries for GPT-5-Nano
      reasoning: {
        effort: "medium",
        summary: "auto",
      },
      configuration: {
        apiKey: finalApiKey,
      },
      outputVersion: "v1",
    };

    if (this.baseUrl) {
      modelConfig.configuration.baseURL = this.baseUrl;
    }

    return new ChatOpenAIResponses(modelConfig);
  }

  /**
   * Create local model (placeholder for Ollama, LM Studio, etc.)
   */
  private createLocalModel(): BaseChatModel {
    // For local models, you'd typically use a library like Ollama or LM Studio
    // This is a simplified placeholder
    console.warn("Local model support requires additional configuration");
    
    // Fallback to OpenAI-compatible format for local servers
    return new ChatOpenAI({
      model: this.modelName,
      temperature: this.temperature ?? 0.7,
      maxTokens: this.maxTokens ?? 4096,
      // Enable LangChain v1 content blocks for standardized content format
      outputVersion: "v1",
      configuration: {
        baseURL: this.baseUrl || "http://localhost:8000/v1",
        apiKey: "not-needed",
      },
    });
  }

  /**
   * Get provider name
   */
  getProvider(): ModelProvider {
    return this.provider;
  }

  /**
   * Get model name
   */
  getModelName(): string {
    return this.modelName;
  }

  /**
   * Check if model is configured with API key
   */
  isConfigured(): boolean {
    if (this.provider === "local") {
      return true; // Local models don't need API keys
    }
    
    return !!(this.apiKey || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);
  }

  /**
   * Create a model configuration from environment variables
   */
  static fromEnvironment(): ModelConfig {
    const provider = (process.env.MODEL_PROVIDER as ModelProvider) || "anthropic";
    const modelName = process.env.MODEL_NAME || "claude-sonnet-4-20250514";
    
    return new ModelConfig({
      provider,
      modelName,
      apiKey: process.env.API_KEY,
      baseUrl: process.env.BASE_URL,
      temperature: process.env.TEMPERATURE ? parseFloat(process.env.TEMPERATURE) : 0.7,
      maxTokens: process.env.MAX_TOKENS ? parseInt(process.env.MAX_TOKENS) : 4096,
    });
  }
}