"use client";

import { useEffect, useMemo, useState } from "react";

interface ThumbnailCopy {
  productNameLabel: string;
  headline: string;
  subline: string;
  badge: string;
  cta: string;
}

interface StudioData {
  productName: string;
  imageUrls: string[];
  suggestedCopy: ThumbnailCopy;
  saved: { sourceImageUrl: string; copy: ThumbnailCopy } | null;
  previewDataUrl: string | null;
}

interface ProductThumbnailStudioProps {
  brandLinkId: string;
  productName: string;
  onClose: () => void;
}

const COPY_FIELDS: Array<{ key: keyof ThumbnailCopy; label: string; hint: string; maxLength: number }> = [
  { key: "productNameLabel", label: "제품명 라벨", hint: "제품을 정확히 식별하는 이름", maxLength: 36 },
  { key: "headline", label: "메인 카피", hint: "한 가지 구매 판단만 표현", maxLength: 24 },
  { key: "subline", label: "보조 카피", hint: "확인할 특징 2~3개", maxLength: 44 },
  { key: "badge", label: "상단 배지", hint: "구매 체크처럼 짧게", maxLength: 16 },
  { key: "cta", label: "하단 문구", hint: "장단점 보기처럼 중립적으로", maxLength: 20 },
];

export default function ProductThumbnailStudio({
  brandLinkId,
  productName,
  onClose,
}: ProductThumbnailStudioProps) {
  const [data, setData] = useState<StudioData | null>(null);
  const [sourceImageUrl, setSourceImageUrl] = useState("");
  const [copy, setCopy] = useState<ThumbnailCopy>({
    productNameLabel: productName,
    headline: "구매 전 확인",
    subline: "장단점 빠르게 체크",
    badge: "구매 체크",
    cta: "장단점 보기",
  });
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch(`/api/brandlinks/${encodeURIComponent(brandLinkId)}/thumbnail`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload?.success) throw new Error(payload?.error || "썸네일 정보를 불러오지 못했습니다.");
        return payload.data as StudioData;
      })
      .then((nextData) => {
        if (!active) return;
        setData(nextData);
        setCopy(nextData.saved?.copy || nextData.suggestedCopy);
        setSourceImageUrl(nextData.saved?.sourceImageUrl || nextData.imageUrls[0] || "");
        setPreviewDataUrl(nextData.previewDataUrl);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "썸네일 정보를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [brandLinkId]);

  const canGenerate = useMemo(
    () => Boolean(sourceImageUrl && copy.productNameLabel.trim() && copy.headline.trim()),
    [copy.headline, copy.productNameLabel, sourceImageUrl],
  );

  const generate = async (save: boolean) => {
    if (!canGenerate) return;
    setGenerating(true);
    setError(null);
    setSavedMessage(null);
    try {
      const response = await fetch(`/api/brandlinks/${encodeURIComponent(brandLinkId)}/thumbnail`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceImageUrl, copy, save }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.success) throw new Error(payload?.error || "썸네일 생성에 실패했습니다.");
      setPreviewDataUrl(payload.data.previewDataUrl);
      if (save) setSavedMessage("저장했습니다. 이 썸네일이 실제 발행 첫 이미지로 사용됩니다.");
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "썸네일 생성에 실패했습니다.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" role="dialog" aria-modal="true" aria-label="제품 썸네일 만들기">
      <div className="max-h-[94vh] w-full max-w-6xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">제품 사진 썸네일 만들기</h2>
            <p className="mt-1 text-sm text-slate-500">실제 제품 사진에 검증 가능한 카피를 합성합니다.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-slate-500 hover:bg-slate-100" aria-label="닫기">✕</button>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-500">상품 사진과 추천 문구를 불러오는 중...</div>
        ) : (
          <div className="grid gap-6 p-6 lg:grid-cols-[1fr_1.05fr]">
            <div className="space-y-6">
              <section>
                <h3 className="font-semibold text-slate-900">1. 실제 제품 사진 선택</h3>
                <p className="mt-1 text-xs text-slate-500">리뷰·쿠폰 배너가 아닌 제품이 크게 보이는 사진을 고르세요.</p>
                {data?.imageUrls.length ? (
                  <div className="mt-3 grid grid-cols-4 gap-2">
                    {data.imageUrls.map((imageUrl, index) => (
                      <button
                        type="button"
                        key={`${imageUrl}-${index}`}
                        onClick={() => setSourceImageUrl(imageUrl)}
                        className={`overflow-hidden rounded-xl border-2 bg-slate-50 p-1 ${sourceImageUrl === imageUrl ? "border-blue-600 ring-2 ring-blue-100" : "border-transparent hover:border-slate-300"}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={imageUrl} alt={`제품 사진 ${index + 1}`} className="aspect-square w-full rounded-lg object-contain" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">사용할 제품 사진이 없습니다. 상품 동기화를 먼저 실행하세요.</div>
                )}
              </section>

              <section>
                <h3 className="font-semibold text-slate-900">2. 카피라이팅</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {COPY_FIELDS.map((field) => (
                    <label key={field.key} className={field.key === "subline" ? "sm:col-span-2" : ""}>
                      <span className="flex items-center justify-between text-sm font-medium text-slate-700">
                        {field.label}
                        <span className="text-xs text-slate-400">{copy[field.key].length}/{field.maxLength}</span>
                      </span>
                      <input
                        value={copy[field.key]}
                        maxLength={field.maxLength}
                        onChange={(event) => setCopy((current) => ({ ...current, [field.key]: event.target.value }))}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        placeholder={field.hint}
                      />
                    </label>
                  ))}
                </div>
                <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">최저가·1위·품절 임박·직접 사용 같은 근거 없는 문구는 저장되지 않습니다.</p>
              </section>
            </div>

            <section className="rounded-2xl bg-slate-950 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-white">3. 완성 미리보기</h3>
                  <p className="text-xs text-slate-400">1600×900 · 네이버 첫 이미지용</p>
                </div>
              </div>
              <div className="mt-4 flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-slate-900">
                {previewDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewDataUrl} alt="생성된 제품 썸네일" className="h-full w-full object-contain" />
                ) : (
                  <p className="px-6 text-center text-sm text-slate-400">제품 사진과 카피를 확인한 뒤 미리보기를 생성하세요.</p>
                )}
              </div>
              {error && <p className="mt-3 rounded-lg bg-red-950/70 px-3 py-2 text-sm text-red-200">{error}</p>}
              {savedMessage && <p className="mt-3 rounded-lg bg-emerald-950/70 px-3 py-2 text-sm text-emerald-200">{savedMessage}</p>}
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button type="button" disabled={!canGenerate || generating} onClick={() => void generate(false)} className="rounded-xl border border-slate-600 px-4 py-3 font-semibold text-white hover:bg-slate-800 disabled:opacity-40">
                  {generating ? "생성 중..." : "미리보기 생성"}
                </button>
                <button type="button" disabled={!canGenerate || generating} onClick={() => void generate(true)} className="rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-500 disabled:opacity-40">
                  {generating ? "저장 중..." : "생성하고 발행에 적용"}
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
