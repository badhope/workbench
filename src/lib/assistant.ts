import {
  assistantChat,
  assistantConfig,
  assistantSaveConfig,
  assistantStatus,
} from "./api";
import type { AssistantConfig } from "../types";

/** 与 Rust `assistant::DEFAULT_*` 保持一致；仅用于首帧渲染，真实配置从后端读。 */
export const DEFAULT_ASSISTANT_CONFIG: AssistantConfig = {
  base_url: "http://127.0.0.1:18082/v1",
  model: "minicpm5-2b",
  temperature: 0.2,
  max_tokens: 1024,
  thinking: false,
};

/** 纯静态 demo（既无 IPC 也无 HTTP 后端）的错误码，由页面翻译成可读提示。 */
export const ASSISTANT_DESKTOP_ONLY = "ASSISTANT_DESKTOP_ONLY";

export { assistantChat, assistantConfig, assistantSaveConfig, assistantStatus };
