import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import { headCleanupScript } from "./head-cleanup";

/** A <head> as a sibling list: enough for the script's DOM calls. */
interface FakeNode {
  nodeType: number;
  nodeValue: string | null;
  name: string;
  nextSibling: FakeNode | null;
}

function fakeHead(nodes: Omit<FakeNode, "nextSibling">[]) {
  const list: FakeNode[] = nodes.map((node) => ({ ...node, nextSibling: null }));
  const relink = () => list.forEach((node, index) => (node.nextSibling = list[index + 1] ?? null));
  relink();
  const head = {
    get firstChild() {
      return list[0] ?? null;
    },
    removeChild(node: FakeNode) {
      list.splice(list.indexOf(node), 1);
      relink();
    },
  };
  return { head, names: () => list.map((node) => node.name) };
}

const element = (name: string) => ({ nodeType: 1, nodeValue: null, name });
const comment = (value: string) => ({ nodeType: 8, nodeValue: value, name: "#comment" });
const text = (value: string) => ({ nodeType: 3, nodeValue: value, name: `#text(${value})` });

const run = (head: unknown) => {
  Object.assign(globalThis, { document: { head } });
  new Function(headCleanupScript)();
};

describe("head cleanup before hydration", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "document");
  });

  test("removes the Netlify comment and the blank text around it, keeps every element", () => {
    const { head, names } = fakeHead([
      element("meta-charset"),
      text("\n"),
      comment(" This site is hosted on Netlify. Anyone can build and deploy a site\n     like this one for free "),
      element("meta-viewport"),
      element("link"),
      element("script"),
    ]);
    run(head);
    assert.deepEqual(names(), ["meta-charset", "meta-viewport", "link", "script"]);
  });

  test("keeps non-blank text and leaves a clean head unchanged", () => {
    const { head, names } = fakeHead([element("meta-charset"), text("x"), element("title")]);
    run(head);
    assert.deepEqual(names(), ["meta-charset", "#text(x)", "title"]);
  });

  test("does nothing without a head", () => {
    assert.doesNotThrow(() => run(null));
  });
});
