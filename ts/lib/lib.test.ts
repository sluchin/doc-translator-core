/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { extractPage } from "./extract";
import { hashOf, isDocUrl, withoutHash } from "./docUrl";
import type { SiteProfile } from "./profile";
import { EMPTY_NAV, back, canGoBack, canGoForward, current, forward, push } from "./history";
import {
  collectTitles,
  containsCurrent,
  htmlToText,
  isCurrent,
  translateTitles,
  withTitles,
} from "./menu";
import { sanitize } from "./sanitize";
import { collectSegments, keepsStructure, markAtomic } from "./segments";
import {
  AbortedError,
  DEFAULT_LIMITS,
  MAX_CHARS,
  MAX_ITEMS,
  MLKIT_LIMITS,
  chunk,
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
<li><span></span></li></ul></div></nav>
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

  it("removes and reads the fragment", () => {
    expect(withoutHash(`${HOME_URL}#part`)).toBe(HOME_URL);
    expect(withoutHash("not a url")).toBe("not a url");
    expect(hashOf(`${HOME_URL}#a%20b`)).toBe("a b");
    expect(hashOf(HOME_URL)).toBe("");
    expect(hashOf("not a url")).toBe("");
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
    expect(page.menu.map((item) => item.title)).toEqual(["Alpha", "Beta"]);
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
    expect(titles).toEqual(["Alpha", "Beta", "Gamma X", "Heading only"]);
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
