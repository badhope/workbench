import { beforeEach } from "vitest";
import { useStore } from "./store";
import { resetApi, resetStore } from "./storeTestHarness";

export { useStore };

/** 每个 store 测试文件的统一前置：先重置 API mock，再重置运行态。 */
export function installStoreTestReset(): void {
  beforeEach(() => {
    resetApi();
    resetStore(useStore);
  });
}
