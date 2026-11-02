import { createTranslator, IntlErrorCode } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import id from "../../messages/id.json";
import ja from "../../messages/ja.json";

const locales = { en, id, ja } as const;

function leaves(value: unknown, prefix = ""): [string, string][] {
  if (typeof value === "string") return [[prefix, value]];
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) =>
      leaves(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [];
}

describe("message catalogs", () => {
  it("have the same keys in every language", () => {
    const keys = (messages: unknown) => leaves(messages).map(([key]) => key);
    expect(keys(id)).toEqual(keys(en));
    expect(keys(ja)).toEqual(keys(en));
  });

  // A "<" in the text is read as a rich-text tag and the whole message fails to render, showing
  // its key instead. Literal angle brackets must be quoted with an apostrophe, e.g. '<name>'.
  for (const locale of Object.keys(locales) as (keyof typeof locales)[]) {
    const messages = locales[locale];
    it(`${locale}: every message parses`, () => {
      const invalid: string[] = [];
      const t = createTranslator({
        locale,
        messages: messages as never,
        onError: (error) => {
          if (error.code === IntlErrorCode.INVALID_MESSAGE) invalid.push(error.message);
        },
      }) as (key: string) => string;
      for (const [key] of leaves(messages)) t(key);
      expect(invalid).toEqual([]);
    });
  }
});
