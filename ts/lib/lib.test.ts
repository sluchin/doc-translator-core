/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it, vi } from "vitest";
import { extractPage } from "./extract";
import {
  hashOf,
  isDocUrl,
  pathWithoutVersion,
  switchedUrl,
  tabIndexOf,
  withoutHash,
} from "./docUrl";
import type { SiteProfile } from "./profile";
import { EMPTY_NAV, back, canGoBack, canGoForward, current, forward, push } from "./history";
import {
  collectTitles,
  containsCurrent,
  htmlToText,
  isCurrent,
  parseHtmlMenu,
  translateTitles,
  withTitles,
} from "./menu";
import { sanitize } from "./sanitize";
import {
  compareVersions,
  parseVersions,
  versionFromText,
  versionOf,
  withCurrentVersion,
  withVersion,
} from "./version";
import { collectSegments, keepsStructure, markAtomic } from "./segments";
import {
  AbortedError,
  DEFAULT_LIMITS,
  GEMINI_LIMITS,
  GOOGLE_LIMITS,
  MAX_CHARS,
  MAX_ITEMS,
  MLKIT_LIMITS,
  chunk,
  noLookup,
  translatePage,
} from "./translatePage";

/** テスト用のサイトの設定 (Sphinx 風のページ). */
const HOST = "docs.example.com";
const HOME_URL = `https://${HOST}/latest/index.html`;
const PROFILE: SiteProfile = {
  name: "Test Doc",
  host: HOST,
  pathPrefix: "/latest/",
  homeUrl: HOME_URL,
  contentSelectors: ['[role="main"]', "main"],
  removeSelectors: [".rst-versions"],
  menu: { type: "html", selector: ".menu" },
  titleSuffix: / [—–-] .*Documentation$/,
};

/** 作り物の Sphinx 風のページ (実際のドキュメントの文章は使わない). */
const PAGE = `<!doctype html><html><head><title>Sample Topic — Test Documentation</title>
<script>alert(1)</script></head><body>
<nav class="side">Side menu<div class="menu"><dl><dt>Versions</dt></dl>
<ul class="current"><li class="l1"><a href="../a.html">Alpha</a></li>
<li class="l1 current"><a href="index.html">Beta</a><ul><li><a href="sub/x.html#part">Gamma  <b>X</b></a></li><li>Heading only</li></ul></li>
<li><span></span></li>
<li><button>Group  <i>Title</i></button><div><ul><li><a href="g.html">G1</a></li></ul></div></li></ul></div></nav>
<div role="main"><section id="sample"><h1>Sample Topic<a class="headerlink" href="#sample">¶</a></h1>
<p>Call <code>do_it()</code> and read <a href="other/page.html#part">the other page</a> now.</p>
<div class="highlight"><pre>int x = 1; // keep</pre></div>
<ul><li>Plain item text<ul><li><p>Nested paragraph</p></li></ul></li></ul>
<dl class="c function"><dt class="sig sig-object c" id="c.do_it"><span class="sig-name">do_it</span></dt>
<dd><p>Runs the thing.</p></dd></dl>
<p><code>only_code</code> 123</p>
<img src="_images/pic.png" srcset="a.png 2x" onerror="alert(2)">
<form><input></form>
</section></div></body></html>`;

/** 翻訳の代わり: 文章に印を付けるだけ (HTML のタグは、そのまま残す). */
const fake = async (texts: string[]): Promise<string[]> => texts.map((text) => `JA(${text})`);

