import { describe, expect, it } from "vitest";
import en from "../../../../messages/en.json";
import id from "../../../../messages/id.json";
import ja from "../../../../messages/ja.json";
import { HELP_SECTIONS, MAX_ITEMS } from "./sections";

const catalogs = { en, id, ja } as const;

describe("help guide catalog", () => {
  for (const [locale, messages] of Object.entries(catalogs)) {
    it(`${locale}: every section has a title, a lead paragraph and at least one item`, () => {
      const sections = messages.Help.sections as Record<string, Record<string, string>>;
      for (const section of HELP_SECTIONS) {
        const entry = sections[section];
        expect(entry?.title, `${section}.title`).toBeTruthy();
        expect(entry?.p1, `${section}.p1`).toBeTruthy();
        expect(entry?.i1, `${section}.i1`).toBeTruthy();
      }
    });

    it(`${locale}: no section is missing from the list or has more items than are shown`, () => {
      const sections = messages.Help.sections as Record<string, Record<string, string>>;
      expect(Object.keys(sections)).toEqual([...HELP_SECTIONS]);
      for (const section of HELP_SECTIONS) {
        const items = Object.keys(sections[section]).filter((key) => /^i\d+$/.test(key));
        expect(items.length, `${section} items`).toBeLessThanOrEqual(MAX_ITEMS);
        // Items are numbered without gaps, otherwise the page would stop at the first gap.
        expect(items).toEqual(items.map((_, n) => `i${n + 1}`));
      }
    });
  }
});
