import { z } from "zod";
import {
  allowedToolsParamSchema,
  assistantMessageItemParamSchema,
  createResponseBodySchema,
  developerMessageItemParamSchema,
  errorSchema,
  errorStreamingEventSchema,
  functionCallItemParamSchema,
  functionCallOutputItemParamSchema,
  functionCallOutputSchema,
  functionCallSchema,
  functionToolParamSchema,
  inputFileContentParamSchema,
  inputImageContentParamAutoParamSchema,
  inputTextContentParamSchema,
  inputVideoContentSchema,
  itemFieldSchema,
  itemParamSchema,
  messageSchema,
  metadataParamSchema,
  outputTextContentSchema,
  reasoningBodySchema,
  refusalContentSchema,
  responseCompletedStreamingEventSchema,
  responseContentPartAddedStreamingEventSchema,
  responseContentPartDoneStreamingEventSchema,
  responseCreatedStreamingEventSchema,
  responseFailedStreamingEventSchema,
  responseFunctionCallArgumentsDeltaStreamingEventSchema,
  responseFunctionCallArgumentsDoneStreamingEventSchema,
  responseIncompleteStreamingEventSchema,
  responseInProgressStreamingEventSchema,
  responseOutputItemAddedStreamingEventSchema,
  responseOutputItemDoneStreamingEventSchema,
  responseOutputTextAnnotationAddedStreamingEventSchema,
  responseOutputTextDeltaStreamingEventSchema,
  responseOutputTextDoneStreamingEventSchema,
  responseQueuedStreamingEventSchema,
  responseReasoningDeltaStreamingEventSchema,
  responseReasoningDoneStreamingEventSchema,
  responseReasoningSummaryDeltaStreamingEventSchema,
  responseReasoningSummaryDoneStreamingEventSchema,
  responseReasoningSummaryPartAddedStreamingEventSchema,
  responseReasoningSummaryPartDoneStreamingEventSchema,
  responseRefusalDeltaStreamingEventSchema,
  responseRefusalDoneStreamingEventSchema,
  responseResourceSchema,
  systemMessageItemParamSchema,
  toolChoiceParamSchema,
  userMessageItemParamSchema,
} from "./generated/kubb/zod/index.ts";

export const MetadataSchema = metadataParamSchema;

export const InputTextPartSchema = inputTextContentParamSchema;
export const InputImagePartSchema = inputImageContentParamAutoParamSchema;
export const InputFilePartSchema = inputFileContentParamSchema;
export const InputVideoPartSchema = inputVideoContentSchema;
export const InputContentPartSchema = z.union([
  InputTextPartSchema,
  InputImagePartSchema,
  InputFilePartSchema,
  InputVideoPartSchema,
]);

export const OutputTextPartSchema = outputTextContentSchema;
export const RefusalContentSchema = refusalContentSchema;

export const SystemMessageItemSchema = systemMessageItemParamSchema;
export const DeveloperMessageItemSchema = developerMessageItemParamSchema;
export const UserMessageItemSchema = userMessageItemParamSchema;
export const AssistantMessageItemSchema = assistantMessageItemParamSchema;
export const MessageItemSchema = z.union([
  SystemMessageItemSchema,
  DeveloperMessageItemSchema,
  UserMessageItemSchema,
  AssistantMessageItemSchema,
]);

export const FunctionCallInputItemSchema = functionCallItemParamSchema;
export const FunctionCallOutputInputItemSchema =
  functionCallOutputItemParamSchema;
export const InputItemSchema = itemParamSchema;

export const FunctionToolSchema = functionToolParamSchema;
export const AllowedToolsChoiceSchema = allowedToolsParamSchema;
export const ToolChoiceSchema = toolChoiceParamSchema;

export const OpenResponsesRequestSchema = createResponseBodySchema;

export const FunctionCallItemSchema = functionCallSchema;
export const FunctionCallOutputItemSchema = functionCallOutputSchema;
export const ReasoningItemSchema = reasoningBodySchema;
export const MessageOutputItemSchema = messageSchema;
export const OutputItemSchema = itemFieldSchema;

export const ErrorObjectSchema = errorSchema;
export const OpenResponsesResponseSchema = responseResourceSchema;

export const ResponseCreatedEventSchema = responseCreatedStreamingEventSchema;
export const ResponseQueuedEventSchema = responseQueuedStreamingEventSchema;
export const ResponseInProgressEventSchema =
  responseInProgressStreamingEventSchema;
export const ResponseCompletedEventSchema =
  responseCompletedStreamingEventSchema;
export const ResponseFailedEventSchema = responseFailedStreamingEventSchema;
export const ResponseIncompleteEventSchema =
  responseIncompleteStreamingEventSchema;
export const OutputItemAddedEventSchema =
  responseOutputItemAddedStreamingEventSchema;
export const OutputItemDoneEventSchema =
  responseOutputItemDoneStreamingEventSchema;
export const ResponseReasoningSummaryPartAddedEventSchema =
  responseReasoningSummaryPartAddedStreamingEventSchema;
export const ResponseReasoningSummaryPartDoneEventSchema =
  responseReasoningSummaryPartDoneStreamingEventSchema;
export const ContentPartAddedEventSchema =
  responseContentPartAddedStreamingEventSchema;