describe("docUrl", () => {
  it("accepts only https pages of the documentation host", () => {
    expect(isDocUrl(HOME_URL, PROFILE)).toBe(true);
    expect(isDocUrl(`https://${HOST}/latest/a.html#x`, PROFILE)).toBe(true);
    expect(isDocUrl(`http://${HOST}/`, PROFILE)).toBe(false);
    expect(isDocUrl("https://evil.example.com/", PROFILE)).toBe(false);
    expect(isDocUrl(`https://${HOST}.evil.example.com/`, PROFILE)).toBe(false);
    expect(isDocUrl("not a url", PROFILE)).toBe(false);
    expect(isDocUrl(`https://${HOST}/api/a.html`, PROFILE)).toBe(false);
  });

  it("accepts the alternative host only when the site has one, and switches between the hosts", () => {
    const alt = { host: "alt.example.com", toLabel: "To alt", backLabel: "Back" };
    const both = { ...PROFILE, alt };
    expect(isDocUrl("https://alt.example.com/latest/a.html", both)).toBe(true);
    expect(isDocUrl("https://alt.example.com/latest/a.html", PROFILE)).toBe(false);
    expect(isDocUrl("https://alt.example.com/api/a.html", both)).toBe(false);
    expect(switchedUrl(`https://${HOST}/latest/a.html#x`, both)).toBe(
      "https://alt.example.com/latest/a.html#x",
    );
    expect(switchedUrl("https://alt.example.com/latest/a.html", both)).toBe(
      `https://${HOST}/latest/a.html`,
    );
    expect(switchedUrl("https://other.example.com/a", both)).toBe("https://other.example.com/a");
    expect(switchedUrl(`https://${HOST}/a`, PROFILE)).toBe(`https://${HOST}/a`);
    expect(switchedUrl("not a url", both)).toBe("not a url");
  });

  it("accepts the pages of the tabs only, and finds the tab of a page", () => {
    const tabs = [
      { label: "A", pathPrefix: "/a/", homeUrl: `https://${HOST}/a/index.html` },
      { label: "B", pathPrefix: "/b/", homeUrl: `https://${HOST}/b/index.html` },
      { label: "B2", pathPrefix: "/b/deep/", homeUrl: `https://${HOST}/b/deep/index.html` },
    ];
    const tabbed = { ...PROFILE, pathPrefix: "/", tabs };
    expect(isDocUrl(`https://${HOST}/a/x.html`, tabbed)).toBe(true);
    expect(isDocUrl(`https://${HOST}/b/x.html`, tabbed)).toBe(true);
    // タブのどれにも合わない (ホストの中の、別のドキュメント)
    expect(isDocUrl(`https://${HOST}/c/x.html`, tabbed)).toBe(false);
    expect(tabIndexOf(`https://${HOST}/a/x.html`, tabs)).toBe(0);
    expect(tabIndexOf(`https://${HOST}/b/x.html`, tabs)).toBe(1);
    // 長く合うほうのタブ
    expect(tabIndexOf(`https://${HOST}/b/deep/x.html`, tabs)).toBe(2);
    expect(tabIndexOf(`https://${HOST}/c/x.html`, tabs)).toBe(0);
    expect(tabIndexOf("not a url", tabs)).toBe(0);
  });

  it("removes and reads the fragment", () => {
    expect(withoutHash(`${HOME_URL}#part`)).toBe(HOME_URL);
    expect(withoutHash("not a url")).toBe("not a url");
    expect(hashOf(`${HOME_URL}#a%20b`)).toBe("a b");
    expect(hashOf(HOME_URL)).toBe("");
    expect(hashOf("not a url")).toBe("");
  });
});

