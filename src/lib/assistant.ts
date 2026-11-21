import {
  assistantCancel,
  assistantChat,
  assistantChatStream,
  assistantConfig,
  assistantStartService,
  assistantSaveConfig,
  assistantStatus,
  assistantStopService,
} from "./api";
import type { AssistantConfig } from "../types";

/** 与 Rust `assistant::DEFAULT_*` 保持一致；仅用于首帧渲染，真实配置从后端读。 */
export const DEFAULT_ASSISTANT_CONFIG: AssistantConfig = {
  base_url: "http://127.0.0.1:18082/v1",
  model: "minicpm5-2b",
  api_key: "",
  temperature: 0.2,
  max_tokens: 1024,
  thinking: false,
  server_bin: "",
  model_path: "",
  context_size: 8192,
};

/** 纯静态 demo（既无 IPC 也无 HTTP 后端）的错误码，由页面翻译成可读提示。 */
export const ASSISTANT_DESKTOP_ONLY = "ASSISTANT_DESKTOP_ONLY";

export {
  assistantCancel,
  assistantChat,
  assistantChatStream,
  assistantConfig,
  assistantStartService,
  assistantSaveConfig,
  assistantStatus,
  assistantStopService,
};
