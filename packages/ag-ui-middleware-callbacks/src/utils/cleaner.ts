/**
 * Utility to clean up LangChain serialized objects from state/output.
 */

/**
 * Recursively removes 'lc', 'type', 'id' (LangChain internal) fields and 
 * flattens 'kwargs' if present.
 */
export function cleanLangChainData(data: any): any {
  if (data === null || data === undefined) {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(cleanLangChainData);
  }

  if (typeof data === "object") {
    // Check if it's a LangChain serialized object
    if ((data.lc === 1 || data.lc_serializable === true) && (data.kwargs || data.lc_kwargs)) {
      const kwargs = data.kwargs || data.lc_kwargs;
      const cleaned = cleanLangChainData(kwargs);
      return cleaned;
    }

    const result: any = {};
    for (const [key, value] of Object.entries(data)) {
      // Skip internal metadata often found in LangChain objects
      if (key === "lc" || key === "type" || key === "id" || key.startsWith("lc_")) {
        continue;
      }
      result[key] = cleanLangChainData(value);
    }
    return result;
  }

  return data;
}

/**
 * Extracts content from a tool output if it's a serialized ToolMessage or object.
 */
export function extractToolOutput(output: any): string {
  if (output === null || output === undefined) {
    return "";
  }

  // If it's already a string, try to parse it (it might be a JSON-encoded LangChain message)
  let parsed = output;
  if (typeof output === "string") {
    try {
      parsed = JSON.parse(output);
    } catch {
      return output;
    }
  }

  // Now 'parsed' is either an object or the original output if it wasn't valid JSON

  if (typeof parsed !== "object") {
    return String(parsed);
  }

  // Handle LangChain message structures (lc: 1 or lc_serializable: true)
  const isLangChainMessage = parsed.lc === 1 || parsed.lc_serializable === true || (parsed.type === "constructor" && Array.isArray(parsed.id));
  const kwargs = parsed.kwargs || parsed.lc_kwargs || parsed;

  if (kwargs && kwargs.content !== undefined) {
    return typeof kwargs.content === "string" 
      ? kwargs.content 
      : JSON.stringify(kwargs.content);
  }

  // If it's a plain object but has a 'result' or 'output' field
  if (parsed.result !== undefined) return typeof parsed.result === "string" ? parsed.result : JSON.stringify(parsed.result);
  if (parsed.output !== undefined) return typeof parsed.output === "string" ? parsed.output : JSON.stringify(parsed.output);

  // If no specific field found, return stringified version of the object (but cleaned)
  return JSON.stringify(cleanLangChainData(parsed));
}
