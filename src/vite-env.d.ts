/// <reference types="vite/client" />

/**
 * 编译期注入的应用版本号，来源是 package.json（见 vite.config.ts）。
 * 手抄版本号会在发布时漂移，所以这里只声明、不赋值。
 */
declare const __APP_VERSION__: string;
