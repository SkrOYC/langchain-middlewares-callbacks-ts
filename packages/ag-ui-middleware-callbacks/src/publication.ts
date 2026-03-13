import {
  type AGUIRunPublisherConfig as AGUIRunPublisherConfigImplementation,
  type AGUIRunPublisher as AGUIRunPublisherImplementation,
  type AGUIRunPublisherListener as AGUIRunPublisherListenerImplementation,
  type AGUIRunPublisherValidationMode as AGUIRunPublisherValidationModeImplementation,
  createAGUIRunPublisher as createAGUIRunPublisherImplementation,
} from "./publication/create-agui-run-publisher";
import {
  type AGUIEventSerializer,
  serializeEventAsSSE as serializeEventAsSSEImplementation,
} from "./publication/serializer";

export type AGUIRunPublisher = AGUIRunPublisherImplementation;
export type AGUIRunPublisherConfig = AGUIRunPublisherConfigImplementation;
export type AGUIRunPublisherListener = AGUIRunPublisherListenerImplementation;
export type AGUIRunPublisherValidationMode =
  AGUIRunPublisherValidationModeImplementation;

export function createAGUIRunPublisher(
  config?: AGUIRunPublisherConfig
): AGUIRunPublisher {
  return createAGUIRunPublisherImplementation(config);
}

export function serializeEventAsSSE(event: Parameters<AGUIEventSerializer>[0]) {
  return serializeEventAsSSEImplementation(event);
}
