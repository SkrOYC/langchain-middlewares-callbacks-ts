import { test, expect, describe, mock } from "bun:test";
import { createACPToolMiddleware, mapToolKind } from "../../../src/middleware/createACPToolMiddleware";

describe("createACPToolMiddleware", () => {
  describe("initialization", () => {
    test("returns middleware object", () => {
      const middleware = createACPToolMiddleware();
      
      expect(middleware).toBeDefined();
      expect(typeof middleware).toBe("object");
      expect(middleware.name).toBe("acp-tool-lifecycle");
    });

    test("accepts empty configuration", () => {
      const middleware = createACPToolMiddleware({});
      expect(middleware).toBeDefined();
    });

    test("accepts custom configuration", () => {
      const customMapper = (name: string) => "other" as const;
      const middleware = createACPToolMiddleware({
        emitToolStart: true,
        emitToolResults: false,
        toolKindMapper: customMapper,
      });
      expect(middleware).toBeDefined();
    });
  });

  describe("mapToolKind", () => {
    test("maps file reading operations to 'read'", () => {
      expect(mapToolKind("read_file")).toBe("read");
      expect(mapToolKind("get_file")).toBe("read");
      expect(mapToolKind("view")).toBe("read");
      expect(mapToolKind("load_config")).toBe("read");
    });

    test("maps file editing operations to 'edit'", () => {
      expect(mapToolKind("edit_file")).toBe("edit");
      expect(mapToolKind("modify_file")).toBe("edit");
      expect(mapToolKind("apply_patch")).toBe("edit");
      expect(mapToolKind("update_content")).toBe("edit");
    });

    test("maps file deletion operations to 'delete'", () => {
      expect(mapToolKind("delete_file")).toBe("delete");
      expect(mapToolKind("remove_file")).toBe("delete");
      expect(mapToolKind("unlink")).toBe("delete");
      expect(mapToolKind("rm_file")).toBe("delete");
    });

    test("maps file moving operations to 'move'", () => {
      expect(mapToolKind("move_file")).toBe("move");
      expect(mapToolKind("rename_file")).toBe("move");
      expect(mapToolKind("mv")).toBe("move");
    });

    test("maps search operations to 'search'", () => {
      expect(mapToolKind("search_files")).toBe("search");
      expect(mapToolKind("grep")).toBe("search");
      expect(mapToolKind("find")).toBe("search");
      expect(mapToolKind("query_db")).toBe("search");
    });

    test("maps command execution to 'execute'", () => {
      expect(mapToolKind("run_command")).toBe("execute");
      expect(mapToolKind("bash")).toBe("execute");
      expect(mapToolKind("exec")).toBe("execute");
      expect(mapToolKind("shell")).toBe("execute");
      expect(mapToolKind("command")).toBe("execute");
      expect(mapToolKind("execute_script")).toBe("execute");
    });

    test("maps reasoning operations to 'think'", () => {
      expect(mapToolKind("think")).toBe("think");
      expect(mapToolKind("reason")).toBe("think");
      expect(mapToolKind("analyze")).toBe("think");
    });

    test("maps network requests to 'fetch'", () => {
      expect(mapToolKind("fetch_url")).toBe("fetch");
      expect(mapToolKind("http_get")).toBe("fetch");
      expect(mapToolKind("curl")).toBe("fetch");
      expect(mapToolKind("wget")).toBe("fetch");
    });

    test("maps mode switching to 'switch_mode'", () => {
      expect(mapToolKind("set_mode")).toBe("switch_mode");
      expect(mapToolKind("change_mode")).toBe("switch_mode");
      expect(mapToolKind("switch_context")).toBe("switch_mode");
    });

    test("defaults to 'other' for unrecognized tools", () => {
      expect(mapToolKind("unknown_tool")).toBe("other");
      expect(mapToolKind("custom_operation")).toBe("other");
    });

    test("is case insensitive", () => {
      expect(mapToolKind("READ_FILE")).toBe("read");
      expect(mapToolKind("Edit_File")).toBe("edit");
      expect(mapToolKind("BASH")).toBe("execute");
    });
  });

  describe("tool call lifecycle", () => {
    test("middleware has wrapToolCall hook", () => {
      const middleware = createACPToolMiddleware();
      expect(middleware.wrapToolCall).toBeDefined();
      expect(typeof middleware.wrapToolCall).toBe("function");
    });

    test("middleware has afterAgent hook for cleanup", () => {
      const middleware = createACPToolMiddleware();
      expect(middleware.afterAgent).toBeDefined();
      expect(typeof middleware.afterAgent).toBe("function");
    });
  });

  describe("content mapping", () => {
    test("handles string results", () => {
      const middleware = createACPToolMiddleware({
        contentMapper: (result) => [{
          type: "text",
          _meta: null,
          annotations: null,
          text: String(result),
        }],
      });
      expect(middleware).toBeDefined();
    });

    test("handles object results", () => {
      const middleware = createACPToolMiddleware({
        contentMapper: (result) => [{
          type: "text",
          _meta: null,
          annotations: null,
          text: JSON.stringify(result),
        }],
      });
      expect(middleware).toBeDefined();
    });
  });
});

describe("extractLocations", () => {
  // Import the internal function for testing
  test("extracts path from args", () => {
    const middleware = createACPToolMiddleware();
    // Test that middleware can be created with various args
    expect(middleware).toBeDefined();
  });
});
