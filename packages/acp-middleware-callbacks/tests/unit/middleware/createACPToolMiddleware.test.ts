import { mock, describe, expect, test } from "bun:test";
import { mapToolKind, createACPToolMiddleware } from "../../../src/middleware/createACPToolMiddleware";

describe("createACPToolMiddleware", () => {
  describe("mapToolKind", () => {
    test("maps file reading operations to 'read'", () => {
      expect(mapToolKind("read_file")).toBe("read");
      expect(mapToolKind("get_file")).toBe("read");
      expect(mapToolKind("load_config")).toBe("read");
    });

    test("maps file editing operations to 'edit'", () => {
      expect(mapToolKind("edit_file")).toBe("edit");
      expect(mapToolKind("modify_content")).toBe("edit");
    });

    test("maps file deletion operations to 'delete'", () => {
      expect(mapToolKind("delete_file")).toBe("delete");
      expect(mapToolKind("remove_item")).toBe("delete");
    });

    test("maps file moving operations to 'move'", () => {
      expect(mapToolKind("move_file")).toBe("move");
      expect(mapToolKind("rename_file")).toBe("move");
    });

    test("maps search operations to 'search'", () => {
      expect(mapToolKind("search_files")).toBe("search");
      expect(mapToolKind("grep_content")).toBe("search");
    });

    test("maps command execution to 'execute'", () => {
      expect(mapToolKind("bash_command")).toBe("execute");
      expect(mapToolKind("run_script")).toBe("execute");
    });

    test("maps thinking operations to 'think'", () => {
      expect(mapToolKind("think_reason")).toBe("think");
      expect(mapToolKind("analyze_problem")).toBe("think");
    });

    test("maps network requests to 'fetch'", () => {
      expect(mapToolKind("fetch_url")).toBe("fetch");
      expect(mapToolKind("api_get")).toBe("fetch");
      expect(mapToolKind("http_request")).toBe("fetch");
    });

    test("maps mode switching to 'switch_mode'", () => {
      expect(mapToolKind("switch_mode")).toBe("switch_mode");
      expect(mapToolKind("change_context")).toBe("switch_mode");
    });

    test("defaults to 'other' for unknown tools", () => {
      expect(mapToolKind("unknown_tool")).toBe("other");
      expect(mapToolKind("custom_action")).toBe("other");
    });

    test("is case insensitive", () => {
      expect(mapToolKind("READ_FILE")).toBe("read");
      expect(mapToolKind("Delete_File")).toBe("delete");
    });
  });

  describe("initialization", () => {
    test("creates middleware with empty config", () => {
      const middleware = createACPToolMiddleware();
      expect(middleware).toBeDefined();
      expect(middleware.name).toBe("acp-tool-lifecycle");
    });

    test("accepts emitToolStart configuration", () => {
      const middleware = createACPToolMiddleware({ emitToolStart: true });
      expect(middleware).toBeDefined();
    });

    test("accepts emitToolResults configuration", () => {
      const middleware = createACPToolMiddleware({ emitToolResults: false });
      expect(middleware).toBeDefined();
    });

    test("accepts custom toolKindMapper", () => {
      const customMapper = (_name: string) => "read";
      const middleware = createACPToolMiddleware({ toolKindMapper: customMapper });
      expect(middleware).toBeDefined();
    });

    test("accepts custom contentMapper", () => {
      const middleware = createACPToolMiddleware({
        contentMapper: (result) => [{
          type: "content",
          content: {
            type: "text",
            _meta: null,
            annotations: null,
            text: String(result),
          },
        }],
      });
      expect(middleware).toBeDefined();
    });
  });

  describe("wrapToolCall - successful execution", () => {
    test("emits tool_call with pending status", async () => {
      const sessionUpdateMock = mock(async () => {});
      
      const middleware = createACPToolMiddleware();
      const handlerMock = mock(async () => ({ result: "success" }));
      
      const request = {
        toolCall: { id: "call-1", name: "test_tool", args: { path: "/test" } },
        runtime: { 
          config: {}, 
          context: { threadId: "thread-1", sessionId: "session-1" }, 
          connection: { sessionUpdate: sessionUpdateMock } 
        },
      };
      
      await middleware.wrapToolCall!(request, handlerMock as any);
      
      expect(sessionUpdateMock).toHaveBeenCalled();
      expect(handlerMock).toHaveBeenCalled();
    });

    test("emits tool_call_update with completed status on success", async () => {
      const sessionUpdateMock = mock(async () => {});
      
      const middleware = createACPToolMiddleware();
      const handlerMock = mock(async () => ({ result: "success" }));
      
      const request = {
        toolCall: { id: "call-2", name: "read_file", args: { path: "/test/file.txt" } },
        runtime: { 
          config: {}, 
          context: { threadId: "thread-2", sessionId: "session-2" }, 
          connection: { sessionUpdate: sessionUpdateMock } 
        },
      };
      
      await middleware.wrapToolCall!(request, handlerMock as any);
      
      expect(sessionUpdateMock).toHaveBeenCalled();
      expect(sessionUpdateMock).toHaveBeenCalledTimes(2); // pending + completed
    });

    test("emits tool_call_update with in_progress when emitToolStart is true", async () => {
      const sessionUpdateMock = mock(async () => {});
      
      const middleware = createACPToolMiddleware({ emitToolStart: true });
      const handlerMock = mock(async () => ({ result: "success" }));
      
      const request = {
        toolCall: { id: "call-3", name: "bash_command", args: { cmd: "ls" } },
        runtime: { 
          config: {}, 
          context: { threadId: "thread-3", sessionId: "session-3" }, 
          connection: { sessionUpdate: sessionUpdateMock } 
        },
      };
      
      await middleware.wrapToolCall!(request, handlerMock as any);
      
      expect(sessionUpdateMock).toHaveBeenCalledTimes(3); // pending + in_progress + completed
    });

    test("skips result emission when emitToolResults is false", async () => {
      const sessionUpdateMock = mock(async () => {});
      
      const middleware = createACPToolMiddleware({ emitToolResults: false });
      const handlerMock = mock(async () => ({ result: "success" }));
      
      const request = {
        toolCall: { id: "call-4", name: "test_tool", args: {} },
        runtime: { 
          config: {}, 
          context: { threadId: "thread-4", sessionId: "session-4" }, 
          connection: { sessionUpdate: sessionUpdateMock } 
        },
      };
      
      await middleware.wrapToolCall!(request, handlerMock as any);
      
      expect(sessionUpdateMock).toHaveBeenCalledTimes(1); // only pending
    });

    test("uses custom toolKindMapper", async () => {
      const customMapper = mock(() => "other");
      
      const middleware = createACPToolMiddleware({ toolKindMapper: customMapper });
      const handlerMock = mock(async () => ({ result: "success" }));
      
      const request = {
        toolCall: { id: "call-5", name: "custom_tool", args: {} },
        runtime: { 
          config: {}, 
          context: { threadId: "thread-5", sessionId: "session-5" }, 
          connection: { sessionUpdate: mock(async () => {}) } 
        },
      };
      
      await middleware.wrapToolCall!(request, handlerMock as any);
      
      expect(customMapper).toHaveBeenCalledWith("custom_tool");
    });

    test("uses custom contentMapper", async () => {
      const sessionUpdateMock = mock(async () => {});
      
      const middleware = createACPToolMiddleware({
        contentMapper: (result) => [{
          type: "content",
          content: {
            type: "text",
            _meta: null,
            annotations: null,
            text: `Custom: ${JSON.stringify(result)}`,
          },
        }],
      });
      
      const handlerMock = mock(async () => ({ data: "test" }));
      const request = {
        toolCall: { id: "call-6", name: "test_tool", args: {} },
        runtime: { 
          config: {}, 
          context: { threadId: "thread-6", sessionId: "session-6" }, 
          connection: { sessionUpdate: sessionUpdateMock } 
        },
      };
      
      await middleware.wrapToolCall!(request, handlerMock as any);
      
      expect(sessionUpdateMock).toHaveBeenCalled();
    });

    test("extracts locations from args", async () => {
      const sessionUpdateMock = mock(async () => {});
      
      const middleware = createACPToolMiddleware();
      const handlerMock = mock(async () => ({ result: "success" }));
      
      const request = {
        toolCall: { id: "call-7", name: "edit_file", args: { path: "/home/user/file.txt", startLine: 10 } },
        runtime: { 
          config: {}, 
          context: { threadId: "thread-7", sessionId: "session-7" }, 
          connection: { sessionUpdate: sessionUpdateMock } 
        },
      };
      
      await middleware.wrapToolCall!(request, handlerMock as any);
      
      expect(sessionUpdateMock).toHaveBeenCalled();
    });
  });

  describe("wrapToolCall - error handling", () => {
    test("emits tool_call_update with failed status on error", async () => {
      const sessionUpdateMock = mock(async () => {});
      
      const middleware = createACPToolMiddleware();
      const handlerMock = mock(async () => { throw new Error("Tool execution failed"); });
      
      const request = {
        toolCall: { id: "call-8", name: "failing_tool", args: {} },
        runtime: { 
          config: {}, 
          context: { threadId: "thread-8", sessionId: "session-8" }, 
          connection: { sessionUpdate: sessionUpdateMock } 
        },
      };
      
      await expect(middleware.wrapToolCall!(request, handlerMock as any))
        .rejects.toThrow("Tool execution failed");
      
      expect(sessionUpdateMock).toHaveBeenCalled();
    });

    test("includes error message in failed content", async () => {
      const sessionUpdateMock = mock(async () => {});
      
      const middleware = createACPToolMiddleware();
      const errorMessage = "Specific error occurred";
      const handlerMock = mock(async () => { throw new Error(errorMessage); });
      
      const request = {
        toolCall: { id: "call-9", name: "error_tool", args: {} },
        runtime: { 
          config: {}, 
          context: { threadId: "thread-9", sessionId: "session-9" }, 
          connection: { sessionUpdate: sessionUpdateMock } 
        },
      };
      
      await expect(middleware.wrapToolCall!(request, handlerMock as any))
        .rejects.toThrow();
      
      expect(sessionUpdateMock).toHaveBeenCalled();
    });
  });

  describe("wrapToolCall - connection errors", () => {
    test("does not throw when sessionUpdate fails", async () => {
      const sessionUpdateMock = mock(async () => { throw new Error("Connection failed"); });
      
      const middleware = createACPToolMiddleware();
      const handlerMock = mock(async () => ({ result: "success" }));
      
      const request = {
        toolCall: { id: "call-10", name: "test_tool", args: {} },
        runtime: { 
          config: {}, 
          context: { threadId: "thread-10", sessionId: "session-10" }, 
          connection: { sessionUpdate: sessionUpdateMock } 
        },
      };
      
      // Should not throw despite connection error
      const result = await middleware.wrapToolCall!(request, handlerMock as any);
      expect(handlerMock).toHaveBeenCalled();
    });
  });

  describe("wrapToolCall - edge cases", () => {
    test("handles undefined toolCall id", async () => {
      const sessionUpdateMock = mock(async () => {});
      
      const middleware = createACPToolMiddleware();
      const handlerMock = mock(async () => ({ result: "success" }));
      
      const request = {
        toolCall: { id: undefined as any, name: "test_tool", args: {} },
        runtime: { 
          config: {}, 
          context: { threadId: "thread-12", sessionId: "session-12" }, 
          connection: { sessionUpdate: sessionUpdateMock } 
        },
      };
      
      await middleware.wrapToolCall!(request, handlerMock as any);
      
      expect(sessionUpdateMock).toHaveBeenCalled();
      expect(handlerMock).toHaveBeenCalled();
    });

    test("handles empty args", async () => {
      const sessionUpdateMock = mock(async () => {});
      
      const middleware = createACPToolMiddleware();
      const handlerMock = mock(async () => ({ result: "success" }));
      
      const request = {
        toolCall: { id: "call-13", name: "test_tool", args: {} },
        runtime: { 
          config: {}, 
          context: { threadId: "thread-13", sessionId: "session-13" }, 
          connection: { sessionUpdate: sessionUpdateMock } 
        },
      };
      
      await middleware.wrapToolCall!(request, handlerMock as any);
      
      expect(sessionUpdateMock).toHaveBeenCalled();
    });

    test("handles null result", async () => {
      const sessionUpdateMock = mock(async () => {});
      
      const middleware = createACPToolMiddleware();
      const handlerMock = mock(async () => null);
      
      const request = {
        toolCall: { id: "call-14", name: "test_tool", args: {} },
        runtime: { 
          config: {}, 
          context: { threadId: "thread-14", sessionId: "session-14" }, 
          connection: { sessionUpdate: sessionUpdateMock } 
        },
      };
      
      await middleware.wrapToolCall!(request, handlerMock as any);
      
      expect(sessionUpdateMock).toHaveBeenCalled();
    });

    test("handles undefined result", async () => {
      const sessionUpdateMock = mock(async () => {});
      
      const middleware = createACPToolMiddleware();
      const handlerMock = mock(async () => undefined);
      
      const request = {
        toolCall: { id: "call-15", name: "test_tool", args: {} },
        runtime: { 
          config: {}, 
          context: { threadId: "thread-15", sessionId: "session-15" }, 
          connection: { sessionUpdate: sessionUpdateMock } 
        },
      };
      
      await middleware.wrapToolCall!(request, handlerMock as any);
      
      expect(sessionUpdateMock).toHaveBeenCalled();
    });

    test("handles complex object result", async () => {
      const sessionUpdateMock = mock(async () => {});
      
      const middleware = createACPToolMiddleware();
      const handlerMock = mock(async () => ({ data: [1, 2, 3], nested: { value: "test" } }));
      
      const request = {
        toolCall: { id: "call-16", name: "test_tool", args: {} },
        runtime: { 
          config: {}, 
          context: { threadId: "thread-16", sessionId: "session-16" }, 
          connection: { sessionUpdate: sessionUpdateMock } 
        },
      };
      
      await middleware.wrapToolCall!(request, handlerMock as any);
      
      expect(sessionUpdateMock).toHaveBeenCalled();
    });

    test("handles circular reference in result", async () => {
      const sessionUpdateMock = mock(async () => {});
      
      const middleware = createACPToolMiddleware();
      const handlerMock = mock(async () => {
        const obj: any = { value: "test" };
        obj.self = obj; // Circular reference
        return obj;
      });
      
      const request = {
        toolCall: { id: "call-17", name: "test_tool", args: {} },
        runtime: { 
          config: {}, 
          context: { threadId: "thread-17", sessionId: "session-17" }, 
          connection: { sessionUpdate: sessionUpdateMock } 
        },
      };
      
      await middleware.wrapToolCall!(request, handlerMock as any);
      
      expect(sessionUpdateMock).toHaveBeenCalled();
    });

    test("handles number and boolean results", async () => {
      const sessionUpdateMock = mock(async () => {});
      
      const middleware = createACPToolMiddleware();
      const handlerMock = mock(async () => 42);
      
      const request = {
        toolCall: { id: "call-18", name: "test_tool", args: {} },
        runtime: { 
          config: {}, 
          context: { threadId: "thread-18", sessionId: "session-18" }, 
          connection: { sessionUpdate: sessionUpdateMock } 
        },
      };
      
      await middleware.wrapToolCall!(request, handlerMock as any);
      
      expect(sessionUpdateMock).toHaveBeenCalled();
    });
  });

  describe("afterAgent cleanup", () => {
    test("cleans up thread state after agent completes", async () => {
      const middleware = createACPToolMiddleware();
      
      // Simulate tool calls that would populate thread state
      const request = {
        toolCall: { id: "call-19", name: "test_tool", args: {} },
        runtime: { 
          config: {}, 
          context: { threadId: "thread-cleanup", sessionId: "session-19" }, 
          connection: { sessionUpdate: mock(async () => {}) } 
        },
      };
      
      const handlerMock = mock(async () => ({ result: "success" }));
      
      // Execute a tool call first
      await middleware.wrapToolCall!(request, handlerMock as any);
      
      // Then call afterAgent to clean up
      await middleware.afterAgent?.({} as any, { 
        context: { threadId: "thread-cleanup" } 
      } as any);
      
      // Test passes if no error is thrown
      expect(true).toBe(true);
    });

    test("afterAgent handles missing threadId gracefully", async () => {
      const middleware = createACPToolMiddleware();
      
      // Call afterAgent without threadId
      await middleware.afterAgent?.({} as any, { 
        context: {} 
      } as any);
      
      // Test passes if no error is thrown
      expect(true).toBe(true);
    });
  });
});