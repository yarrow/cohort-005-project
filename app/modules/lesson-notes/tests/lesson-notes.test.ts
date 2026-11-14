import { describe, it, expect } from "vitest";
import { describeNoteDraft, type NoteDraft } from "../index";

const saved = {
  body: "Result types beat throwing",
  updatedAt: "2026-11-14T10:00:00.000Z",
};

function draft(overrides: Partial<NoteDraft>): NoteDraft {
  return {
    draft: "",
    saved: null,
    isSaving: false,
    error: undefined,
    maxLength: 20,
    ...overrides,
  };
}

describe("describeNoteDraft", () => {
  it("is empty with nothing to save when there is no note and no draft", () => {
    expect(describeNoteDraft(draft({}))).toEqual({
      status: { kind: "empty" },
      canSave: false,
    });
  });

  it("reports unsaved changes for a new draft and lets the Student save", () => {
    expect(describeNoteDraft(draft({ draft: "hello" }))).toEqual({
      status: { kind: "unsaved" },
      canSave: true,
    });
  });

  it("does not offer to save a draft that is only whitespace", () => {
    expect(describeNoteDraft(draft({ draft: "   " })).canSave).toBe(false);
  });

  it("reports when the saved note was last edited, with nothing to save", () => {
    expect(
      describeNoteDraft(draft({ draft: saved.body, saved, maxLength: 100 }))
    ).toEqual({
      status: { kind: "saved", updatedAt: saved.updatedAt },
      canSave: false,
    });
  });

  it("reports unsaved changes once the draft differs from the saved note", () => {
    const result = describeNoteDraft(
      draft({ draft: "Result types", saved, maxLength: 100 })
    );
    expect(result).toEqual({ status: { kind: "unsaved" }, canSave: true });
  });

  it("reports saving while the save is in flight, and blocks a second save", () => {
    expect(
      describeNoteDraft(draft({ draft: "hello", isSaving: true }))
    ).toEqual({ status: { kind: "saving" }, canSave: false });
  });

  it("says how far over the limit a draft is, and blocks saving it", () => {
    expect(describeNoteDraft(draft({ draft: "x".repeat(23) }))).toEqual({
      status: { kind: "too-long", over: 3 },
      canSave: false,
    });
  });

  it("allows a draft exactly at the limit", () => {
    expect(describeNoteDraft(draft({ draft: "x".repeat(20) })).canSave).toBe(
      true
    );
  });

  it("shows the server's error for an unsaved draft, and allows a retry", () => {
    expect(
      describeNoteDraft(draft({ draft: "hello", error: "Could not save" }))
    ).toEqual({
      status: { kind: "error", message: "Could not save" },
      canSave: true,
    });
  });

  it("drops a stale error once the draft matches the saved note", () => {
    expect(
      describeNoteDraft(
        draft({ draft: saved.body, saved, error: "old", maxLength: 100 })
      ).status
    ).toEqual({ kind: "saved", updatedAt: saved.updatedAt });
  });

  it("treats a draft as saved when it differs from the note only by surrounding whitespace, as the server trims it", () => {
    expect(
      describeNoteDraft(
        draft({ draft: `  ${saved.body}\n`, saved, maxLength: 100 })
      )
    ).toEqual({
      status: { kind: "saved", updatedAt: saved.updatedAt },
      canSave: false,
    });
  });

  it("does not count surrounding whitespace against the limit", () => {
    expect(
      describeNoteDraft(draft({ draft: `${"x".repeat(20)}\n\n` })).status
    ).toEqual({ kind: "unsaved" });
  });
});
