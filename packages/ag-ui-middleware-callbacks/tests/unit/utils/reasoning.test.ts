import { test, expect, describe } from "bun:test";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { mapLangChainMessageToAGUI } from "../../../src/utils/messageMapper";

describe("messageMapper reasoning support", () => {
  test("maps AIMessage with reasoning_content to reasoning role", () => {
    const msg = new AIMessage({
      content: "",
      additional_kwargs: {
        reasoning_content: "I am thinking about math"
      }
    });
    
    const result = mapLangChainMessageToAGUI(msg);
    expect(result.role).toBe("reasoning");
    expect(result.content).toBe("I am thinking about math");
  });

  test("maps AIMessage with reasoning (OpenAI o1 style) to reasoning role", () => {
    const msg = new AIMessage({
      content: "",
      additional_kwargs: {
        reasoning: { text: "Thought process" }
      }
    });
    
    const result = mapLangChainMessageToAGUI(msg);
    expect(result.role).toBe("reasoning");
    expect(result.content).toBe("Thought process");
  });

  test("prefers assistant role if content is present even if reasoning is there", () => {
    const msg = new AIMessage({
      content: "Final answer",
      additional_kwargs: {
        reasoning_content: "Thought process"
      }
    });
    
    const result = mapLangChainMessageToAGUI(msg);
    expect(result.role).toBe("assistant");
    expect(result.content).toBe("Final answer");
  });
});
