import { describe, it, expect } from "bun:test";
import { 
  HumanMessage, 
  AIMessage, 
  ToolMessage, 
  SystemMessage,
  ChatMessage
} from "@langchain/core/messages";
// @ts-ignore - Utility doesn't exist yet (TDD Red Phase)
import { mapLangChainMessageToAGUI } from "../../../src/utils/messageMapper";

describe("messageMapper", () => {
  it("should map HumanMessage to user role", () => {
    const message = new HumanMessage("Hello");
    const mapped = mapLangChainMessageToAGUI(message);
    expect(mapped.role).toBe("user");
    expect(mapped.content).toBe("Hello");
    expect(mapped.id).toBeDefined();
  });

  it("should map AIMessage with tool calls", () => {
    const message = new AIMessage({
      content: "Thinking...",
      tool_calls: [{
        id: "call_1",
        name: "get_weather",
        args: { location: "NYC" }
      }]
    });
    const mapped = mapLangChainMessageToAGUI(message);
    expect(mapped.role).toBe("assistant");
    expect(mapped.content).toBe("Thinking...");
    expect(mapped.tool_calls).toHaveLength(1);
    expect(mapped.tool_calls?.[0]).toEqual({
      id: "call_1",
      type: "function",
      function: {
        name: "get_weather",
        arguments: '{"location":"NYC"}'
      }
    });
  });

  it("should map ToolMessage to tool role", () => {
    const message = new ToolMessage({
      content: '{"temp": 22}',
      tool_call_id: "call_1"
    });
    const mapped = mapLangChainMessageToAGUI(message);
    expect(mapped.role).toBe("tool");
    expect(mapped.content).toBe('{"temp": 22}');
    expect(mapped.tool_call_id).toBe("call_1");
  });

  it("should map SystemMessage to system role", () => {
    const message = new SystemMessage("System prompt");
    const mapped = mapLangChainMessageToAGUI(message);
    expect(mapped.role).toBe("system");
    expect(mapped.content).toBe("System prompt");
  });

  it("should map ChatMessage with custom role", () => {
    const message = new ChatMessage("Custom content", "developer");
    const mapped = mapLangChainMessageToAGUI(message);
    expect(mapped.role).toBe("developer");
    expect(mapped.content).toBe("Custom content");
  });

  it("should preserve message ID if present in metadata", () => {
    const message = new HumanMessage({
      content: "Hello",
      id: "existing-id"
    });
    const mapped = mapLangChainMessageToAGUI(message);
    expect(mapped.id).toBe("existing-id");
  });
});
