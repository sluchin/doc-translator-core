import { defineConfig } from "vitest/config";

export default defineConfig({
  // 単体テスト: ブラウザの DOM は, jsdom で代わりにする
  test: {
    environment: "jsdom",
    include: ["ts/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["ts/lib/**/*.ts"],
      exclude: ["ts/**/*.test.ts", "ts/lib/profile.ts"],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
