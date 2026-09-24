"use client";

import { useState } from "react";
import {
  EXPERIENCE_FIELDS,
  MIN_EXPERIENCE_NOTES_CHARS,
  composeExperienceNotes,
  parseExperienceNotes,
} from "@/lib/experience-notes";

/**
 * 직접 써보거나 다녀온 체험 메모를 상품 단위로 저장한다. 메모가 있으면 원고가 1인칭 체험형으로 바뀌고,
 * 전체 리뷰와 주제 글이 같은 메모를 쓴다. 메모에 없는 체험은 원고에 쓰지 않는다.
 */
export default function ExperienceNotesPanel({
  linkId,
  productName,
  connectKind,
  initialNotes,
  isTopicPost,
  onClose,
  onSaved,
}: {
  linkId: string;
  productName: string;
  connectKind: "SHOPPING" | "TRAVEL";
  initialNotes: string | null;
  isTopicPost: boolean;
  onClose: () => void;
  onSaved: (notes: string | null) => void | Promise<void>;
}) {
  const fields = EXPERIENCE_FIELDS[connectKind];
  const [values, setValues] = useState<Record<string, string>>(() => parseExperienceNotes(connectKind, initialNotes));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const composed = composeExperienceNotes(connectKind, values);
  const enough = composed.length >= MIN_EXPERIENCE_NOTES_CHARS;

  const save = async (notes: string | null) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/brandlinks/${linkId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ experienceNotes: notes }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || "체험 메모를 저장하지 못했습니다.");
      await onSaved(notes);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "체험 메모를 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-labelledby="experience-notes-title">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div className="min-w-0">
            <h2 id="experience-notes-title" className="text-lg font-bold text-slate-900">
              {connectKind === "TRAVEL" ? "직접 다녀온 체험 메모" : "직접 사용한 체험 메모"}
            </h2>
            <p className="mt-0.5 line-clamp-1 text-sm text-slate-500">{productName}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100">닫기</button>
        </div>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
          <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs leading-5 text-indigo-800">
            메모가 있으면 원고를 &ldquo;써보니·가보니&rdquo; 같은 1인칭 체험 후기로 씁니다. 메모에 적은 사실만 체험으로 쓰고, 없는 체험·수치는 만들지 않아요.
            {isTopicPost ? " 이 글은 원본 상품의 체험 메모도 함께 사용합니다." : " 같은 상품의 주제 글도 이 메모를 함께 씁니다."}
          </p>
          {fields.map((field) => (
            <label key={field.key} className="block">
              <span className="mb-1 block text-sm font-semibold text-slate-800">{field.label}</span>
              <textarea
                value={values[field.key] || ""}
                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                placeholder={field.placeholder}
                rows={2}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none"
              />
            </label>
          ))}
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <span className={`text-xs ${enough ? "text-emerald-700" : "text-slate-500"}`}>
              {enough ? "체험형 원고로 작성됩니다." : `${MIN_EXPERIENCE_NOTES_CHARS}자 이상 적으면 체험형 원고로 작성됩니다.`}
            </span>
            <div className="flex gap-2">
              {initialNotes && (
                <button type="button" disabled={saving} onClick={() => void save(null)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 disabled:opacity-50">
                  메모 삭제
                </button>
              )}
              <button type="button" disabled={saving || !composed} onClick={() => void save(composed)} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {saving ? "저장 중…" : "저장"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
