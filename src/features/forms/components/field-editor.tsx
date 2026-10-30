"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FIELD_TYPES, MAX_FIELDS, type FieldDef } from "@/features/forms/schemas/forms";

type Row = {
  /** Stable React key; unrelated to the field's stored key. */
  rowId: number;
  /** Absent for fields added in this session: the server chooses the key. */
  key?: string;
  label: string;
  type: FieldDef["type"];
  required: boolean;
  optionsText: string;
};

const fromField = (field: FieldDef, rowId: number): Row => ({
  rowId,
  key: field.key,
  label: field.label,
  type: field.type,
  required: field.required,
  optionsText: field.options?.join("\n") ?? "",
});

/** Serialized for the server action, which validates it again; nothing here is trusted. */
function serialize(rows: Row[]) {
  return JSON.stringify(
    rows.map((row) => ({
      ...(row.key ? { key: row.key } : {}),
      label: row.label,
      type: row.type,
      required: row.required,
      ...(row.type === "select"
        ? {
            options: row.optionsText
              .split("\n")
              .map((option) => option.trim())
              .filter(Boolean),
          }
        : {}),
    })),
  );
}

/**
 * Edits the field list of a form. After publishing (`labelsOnly`) only the labels are editable,
 * because the server refuses any other change.
 */
export function FieldEditor({
  initialFields,
  labelsOnly,
}: {
  initialFields: FieldDef[];
  labelsOnly: boolean;
}) {
  const t = useTranslations("Forms");
  const base = useId();
  const [rows, setRows] = useState<Row[]>(() => initialFields.map(fromField));
  const [nextId, setNextId] = useState(initialFields.length);

  const update = (rowId: number, change: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.rowId === rowId ? { ...row, ...change } : row)));
  const move = (index: number, by: -1 | 1) =>
    setRows((current) => {
      const target = index + by;
      if (target < 0 || target >= current.length) return current;
      const copy = [...current];
      [copy[index], copy[target]] = [copy[target]!, copy[index]!];
      return copy;
    });

  return (
    <div className="space-y-4">
      <input type="hidden" name="fields" value={serialize(rows)} />
      <ol className="space-y-3">
        {rows.map((row, index) => {
          const id = `${base}-${row.rowId}`;
          return (
            <li
              key={row.rowId}
              className="space-y-3 rounded-md border border-border bg-card p-3"
              aria-label={t("fieldNumber", { number: index + 1 })}
            >
              <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
                <div className="space-y-1">
                  <Label htmlFor={`${id}-label`}>{t("fieldLabel")}</Label>
                  <Input
                    id={`${id}-label`}
                    value={row.label}
                    onChange={(event) => update(row.rowId, { label: event.target.value })}
                    maxLength={80}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${id}-type`}>{t("fieldType")}</Label>
                  <Select
                    id={`${id}-type`}
                    value={row.type}
                    disabled={labelsOnly}
                    onChange={(event) =>
                      update(row.rowId, { type: event.target.value as FieldDef["type"] })
                    }
                  >
                    {FIELD_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {t(`types.${type}`)}
                      </option>
                    ))}
                  </Select>
                </div>
                <label className="flex items-center gap-2 self-end pb-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={row.required}
                    disabled={labelsOnly}
                    onChange={(event) => update(row.rowId, { required: event.target.checked })}
                  />
                  {t("fieldRequired")}
                </label>
              </div>
              {row.type === "select" && (
                <div className="space-y-1">
                  <Label htmlFor={`${id}-options`}>{t("fieldOptions")}</Label>
                  <textarea
                    id={`${id}-options`}
                    value={row.optionsText}
                    disabled={labelsOnly}
                    onChange={(event) => update(row.rowId, { optionsText: event.target.value })}
                    rows={4}
                    className="flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  />
                </div>
              )}
              {!labelsOnly && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    {t("moveUp")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={index === rows.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    {t("moveDown")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={rows.length === 1}
                    onClick={() =>
                      setRows((current) => current.filter((item) => item.rowId !== row.rowId))
                    }
                  >
                    {t("removeField")}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {!labelsOnly && (
        <Button
          variant="outline"
          disabled={rows.length >= MAX_FIELDS}
          onClick={() => {
            setRows((current) => [
              ...current,
              { rowId: nextId, label: "", type: "text", required: false, optionsText: "" },
            ]);
            setNextId(nextId + 1);
          }}
        >
          {t("addField")}
        </Button>
      )}
    </div>
  );
}
