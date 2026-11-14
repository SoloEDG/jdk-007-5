/// <reference types="vite/client" />

// 资源 URL 导入（AudioWorklet 等需要独立文件地址的模块）
declare module "*?url" {
  const url: string;
  export default url;
}
