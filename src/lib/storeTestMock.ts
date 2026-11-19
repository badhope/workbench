import { api, harness } from "./storeTestHarness";

/** `vi.mock("./api")` 的工厂体：三个 store 测试文件共用，避免复制 97 token。 */
export function apiModule() {
  return {
    ...api,
    isTauri: () => harness.tauriMode,
    isBackend: () => harness.tauriMode,
  };
}