describe("version", () => {
  const PATTERN = /^\/([^/]+)\//;
  /** 作り物の, Read the Docs 風の版の一覧. */
  const LIST = `<div class="rst-other-versions"><dl><dt>Versions</dt>
<dd><a href="/">latest</a></dd><dd><a href="/2.0.0/">2.0.0</a></dd>
<dd><a href="/1.0.0/">1.0.0   (LTS)</a></dd><dd><a href="/2.0.0/">again</a></dd><dd><a>none</a></dd></dl>
<dl><dt>Downloads</dt><dd><a href="/latest/doc.pdf">PDF</a></dd></dl></div>`;

  it("reads and replaces the version in the path", () => {
    expect(versionOf(`https://${HOST}/2.0.0/kernel/index.html`, PATTERN)).toBe("2.0.0");
    expect(versionOf(`https://${HOST}/`, PATTERN)).toBeUndefined();
    expect(versionOf("not a url", PATTERN)).toBeUndefined();
    expect(withVersion(`https://${HOST}/latest/kernel/a.html#x`, PATTERN, "1.0.0")).toBe(
      `https://${HOST}/1.0.0/kernel/a.html#x`,
    );
    // グループが先頭でない正規表現でも, グループの位置だけを替える
    expect(withVersion(`https://${HOST}/docs/v1/a.html`, /^\/docs\/([^/]+)\//, "v2")).toBe(
      `https://${HOST}/docs/v2/a.html`,
    );
    expect(withVersion(`https://${HOST}/`, PATTERN, "1.0.0")).toBe(`https://${HOST}/`);
    expect(withVersion("not a url", PATTERN, "1.0.0")).toBe("not a url");
  });

  it("reads the version list of the page without duplicates", () => {
    const doc = new DOMParser().parseFromString(LIST, "text/html");
    const choices = parseVersions(
      doc,
      ".rst-other-versions dl:first-of-type a",
      PATTERN,
      `https://${HOST}/latest/a.html`,
    );
    // `/` (版のない URL) と, 同じ版の 2 つ目と, リンクのない項目は除く
    expect(choices).toEqual([
      { version: "2.0.0", label: "2.0.0" },
      { version: "1.0.0", label: "1.0.0 (LTS)" },
    ]);
  });

  it("adds the current version when the list does not have it", () => {
    const list = [{ version: "2.0.0", label: "2.0.0" }];
    expect(withCurrentVersion(list, "2.0.0")).toBe(list);
    expect(withCurrentVersion(list, undefined)).toBe(list);
    expect(withCurrentVersion(list, "latest")).toEqual([
      { version: "latest", label: "latest" },
      ...list,
    ]);
  });

  it("reads the version from the text of a file", () => {
    const pattern = /Latest release:[\s\S]*?(\d+\.\d+\.\d+)/;
    expect(
      versionFromText("<p data-x=\"Latest release: <a href='new2420.html'>2.4.21</a>\">", pattern),
    ).toBe("2.4.21");
    expect(versionFromText("<p>no version</p>", pattern)).toBeUndefined();
  });

  it("picks the newest version of a list", () => {
    const list =
      '<a href="notes/v-5-9.html">5.9</a><a href="notes/v-5-10.html">5.10</a><a href="notes/v-4-0.html">4.0</a>';
    const pattern = /notes\/v-(\d+-\d+)\.html/;
    // 最初に合うもの (既定) と, 一番新しいもの (数字の区切りごとに比べる. 5-10 は 5-9 より新しい)
    expect(versionFromText(list, pattern)).toBe("5-9");
    expect(versionFromText(list, pattern, true)).toBe("5-10");
    expect(versionFromText(list, /notes\/v-(\d+-\d+)\.html/g, true)).toBe("5-10");
    expect(versionFromText("<p>none</p>", pattern, true)).toBeUndefined();
    expect(compareVersions("2.4.21", "2.4.3")).toBeGreaterThan(0);
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0", "1.0.1")).toBeLessThan(0);
    expect(compareVersions("1.0.1", "1.0")).toBeGreaterThan(0);
  });

  it("removes the version from the path to compare it with the tabs", () => {
    expect(pathWithoutVersion("/1.90.0/book/a.html", PATTERN)).toBe("/book/a.html");
    expect(pathWithoutVersion("/1.90.0", /^\/([^/]+)/)).toBe("/");
    expect(pathWithoutVersion("/", PATTERN)).toBe("/");
    expect(pathWithoutVersion("/book/a.html")).toBe("/book/a.html");
    const tabs = [
      { label: "A", pathPrefix: "/book/", homeUrl: `https://${HOST}/1.0.0/book/index.html` },
      { label: "B", pathPrefix: "/nomicon/", homeUrl: `https://${HOST}/1.0.0/nomicon/index.html` },
    ];
    const site = {
      ...PROFILE,
      pathPrefix: "/",
      tabs,
      versions: { pattern: PATTERN },
    };
    expect(isDocUrl(`https://${HOST}/1.90.0/nomicon/a.html`, site)).toBe(true);
    expect(isDocUrl(`https://${HOST}/1.90.0/std/a.html`, site)).toBe(false);
    expect(tabIndexOf(`https://${HOST}/1.90.0/nomicon/a.html`, tabs, PATTERN)).toBe(1);
    expect(tabIndexOf(`https://${HOST}/1.90.0/nomicon/a.html`, tabs)).toBe(0);
  });

  it("extracts the version list only when the site has versions", () => {
    const html = `<html><head><title>T</title></head><body>${LIST}<main><p>x</p></main></body></html>`;
    const versioned = {
      ...PROFILE,
      versions: { selector: ".rst-other-versions dl:first-of-type a", pattern: PATTERN },
    };
    expect(extractPage(html, `https://${HOST}/2.0.0/a.html`, versioned).versions).toHaveLength(2);
    expect(extractPage(html, `https://${HOST}/2.0.0/a.html`, PROFILE).versions).toEqual([]);
    // 版の一覧を、ページからではなく、別のファイルから作るサイト
    const listed = {
      ...PROFILE,
      versions: { pattern: PATTERN, list: { url: "https://a/v", parse: () => [] } },
    };
    expect(extractPage(html, `https://${HOST}/2.0.0/a.html`, listed).versions).toEqual([]);
  });
});

describe("history", () => {
  it("pushes, goes back and forward, and drops the forward pages", () => {
    let nav = push(push(push(EMPTY_NAV, "a"), "b"), "c");
    expect(current(nav)).toBe("c");
    expect(canGoForward(nav)).toBe(false);
    nav = back(back(nav));
    expect(current(nav)).toBe("a");
    expect(canGoBack(nav)).toBe(false);
    expect(back(nav)).toBe(nav);
    nav = forward(nav);
    expect(current(nav)).toBe("b");
    expect(push(nav, "b")).toBe(nav);
    nav = push(nav, "d");
    expect(nav.entries).toEqual(["a", "b", "d"]);
    expect(forward(nav)).toBe(nav);
    expect(current(EMPTY_NAV)).toBeUndefined();
  });
});

describe("sanitize", () => {
  it("removes scripts, handlers, forms and styles", () => {
    const html = sanitize(
      '<p style="x:1" onclick="a()">Hi<script>b()</script></p><form><input></form>',
    );
    expect(html).toBe("<p>Hi</p>");
  });
});

describe("extractPage", () => {
  const page = extractPage(PAGE, "https://docs.example.com/latest/topic/index.html", PROFILE);

  it("takes the main content and the title", () => {
    expect(page.title).toBe("Sample Topic");
    expect(page.html).toContain("Runs the thing.");
    expect(page.html).not.toContain("Side menu");
    expect(page.html).not.toContain("alert");
    expect(page.html).not.toContain("<form");
    expect(page.html).not.toContain("headerlink");
  });

  it("makes the urls absolute and drops the unsafe attributes", () => {
    expect(page.html).toContain(
      'href="https://docs.example.com/latest/topic/other/page.html#part"',
    );
    expect(page.html).toContain('src="https://docs.example.com/latest/topic/_images/pic.png"');
    expect(page.html).not.toContain("srcset");
    expect(page.html).not.toContain("onerror");
  });

  it("falls back to main, body and the heading", () => {
    expect(
      extractPage("<html><body><main><p>Only main</p></main>x</body></html>", "https://a/", PROFILE)
        .html,
    ).toBe("<p>Only main</p>");
    const body = extractPage("<html><body><h1>Heading</h1></body></html>", "https://a/", PROFILE);
    expect(body.title).toBe("Heading");
    expect(extractPage('<a href="http://[bad">x</a>', "https://a/", PROFILE).html).toContain(
      "http://[bad",
    );
    expect(extractPage("<p>No title</p>", "https://a/", PROFILE).title).toBe("");
  });
});

describe("extractPage with dropCodeLines", () => {
  const profile = { ...PROFILE, dropCodeLines: /^\s*\/\/sample(Start|End)\s*$/ };
  const html = `<html><body><main>
<div class="code-block">
fun main() {
//sampleStart
    println("x")
//sampleEnd
}
</div><pre><span>//sampleStart</span></pre></main></body></html>`;

  it("drops the marker lines of the plain code and trims the edges", () => {
    const text = extractPage(html, "https://a/", profile).html;
    expect(text).toContain('<div class="code-block">fun main() {\n    println("x")\n}</div>');
  });

  it("keeps the highlighted code and the code of a profile without the option", () => {
    expect(extractPage(html, "https://a/", profile).html).toContain("<span>//sampleStart</span>");
    expect(extractPage(html, "https://a/", PROFILE).html).toContain("//sampleEnd");
  });
});

describe("menu", () => {
  const page = extractPage(PAGE, "https://docs.example.com/latest/topic/index.html", PROFILE);

  it("reads the nested lists of the menu element with absolute urls", () => {
    expect(page.menu.map((item) => item.title)).toEqual(["Alpha", "Beta", "Group Title"]);
    expect(page.menu[2].url).toBeUndefined();
    expect(page.menu[2].children.map((c) => c.title)).toEqual(["G1"]);
    expect(page.menu[0].url).toBe("https://docs.example.com/latest/a.html");
    expect(page.menu[1].children.map((c) => [c.title, c.url])).toEqual([
      ["Gamma X", "https://docs.example.com/latest/topic/sub/x.html#part"],
      ["Heading only", undefined],
    ]);
    expect(extractPage(PAGE, "https://a/", { ...PROFILE, menu: undefined }).menu).toEqual([]);
    expect(
      extractPage(PAGE, "https://a/", { ...PROFILE, menu: { type: "html", selector: ".none" } })
        .menu,
    ).toEqual([]);
    expect(
      extractPage(PAGE, "https://a/", {
        ...PROFILE,
        menu: { type: "json", url: "https://a/t.json", parse: () => [] },
      }).menu,
    ).toEqual([]);
  });

  it("reads the numbered lists whose links are wrapped in an element", () => {
    const toc = new DOMParser().parseFromString(
      `<ol class="chapter"><li class="part-title">Part One</li>
<li class="item"><span class="wrap"><a href="one.html"><strong>1.</strong> One</a></span><ol class="section">
<li class="item"><span class="wrap"><a href="one-a.html">1.1. Sub</a></span></li></ol>
<li class="spacer"></li>
<li class="item"><div class="plain">No link</div></li></ol>`,
      "text/html",
    ).body;
    const items = parseHtmlMenu(toc, "https://docs.example.com/book/toc.html", "ul, ol");
    expect(items.map((item) => [item.title, item.url])).toEqual([
      ["Part One", undefined],
      ["1. One", "https://docs.example.com/book/one.html"],
      ["No link", undefined],
    ]);
    expect(items[1].children.map((c) => [c.title, c.url])).toEqual([
      ["1.1. Sub", "https://docs.example.com/book/one-a.html"],
    ]);
    // 既定 (`ul`) では、`ol` を読まない
    expect(parseHtmlMenu(toc, "https://a/")).toEqual([]);
    // タブごとの、別のファイルのメニューは、ページからは読まない
    expect(
      extractPage(PAGE, "https://a/", {
        ...PROFILE,
        menu: { type: "htmlFile", url: "https://a/toc.html", selector: "ol" },
      }).menu,
    ).toEqual([]);
    // 一覧の要素の指定は、ページのメニューにも使える
    expect(
      extractPage(`<nav><ol><li><a href="x.html">X</a></li></ol></nav>`, "https://a/b/", {
        ...PROFILE,
        menu: { type: "html", selector: "nav", list: "ol" },
      }).menu.map((item) => item.url),
    ).toEqual(["https://a/b/x.html"]);
  });

  it("finds the current page and the branch that contains it", () => {
    const [alpha, beta] = page.menu;
    const gamma = beta.children[0];
    const url = "https://docs.example.com/latest/topic/sub/x.html";
    expect(isCurrent(gamma, url)).toBe(true);
    expect(isCurrent(alpha, url)).toBe(false);
    expect(isCurrent(beta.children[1], url)).toBe(false);
    expect(containsCurrent(beta, url)).toBe(true);
    expect(containsCurrent(alpha, url)).toBe(false);
  });

  it("collects the titles once and replaces them", () => {
    const titles = collectTitles([...page.menu, ...page.menu]);
    expect(titles).toEqual(["Alpha", "Beta", "Gamma X", "Heading only", "Group Title", "G1"]);
    const mapped = withTitles(
      page.menu,
      new Map([
        ["Beta", "ベータ"],
        ["Gamma X", "ガンマ"],
      ]),
    );
    expect(mapped[0].title).toBe("Alpha");
    expect(mapped[1].title).toBe("ベータ");
    expect(mapped[1].children[0].title).toBe("ガンマ");
  });

  it("translates the titles and turns the html into text", async () => {
    expect(htmlToText("It&#39;s &amp; <b>fine</b>")).toBe("It's & fine");
    const map = await translateTitles(["A", "B"], async (texts) =>
      texts.slice(0, 1).map((t) => `${t}&amp;ja`),
    );
    expect(map.get("A")).toBe("A&ja");
    expect(map.get("B")).toBe("B");
  });
});

describe("segments", () => {
  const root = (html: string) => {
    const element = document.createElement("div");
    element.innerHTML = html;
    return element;
  };

  it("collects paragraphs, headings and items but not code or signatures", () => {
    const list = collectSegments(root(extractPage(PAGE, "https://a/b.html", PROFILE).html)).map(
      (element) => element.textContent,
    );
    expect(list).toEqual([
      "Sample Topic",
      "Call do_it() and read the other page now.",
      "Plain item text",
      "Nested paragraph",
      "Runs the thing.",
    ]);
  });

  it("wraps loose text next to blocks, and skips blocks without English", () => {
    const element = root("<li>Text <b>bold</b><ul><li>12</li></ul>tail words</li>");
    const found = collectSegments(element);
    expect(found.map((e) => e.outerHTML)).toEqual([
      '<span data-zd-run="">Text <b>bold</b></span>',
      '<span data-zd-run="">tail words</span>',
    ]);
    expect(
      collectSegments(root("<p>123 <code>x</code></p><pre>text</pre><svg><text>abc</text></svg>")),
    ).toEqual([]);
  });

  it("marks the inline code so that it is not translated", () => {
    const [segment] = collectSegments(
      root('<p>Use <code>f()</code> and <a class="x" href="#">link</a></p>'),
    );
    const html = markAtomic(segment);
    expect(html).toContain('<code translate="no" class="notranslate">f()</code>');
    expect(html).toContain('<a class="x" href="#">link</a>');
  });

  it("checks that the marks and the links are kept", () => {
    const original = '<code class="notranslate">a</code> <a href="#">b</a>';
    expect(keepsStructure(original, '<a href="#">び</a> <code class="notranslate">あ</code>')).toBe(
      true,
    );
    expect(keepsStructure(original, '<a href="#">び</a> あ')).toBe(false);
    expect(keepsStructure(original, "  ")).toBe(false);
  });
});

describe("chunk", () => {
  it("splits by the number and by the size, keeping the order", () => {
    const many = Array.from({ length: MAX_ITEMS + 1 }, (_, i) => `t${i}`);
    expect(chunk(many).map((part) => part.length)).toEqual([MAX_ITEMS, 1]);
    const big = "x".repeat(MAX_CHARS);
    expect(chunk([big, "a", "b"])).toEqual([[big], ["a", "b"]]);
    expect(chunk(["a", big])).toEqual([["a"], [big]]);
    expect(chunk([])).toEqual([]);
    expect(DEFAULT_LIMITS).toEqual({ items: MAX_ITEMS, chars: MAX_CHARS });
    const small = Array.from({ length: 25 }, (_, i) => `t${i}`);
    expect(chunk(small, MLKIT_LIMITS).map((part) => part.length)).toEqual([10, 10, 5]);
  });
});

describe("translatePage", () => {
  const page = extractPage(PAGE, "https://docs.example.com/latest/topic/index.html", PROFILE);

  it("translates each unit and reports the progress", async () => {
    const seen: number[] = [];
    const result = await translatePage(page, fake, ({ done, total }) => seen.push(done / total));
    expect(result.title).toBe("JA(Sample Topic)");
    expect(result.html).toContain("JA(Runs the thing.)");
    expect(result.html).toContain('<code translate="no" class="notranslate">do_it()</code>');
    expect(result.html).toContain("int x = 1; // keep");
    expect(result.html).toContain("only_code");
    expect(result.kept).toBe(0);
    // 最初の依頼が終わる前に、0 から、経過を出す
    expect(seen[0]).toBe(0);
    expect(seen.at(-1)).toBe(1);
  });

  it("sends the same text only once", async () => {
    const twice = { ...page, html: "<p>Same</p><p>Same</p>" };
    const calls: string[][] = [];
    await translatePage(twice, async (texts) => {
      calls.push(texts);
      return texts;
    });
    expect(calls).toEqual([["Sample Topic", "Same"]]);
  });

  it("keeps the English when the structure is broken or the result is missing", async () => {
    const broken = async (texts: string[]) => texts.map((text) => text.replace(/<\/?a[^>]*>/g, ""));
    const result = await translatePage(page, broken);
    expect(result.kept).toBe(1);
    expect(result.html).toContain("read <a");
    const short = await translatePage({ ...page, html: "<p>Only one</p>" }, async () => []);
    expect(short.html).toContain("Only one");
    expect(short.title).toBe("Sample Topic");
  });

  it("sanitizes the translated html", async () => {
    const evil = async (texts: string[]) => texts.map(() => '<img src="x" onerror="alert(1)">ok');
    const result = await translatePage({ ...page, html: "<p>Hello</p>" }, evil);
    expect(result.html).not.toContain("onerror");
  });

  it("passes the partial translation after each request except the last", async () => {
    const many = {
      ...page,
      html: Array.from({ length: 50 }, (_, i) => `<p>Para ${i}</p>`).join(""),
    };
    const partials: { title: string; html: string }[] = [];
    const result = await translatePage(
      many,
      fake,
      () => undefined,
      { aborted: false },
      { items: 20, chars: 8000 },
      (partial) => partials.push(partial),
    );
    // 51 個 (タイトルと 50 の段落) を 20 個ずつ: 3 回の依頼で, 途中は 2 回
    expect(partials).toHaveLength(2);
    expect(partials[0].title).toBe("JA(Sample Topic)");
    expect(partials[0].html).toContain("JA(Para 0)");
    expect(partials[0].html).toContain("<p>Para 49</p>");
    expect(partials[1].html).toContain("JA(Para 38)");
    expect(partials[1].html).toContain("<p>Para 49</p>");
    expect(result.html).toContain("JA(Para 49)");
    expect(result.html).not.toContain("<p>Para 49</p>");
  });

  it("shows the cached translations first and sends only the rest", async () => {
    const three = { ...page, html: "<p>One</p><p>Two</p><p>Three</p>" };
    // タイトルと 1 つ目は, 翻訳がない (キャッシュは, 2 つ目と 3 つ目だけ)
    const lookup = async (texts: string[]) =>
      texts.map((text) => (text === "Two" || text === "Three" ? `C(${text})` : null));
    const sent: string[][] = [];
    const seen: number[] = [];
    const partials: { title: string; html: string }[] = [];
    const result = await translatePage(
      three,
      async (texts) => {
        sent.push(texts);
        return fake(texts);
      },
      ({ done }) => seen.push(done),
      { aborted: false },
      DEFAULT_LIMITS,
      (partial) => partials.push(partial),
      lookup,
    );
    expect(sent).toEqual([["Sample Topic", "One"]]);
    // 続きから: 初めに, 翻訳済みの 2 つを数える
    expect(seen).toEqual([2, 4]);
    expect(partials).toHaveLength(1);
    expect(partials[0].title).toBe("Sample Topic");
    expect(partials[0].html).toContain("<p>One</p>");
    expect(partials[0].html).toContain("C(Two)");
    expect(result.title).toBe("JA(Sample Topic)");
    expect(result.html).toContain("JA(One)");
    expect(result.html).toContain("C(Three)");
  });

  it("does not send anything when everything is cached", async () => {
    const send = vi.fn(fake);
    const progress = vi.fn();
    const result = await translatePage(
      { ...page, html: "<p>Hello</p>" },
      send,
      progress,
      { aborted: false },
      DEFAULT_LIMITS,
      () => undefined,
      async (texts) => texts.map((text) => `C(${text})`),
    );
    expect(send).not.toHaveBeenCalled();
    // 全部が翻訳済みなら、全部が終わった経過を、1 回だけ出す
    expect(progress).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenCalledWith({ done: 2, total: 2 });
    expect(result.title).toBe("C(Sample Topic)");
    expect(result.html).toContain("C(Hello)");
  });

  it("sends everything when the lookup fails", async () => {
    const send = vi.fn(fake);
    const result = await translatePage(
      { ...page, html: "<p>Hello</p>" },
      send,
      () => undefined,
      { aborted: false },
      DEFAULT_LIMITS,
      () => undefined,
      () => Promise.reject(new Error("no cache")),
    );
    expect(send).toHaveBeenCalledWith(["Sample Topic", "Hello"]);
    expect(result.html).toContain("JA(Hello)");
    expect(await noLookup(["a", "b"])).toEqual([null, null]);
  });

  it("sends the requests at the same time up to the limit", async () => {
    const many = {
      ...page,
      html: Array.from({ length: 6 }, (_, i) => `<p>Para ${i}</p>`).join(""),
    };
    let running = 0;
    let peak = 0;
    const slow = async (texts: string[]) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return fake(texts);
    };
    const partials: string[] = [];
    // 7 個 (タイトルと 6 つの段落) を 2 個ずつ: 4 回の依頼を, 3 つまで同時に送る
    const result = await translatePage(
      many,
      slow,
      () => undefined,
      { aborted: false },
      { items: 2, chars: 8000, parallel: 3 },
      (partial) => partials.push(partial.html),
    );
    expect(peak).toBe(3);
    expect(result.html).toContain("JA(Para 0)");
    expect(result.html).toContain("JA(Para 5)");
    // 最後の依頼のあとは, 途中の翻訳を渡さない
    expect(partials).toHaveLength(3);
    expect(GOOGLE_LIMITS.parallel).toBe(3);
    expect(GEMINI_LIMITS.parallel).toBe(2);
    expect(GOOGLE_LIMITS.items).toBe(DEFAULT_LIMITS.items);
  });

  it("stops passing the partial translation after a request fails", async () => {
    const many = {
      ...page,
      html: Array.from({ length: 6 }, (_, i) => `<p>Para ${i}</p>`).join(""),
    };
    const partials: string[] = [];
    const failing = async (texts: string[]) => {
      if (texts.includes("Para 0")) {
        throw new Error("limited");
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
      return fake(texts);
    };
    await expect(
      translatePage(
        many,
        failing,
        () => undefined,
        { aborted: false },
        { items: 2, chars: 8000, parallel: 2 },
        (partial) => partials.push(partial.html),
      ),
    ).rejects.toThrow("limited");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(partials).toEqual([]);
  });

  it("stops when it is aborted", async () => {
    const signal = { aborted: false };
    const abortAfterFirst = async (texts: string[]) => {
      signal.aborted = true;
      return texts;
    };
    const many = {
      ...page,
      html: Array.from({ length: 50 }, (_, i) => `<p>Para ${i}</p>`).join(""),
    };
    await expect(
      translatePage(many, abortAfterFirst, () => undefined, signal),
    ).rejects.toBeInstanceOf(AbortedError);
  });
});
