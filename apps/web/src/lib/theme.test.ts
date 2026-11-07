import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import {
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  readThemePreference,
  resetThemePreferenceForTests,
  themeInitScript,
  writeThemePreference,
} from "./theme";

/** Minimal browser globals: window events, localStorage, matchMedia, <html>. */
class FakeBrowser {
  readonly window = new EventTarget();
  readonly media = new EventTarget() as EventTarget & { matches: boolean };
  readonly classes = new Set<string>();
  store = new Map<string, string>();
  setItemThrows = false;
  getItemThrows = false;

  /**
   * `storage`: "ok" (a working store, whose methods may be set to throw),
   * "getter-throws" (accessing `window.localStorage` throws, as with blocked
   * site data or sandboxed frames), or "absent" (no `localStorage` at all).
   */
  constructor(osDark: boolean, storageMode: "ok" | "getter-throws" | "absent" = "ok") {
    this.media.matches = osDark;
    const storage = {
      getItem: (key: string) => {
        if (this.getItemThrows) throw new Error("SecurityError");
        return this.store.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        if (this.setItemThrows) throw new Error("QuotaExceededError");
        this.store.set(key, value);
      },
    };
    Object.assign(this.window, { matchMedia: () => this.media });
    if (storageMode === "ok") Object.assign(this.window, { localStorage: storage });
    if (storageMode === "getter-throws") {
      Object.defineProperty(this.window, "localStorage", {
        get() {
          throw new Error("SecurityError: access denied");
        },
      });
    }
    const classes = this.classes;
    Object.assign(globalThis, {
      window: this.window,
      document: {
        documentElement: {
          classList: {
            toggle: (name: string, force: boolean) => {
              if (force) classes.add(name);
              else classes.delete(name);
            },
          },
        },
      },
    });
  }

  get dark(): boolean {
    return this.classes.has("dark");
  }

  /** Runs the exact inline script shipped in the root layout. */
  runInitScript(): void {
    new Function(themeInitScript)();
  }

  setOsDark(dark: boolean): void {
    this.media.matches = dark;
    this.media.dispatchEvent(new Event("change"));
  }

  /** Simulates another tab writing the preference. */
  otherTabWrites(value: string): void {
    this.store.set(THEME_STORAGE_KEY, value);
    const event = Object.assign(new Event("storage"), {
      key: THEME_STORAGE_KEY,
      newValue: value,
    });
    this.window.dispatchEvent(event);
  }
}

beforeEach(() => resetThemePreferenceForTests());

describe("theme preference with storage unavailable", () => {
  for (const choice of ["light", "dark"] as const) {
    test(`selecting ${choice} works when setItem throws`, () => {
      const browser = new FakeBrowser(choice === "light");
      browser.setItemThrows = true;
      browser.runInitScript();

      writeThemePreference(choice);

      assert.equal(readThemePreference(), choice, "selector keeps the selected mode");
      assert.equal(browser.dark, choice === "dark", "theme is applied");
    });
  }

  test("an OS change does not override an explicit selection", () => {
    const browser = new FakeBrowser(false);
    browser.setItemThrows = true;
    browser.runInitScript();

    writeThemePreference("light");
    browser.setOsDark(true);
    assert.equal(browser.dark, false);
    assert.equal(readThemePreference(), "light");

    writeThemePreference("dark");
    browser.setOsDark(false);
    assert.equal(browser.dark, true);
    assert.equal(readThemePreference(), "dark");
  });

  test("OS changes apply only while System is selected", () => {
    const browser = new FakeBrowser(false);
    browser.setItemThrows = true;
    browser.runInitScript();

    writeThemePreference("dark");
    writeThemePreference("system");
    assert.equal(browser.dark, false);
    browser.setOsDark(true);
    assert.equal(browser.dark, true);
    browser.setOsDark(false);
    assert.equal(browser.dark, false);
  });

  test("rendering works when storage reads throw", () => {
    const browser = new FakeBrowser(true);
    browser.getItemThrows = true;
    browser.runInitScript();

    assert.equal(readThemePreference(), "system");
    assert.equal(browser.dark, true, "falls back to System");
  });
});

describe("theme preference with localStorage unavailable", () => {
  for (const mode of ["getter-throws", "absent"] as const) {
    test(`${mode}: light, dark, and system can be selected; the selector and the applied theme agree`, () => {
      const browser = new FakeBrowser(true, mode);
      browser.runInitScript();
      assert.equal(readThemePreference(), "system");
      assert.equal(browser.dark, true, "starts on System (OS dark)");

      for (const [choice, expectedDark] of [
        ["light", false],
        ["dark", true],
        ["system", true],
      ] as const) {
        writeThemePreference(choice);
        assert.equal(readThemePreference(), choice, `selector shows ${choice}`);
        assert.equal(browser.dark, expectedDark, `${choice} is applied`);
      }
    });

    test(`${mode}: an OS change after an explicit light or dark selection is ignored`, () => {
      const browser = new FakeBrowser(false, mode);
      browser.runInitScript();

      writeThemePreference("light");
      browser.setOsDark(true);
      assert.equal(readThemePreference(), "light");
      assert.equal(browser.dark, false);

      writeThemePreference("dark");
      browser.setOsDark(false);
      assert.equal(readThemePreference(), "dark");
      assert.equal(browser.dark, true);
    });
  }
});

describe("theme preference with normal storage", () => {
  test("defaults to System and follows the OS", () => {
    const browser = new FakeBrowser(true);
    browser.runInitScript();
    assert.equal(readThemePreference(), "system");
    assert.equal(browser.dark, true);
    browser.setOsDark(false);
    assert.equal(browser.dark, false);
  });

  test("selection is persisted and restored in a new page session", () => {
    const browser = new FakeBrowser(false);
    browser.runInitScript();
    writeThemePreference("dark");
    assert.equal(browser.store.get(THEME_STORAGE_KEY), "dark");

    // Reload: fresh module state and a fresh init script, same storage.
    resetThemePreferenceForTests();
    const reloaded = new FakeBrowser(false);
    reloaded.store = browser.store;
    reloaded.runInitScript();
    assert.equal(readThemePreference(), "dark");
    assert.equal(reloaded.dark, true);
  });

  test("a selection made in another tab is adopted", () => {
    const browser = new FakeBrowser(false);
    browser.runInitScript();
    writeThemePreference("light");

    browser.otherTabWrites("dark");
    assert.equal(readThemePreference(), "dark");
    assert.equal(browser.dark, true);
  });

  test("invalid stored values fall back to System", () => {
    const browser = new FakeBrowser(true);
    browser.store.set(THEME_STORAGE_KEY, "purple");
    browser.runInitScript();
    assert.equal(readThemePreference(), "system");
    assert.equal(browser.dark, true);
  });

  test("the change event carries the selection", () => {
    const browser = new FakeBrowser(false);
    let detail: unknown;
    browser.window.addEventListener(THEME_CHANGE_EVENT, (event) => {
      detail = (event as CustomEvent<unknown>).detail;
    });
    writeThemePreference("light");
    assert.equal(detail, "light");
  });
});
