// CSS の import (アプリの Vite が, 読み込む)
declare module "*.css";

// Vite の環境 (`import.meta.env.DEV`. アプリの Vite が, 開発版なら true にする)
interface ImportMetaEnv {
  readonly DEV: boolean;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
