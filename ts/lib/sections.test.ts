/**
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import type { DocPage } from "./extract";
import { baseUrlOf, resolveSectionUrl, sectionPage, sectionUrl, splitSections } from "./sections";

const BASE = "https://example.org/guide/Book";

const SOURCE = { split: "h1", menuLevels: ["h1", "h2", "h3"] };

/**
 * テストのページを作る.
 *
 * @param html 本文
 * @returns ページ
 */
function pageOf(html: string): DocPage {
  return { url: BASE, title: "Book", html, menu: [], versions: [] };
}

/** 作り物の本文: 前書き, 3 つの部分, 名前の印, ページの中のリンク. */
const HTML = [
  "<p>Lead</p>",
  '<h1 id="one"><a name="main"></a>One</h1>',
  '<p>A <a href="https://example.org/guide/Book#r-two">to two</a>',
  ' <a href="https://example.org/guide/Book#unknown">unknown</a>',
  ' <a href="https://example.org/other#r-two">other page</a></p>',
  '<h2 id="one-a">One A</h2>',
  '<h3 id="one-a-1"><a name="r-one"></a>Rule  1</h3>',
  "<h3>No id</h3>",
  "<h1>Two</h1>",
  '<div><a name="r-two"></a><a id="taken" name="taken-name"></a><a name=""></a>',
  '<h3 id="deep">Deep</h3></div>',
  '<h3 id="two-x">Two X</h3>',
  '<h1 id="one">Three</h1>',
  '<p><a name="taken"></a><span id="taken">dup</span></p>',
  "Loose text",
].join("");

describe("sections", () => {
  it("makes the section URLs from the page URL", () => {
    expect(baseUrlOf(`${BASE}?section=x#y`)).toBe(BASE);
    expect(baseUrlOf("not a url")).toBe("not a url");
    expect(sectionUrl(`${BASE}#z`, "one")).toBe(`${BASE}?section=one`);
    expect(sectionUrl(BASE, "one", "r-1")).toBe(`${BASE}?section=one#r-1`);
  });

  it("splits the page at the headings", () => {
    const sectioned = splitSections(pageOf(HTML), SOURCE);
    expect(sectioned.page.url).toBe(BASE);
    expect(sectioned.sections.map((s) => [s.id, s.title])).toEqual([
      ["one", "One"],
      ["section-2", "Two"],
      ["section-3", "Three"],
    ]);
    const [one, two, three] = sectioned.sections;
    // 前書きは最初の部分に入り, 部分の最後に, 次の部分へのリンクが付く
    expect(one.html).toContain("<p>Lead</p>");
    expect(one.html).toContain(`<a href="${BASE}?section=section-2">→ Two</a>`);
    expect(three.html).not.toContain("section-next");
    expect(three.html).toContain("Loose text");
    // 名前の印に id が付く (id があるものと, 空の名前と, 使われている名前には, 付けない)
    expect(two.html).toContain('<a name="r-two" id="r-two"></a>');
    expect(two.html).toContain('<a id="taken" name="taken-name"></a>');
    expect(three.html).toContain('<a name="taken"></a>');
    expect(sectioned.anchors.get("r-two")).toBe("section-2");
    expect(sectioned.anchors.get("main")).toBe("one");
    expect(sectioned.anchors.get("taken")).toBe("section-2");
  });

  it("points the links in the page to the sections", () => {
    const [one] = splitSections(pageOf(HTML), SOURCE).sections;
    expect(one.html).toContain(`href="${BASE}?section=section-2#r-two"`);
    expect(one.html).toContain(`href="${BASE}#unknown"`);
    expect(one.html).toContain('href="https://example.org/other#r-two"');
  });

  it("builds the menu from the headings", () => {
    const { menu } = splitSections(pageOf(HTML), SOURCE);
    expect(menu).toEqual([
      {
        title: "One",
        url: `${BASE}?section=one`,
        children: [
          {
            title: "One A",
            url: `${BASE}?section=one#one-a`,
            children: [
              { title: "Rule 1", url: `${BASE}?section=one#one-a-1`, children: [] },
              { title: "No id", url: `${BASE}?section=one`, children: [] },
            ],
          },
        ],
      },
      {
        title: "Two",
        url: `${BASE}?section=section-2`,
        children: [
          { title: "Deep", url: `${BASE}?section=section-2#deep`, children: [] },
          { title: "Two X", url: `${BASE}?section=section-2#two-x`, children: [] },
        ],
      },
      { title: "Three", url: `${BASE}?section=section-3`, children: [] },
    ]);
    expect(splitSections(pageOf(HTML), { split: "h1", menuLevels: [] }).menu).toEqual([]);
  });

  it("keeps a page without the headings as one section", () => {
    const sectioned = splitSections(pageOf("<p>Only</p>"), SOURCE);
    expect(sectioned.sections).toEqual([{ id: "", title: "Book", html: "<p>Only</p>" }]);
  });

  it("opens the section that has the anchor", () => {
    const sectioned = splitSections(pageOf(HTML), SOURCE);
    expect(resolveSectionUrl(sectioned, `${BASE}#r-two`)).toBe(`${BASE}?section=section-2#r-two`);
    expect(resolveSectionUrl(sectioned, `${BASE}?section=one#r-two`)).toBe(
      `${BASE}?section=section-2#r-two`,
    );
    expect(resolveSectionUrl(sectioned, `${BASE}?section=section-3`)).toBe(
      `${BASE}?section=section-3`,
    );
    expect(resolveSectionUrl(sectioned, `${BASE}?section=nothing#unknown`)).toBe(
      `${BASE}?section=one#unknown`,
    );
    expect(resolveSectionUrl(sectioned, BASE)).toBe(`${BASE}?section=one`);
  });

  it("makes a page of a section", () => {
    const sectioned = splitSections(pageOf(HTML), SOURCE);
    const page = sectionPage(sectioned, `${BASE}?section=section-2#r-two`);
    expect(page.url).toBe(`${BASE}?section=section-2`);
    expect(page.title).toBe("Two");
    expect(page.html).toContain("Two X");
    expect(page.menu).toBe(sectioned.menu);
    expect(sectionPage(sectioned, BASE).title).toBe("One");
    const untitled = splitSections(pageOf('<h1 id="e"></h1><p>x</p>'), SOURCE);
    expect(sectionPage(untitled, `${BASE}?section=e`).title).toBe("Book");
  });
});