export const ContentPartDoneEventSchema =
  responseContentPartDoneStreamingEventSchema;
export const OutputTextDeltaEventSchema =
  responseOutputTextDeltaStreamingEventSchema;
export const OutputTextDoneEventSchema =
  responseOutputTextDoneStreamingEventSchema;
export const RefusalDeltaEventSchema = responseRefusalDeltaStreamingEventSchema;
export const RefusalDoneEventSchema = responseRefusalDoneStreamingEventSchema;
export const ReasoningDeltaEventSchema =
  responseReasoningDeltaStreamingEventSchema;
export const ReasoningDoneEventSchema =
  responseReasoningDoneStreamingEventSchema;
export const ReasoningSummaryDeltaEventSchema =
  responseReasoningSummaryDeltaStreamingEventSchema;
export const ReasoningSummaryDoneEventSchema =
  responseReasoningSummaryDoneStreamingEventSchema;
export const OutputTextAnnotationAddedEventSchema =
  responseOutputTextAnnotationAddedStreamingEventSchema;
export const FunctionCallArgumentsDeltaEventSchema =
  responseFunctionCallArgumentsDeltaStreamingEventSchema;
export const FunctionCallArgumentsDoneEventSchema =
  responseFunctionCallArgumentsDoneStreamingEventSchema;
export const ErrorEventSchema = errorStreamingEventSchema;

export const OpenResponsesEventSchema = z.union([
  ResponseCreatedEventSchema,
  ResponseQueuedEventSchema,
  ResponseInProgressEventSchema,
  ResponseCompletedEventSchema,
  ResponseFailedEventSchema,
  ResponseIncompleteEventSchema,
  OutputItemAddedEventSchema,
  OutputItemDoneEventSchema,
  ResponseReasoningSummaryPartAddedEventSchema,
  ResponseReasoningSummaryPartDoneEventSchema,
  ContentPartAddedEventSchema,
  ContentPartDoneEventSchema,
  OutputTextDeltaEventSchema,
  OutputTextDoneEventSchema,
  RefusalDeltaEventSchema,
  RefusalDoneEventSchema,
  ReasoningDeltaEventSchema,
  ReasoningDoneEventSchema,
  ReasoningSummaryDeltaEventSchema,
  ReasoningSummaryDoneEventSchema,
  OutputTextAnnotationAddedEventSchema,
  FunctionCallArgumentsDeltaEventSchema,
  FunctionCallArgumentsDoneEventSchema,
  ErrorEventSchema,
]);

export type OpenResponsesRequest = z.infer<typeof OpenResponsesRequestSchema>;
export type OpenResponsesResponse = z.infer<typeof OpenResponsesResponseSchema>;
export type InputTextPart = z.infer<typeof InputTextPartSchema>;
export type InputImagePart = z.infer<typeof InputImagePartSchema>;
export type InputFilePart = z.infer<typeof InputFilePartSchema>;
export type InputVideoPart = z.infer<typeof InputVideoPartSchema>;
export type InputContentPart = z.infer<typeof InputContentPartSchema>;
export type OutputTextPart = z.infer<typeof OutputTextPartSchema>;
export type RefusalContent = z.infer<typeof RefusalContentSchema>;
export type SystemMessageItem = z.infer<typeof SystemMessageItemSchema>;
export type DeveloperMessageItem = z.infer<typeof DeveloperMessageItemSchema>;
export type UserMessageItem = z.infer<typeof UserMessageItemSchema>;
export type AssistantMessageItem = z.infer<typeof AssistantMessageItemSchema>;
export type MessageItem = z.infer<typeof MessageItemSchema>;
export type FunctionCallInputItem = z.infer<typeof FunctionCallInputItemSchema>;
export type FunctionCallOutputInputItem = z.infer<
  typeof FunctionCallOutputInputItemSchema
>;
export type InputItem = z.infer<typeof InputItemSchema>;
export type FunctionTool = z.infer<typeof FunctionToolSchema>;
export type AllowedToolsChoice = z.infer<typeof AllowedToolsChoiceSchema>;
export type ToolChoice = z.infer<typeof ToolChoiceSchema>;
export type FunctionCallItem = z.infer<typeof FunctionCallItemSchema>;
export type FunctionCallOutputItem = z.infer<
  typeof FunctionCallOutputItemSchema
>;
export type ReasoningItem = z.infer<typeof ReasoningItemSchema>;
export type MessageOutputItem = z.infer<typeof MessageOutputItemSchema>;
export type OutputItem = z.infer<typeof OutputItemSchema>;
export type ErrorObject = z.infer<typeof ErrorObjectSchema>;
export type OpenResponsesEvent = z.infer<typeof OpenResponsesEventSchema>;
export type OpenResponsesStreamChunk = OpenResponsesEvent | "[DONE]";
export type Metadata = z.infer<typeof MetadataSchema>;
// biome-ignore lint/performance/noBarrelFile: Re-exporting snapshot metadata through the public contract facade is intentional.
export {
  contractSnapshotVersion,
  OPENRESPONSES_COMPLIANCE_TEST_IDS,
  OPENRESPONSES_OPENAPI_VERSION,
  OPENRESPONSES_SNAPSHOT_COMMIT,
  type OpenResponsesComplianceTestId,
  openResponsesSnapshotMetadata,
} from "./snapshot.ts";
