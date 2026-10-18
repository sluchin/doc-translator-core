/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import {
  absoluteCssUrls,
  buildSiteDocument,
  collectFrame,
  collectStyles,
  cssImports,
  withBodyClass,
  withMedia,
  withoutImports,
} from "./siteLook";

/**
 * HTML を, ページにする.
 *
 * @param html HTML
 * @returns ページ
 */
function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("collectFrame", () => {
  it("本文の要素から html まで, 外側から順に, タグと id とクラスを集める", () => {
    const doc = parse(
      '<html class="theme"><body class="page"><main id="m" class="layout" data-x="1">' +
        '<custom-box class="wrap"><article class="content"><p>a</p></article></custom-box>' +
        "</main></body></html>",
    );

    expect(collectFrame(doc.querySelector("article") as Element)).toEqual([
      { tag: "html", id: "", classes: "theme" },
      { tag: "body", id: "", classes: "page" },
      { tag: "main", id: "m", classes: "layout" },
      { tag: "div", id: "", classes: "wrap" },
      { tag: "article", id: "", classes: "content" },
    ]);
  });
});

describe("collectStyles", () => {
  it("CSS のファイルの絶対 URL と, style の中身を, 書かれた順に集める (印刷用と, 使わないものは除く)", () => {
    const doc = parse(
      "<html><head>" +
        '<link rel="stylesheet" href="/a.css">' +
        "<style>p { color: red }</style>" +
        '<link rel="preload stylesheet" href="b.css" media="(prefers-color-scheme: dark)">' +
        '<link rel="stylesheet" href="/print.css" media="print">' +
        '<link rel="stylesheet" href="/off.css" disabled>' +
        '<link rel="icon" href="/i.png">' +
        "<style></style>" +
        "</head><body></body></html>",
    );

    expect(collectStyles(doc, "https://example.com/docs/page.html")).toEqual({
      sheets: [
        { url: "https://example.com/a.css", text: "", media: "" },
        { url: "", text: "p { color: red }", media: "" },
        {
          url: "https://example.com/docs/b.css",
          text: "",
          media: "(prefers-color-scheme: dark)",
        },
        { url: "", text: "", media: "" },
      ],
    });
  });
});

describe("withMedia", () => {
  it("条件があれば, @media の中に入れて, @charset を取り除く. なければ, そのまま", () => {
    expect(withMedia('@charset "utf-8"; p { a: b }', " (prefers-color-scheme: dark) ")).toBe(
      "@media (prefers-color-scheme: dark) {\n p { a: b }\n}",
    );
    expect(withMedia("p { a: b }", "")).toBe("p { a: b }");
    expect(withMedia("p { a: b }", "all")).toBe("p { a: b }");
  });
});

describe("CSS の URL", () => {
  const base = "https://example.com/assets/site.css";

  it("url(...) を絶対 URL にする (引用符の有無によらず. data: は, そのまま)", () => {
    expect(
      absoluteCssUrls(
        "a { b: url(img/x.png) } c { d: url(\"/f.woff2\") } e { f: url('data:image/png;base64,AA') }",
        base,
      ),
    ).toBe(
      'a { b: url("https://example.com/assets/img/x.png") } ' +
        'c { d: url("https://example.com/f.woff2") } ' +
        'e { f: url("data:image/png;base64,AA") }',
    );
  });

  it("@import の URL を集めて, 取り除ける", () => {
    const css = '@import "reset.css";\n@import url(/theme.css) screen;\np { margin: 0 }';

    expect(cssImports(css, base)).toEqual([
      "https://example.com/assets/reset.css",
      "https://example.com/theme.css",
    ]);
    expect(withoutImports(css).trim()).toBe("p { margin: 0 }");
  });
});

describe("withBodyClass", () => {
  const frame = [
    { tag: "html", id: "", classes: "a" },
    { tag: "body", id: "", classes: "b" },
    { tag: "body", id: "", classes: "" },
  ];

  it("body にクラスを足す (ほかの要素と, クラスがないときは, そのまま)", () => {
    expect(withBodyClass(frame, " app-render-failed ")).toEqual([
      { tag: "html", id: "", classes: "a" },
      { tag: "body", id: "", classes: "b app-render-failed" },
      { tag: "body", id: "", classes: "app-render-failed" },
    ]);
    expect(withBodyClass(frame)).toEqual(frame);
  });
});

describe("buildSiteDocument", () => {
  it("html と body にクラスを付け, ほかの外側の要素を作り直して, 本文と CSS を入れる", () => {
    const page = buildSiteDocument({
      frame: [
        { tag: "html", id: "", classes: "theme" },
        { tag: "body", id: "b", classes: "" },
        { tag: "main", id: "m", classes: 'say "hi" <x> & y' },
        { tag: "article", id: "", classes: "" },
      ],
      css: "p { color: red } </style><script>",
      html: "<p>本文</p>",
      url: "https://example.com/docs/",
    });

    expect(page).toBe(
      "<!doctype html>" +
        '<html class="theme"><head><meta charset="utf-8">' +
        '<base href="https://example.com/docs/">' +
        "<style>p { color: red } <\\/style><script></style></head>" +
        '<body id="b"><main id="m" class="say &quot;hi&quot; &lt;x&gt; &amp; y"><article>' +
        "<p>本文</p></article></main></body></html>",
    );
  });

  it("外側の要素がなければ, 本文だけを入れる", () => {
    expect(buildSiteDocument({ frame: [], css: "", html: "<p>a</p>", url: "https://e.com/" })).toBe(
      '<!doctype html><html><head><meta charset="utf-8"><base href="https://e.com/">' +
        "<style></style></head><body><p>a</p></body></html>",
    );
  });
});
