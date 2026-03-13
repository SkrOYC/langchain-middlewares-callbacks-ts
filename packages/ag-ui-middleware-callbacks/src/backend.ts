import {
  type AGUIAgentFactory as AGUIAgentFactoryImplementation,
  type AGUIBackendAgentLike as AGUIBackendAgentLikeImplementation,
  type AGUIBackendConfig as AGUIBackendConfigImplementation,
  type AGUIBackend as AGUIBackendImplementation,
  type AGUIBackendRunOptions as AGUIBackendRunOptionsImplementation,
  createAGUIBackend as createAGUIBackendImplementation,
} from "./backend/create-agui-backend";

export type AGUIAgentFactory = AGUIAgentFactoryImplementation;
export type AGUIBackend = AGUIBackendImplementation;
export type AGUIBackendAgentLike = AGUIBackendAgentLikeImplementation;
export type AGUIBackendConfig = AGUIBackendConfigImplementation;
export type AGUIBackendRunOptions = AGUIBackendRunOptionsImplementation;

export function createAGUIBackend(config: AGUIBackendConfig): AGUIBackend {
  return createAGUIBackendImplementation(config);
}
