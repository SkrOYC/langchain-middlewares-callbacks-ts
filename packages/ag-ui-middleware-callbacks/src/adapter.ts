import {
  type AGUIAdapterConfig as AGUIAdapterConfigImplementation,
  type AGUIAdapter as AGUIAdapterImplementation,
  type AGUIAdapterRunOptions as AGUIAdapterRunOptionsImplementation,
  type AGUIAgentFactory as AGUIAgentFactoryImplementation,
  type AGUIAgentLike as AGUIAgentLikeImplementation,
  type AGUIAgentRunOptions as AGUIAgentRunOptionsImplementation,
  createAGUIAdapter as createAGUIAdapterImplementation,
} from "@/adapter/create-agui-adapter";

export type AGUIAdapter = AGUIAdapterImplementation;
export type AGUIAdapterConfig = AGUIAdapterConfigImplementation;
export type AGUIAdapterRunOptions = AGUIAdapterRunOptionsImplementation;
export type AGUIAgentFactory = AGUIAgentFactoryImplementation;
export type AGUIAgentLike = AGUIAgentLikeImplementation;
export type AGUIAgentRunOptions = AGUIAgentRunOptionsImplementation;

export function createAGUIAdapter(config: AGUIAdapterConfig): AGUIAdapter {
  return createAGUIAdapterImplementation(config);
}
