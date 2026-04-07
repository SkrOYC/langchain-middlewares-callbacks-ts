/**
 * Test Helper Module for AG-UI Middleware
 *
 * Provides realistic mock models for unit and adapter testing.
 */

import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  AIMessage,
  AIMessageChunk,
  type BaseMessage,
} from "@langchain/core/messages";

interface GeneratedResponse {
  generations: Array<{
    text: unknown;
    message: AIMessage;
    generationInfo: Record<string, unknown>;
  }>;
  llmOutput: Record<string, unknown>;
}

/**
 * Mock chat model that extends BaseChatModel for proper createAgent integration
 */
class MockChatModel extends BaseChatModel {
  private readonly responses: AIMessage[];
  private responseIndex = 0;

  constructor(responses: Array<string | AIMessage>) {
    super({
      temperature: 0,
      callbacks: undefined,
      tags: undefined,
      metadata: undefined,
    });

    this.responses = responses.map((response) => {
      if (response instanceof AIMessage) {
        return response;
      }
      return new AIMessage({
        content: response,
        additional_kwargs: {},
        response_metadata: {},
      });
    });
  }

  bindTools(_tools: unknown[]) {
    const bound = new MockChatModel(this.responses);
    bound.responseIndex = this.responseIndex;
    return Promise.resolve(bound);
  }

  protected _generate(
    _messages: BaseMessage[],
    _options: Record<string, unknown>,
    _runManager?: unknown
  ): Promise<GeneratedResponse> {
    const response = this.responses[this.responseIndex % this.responses.length];
    this.responseIndex++;

    return Promise.resolve({
      generations: [
        {
          text: response.content,
          message: response,
          generationInfo: {},
        },
      ],
      llmOutput: {},
    });
  }

  override async *_streamResponseChunks(
    _messages: BaseMessage[],
    _options: Record<string, unknown>,
    _runManager?: unknown
  ): AsyncGenerator<{
    message: AIMessageChunk;
    generationInfo: Record<string, unknown>;
  }> {
    const response = this.responses[this.responseIndex % this.responses.length];
    this.responseIndex++;

    await Promise.resolve();

    const content = response.content || "";
    const chunks =
      typeof content === "string" ? [...content].filter(Boolean) : [];

    for (const chunk of chunks) {
      yield {
        message: new AIMessageChunk({
          content: chunk,
          additional_kwargs: {},
          response_metadata: {},
        }),
        generationInfo: {},
      };
    }
  }

  _llmType(): string {
    return "mock_chat_model";
  }

  _call(
    _messages: BaseMessage[],
    _options: Record<string, unknown>,
    _runManager?: unknown
  ): Promise<string> {
    const response = this.responses[this.responseIndex % this.responses.length];
    this.responseIndex++;
    return Promise.resolve(response.content);
  }
}

/**
 * Creates a mock model for simple text responses
 */
export function createTextModel(
  textResponses: Array<string | AIMessage>
): MockChatModel {
  return new MockChatModel(textResponses);
}
