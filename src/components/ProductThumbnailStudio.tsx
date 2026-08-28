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
  connectKind: "SHOPPING" | "TRAVEL";
  imageUrls: string[];
  suggestedCopy: ThumbnailCopy;
  saved: { sourceImageUrl: string; copy: ThumbnailCopy; style?: string } | null;
  previewDataUrl: string | null;
}

const STYLE_OPTIONS = {
  SHOPPING: [
    { value: "shopping-clean", label: "클린 리뷰", description: "차분하고 신뢰감 있게" },
    { value: "shopping-bold", label: "볼드 포커스", description: "상품을 강하게 강조" },
    { value: "shopping-soft", label: "소프트 라이프", description: "밝고 생활감 있게" },
  ],
  TRAVEL: [
    { value: "travel-editorial", label: "여행 매거진", description: "고급 에디토리얼 표지" },
    { value: "travel-postcard", label: "감성 엽서", description: "따뜻한 여행 기록" },
    { value: "travel-route", label: "루트 노트", description: "동선과 일정 중심" },
  ],
} as const;

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
  const [syncingImages, setSyncingImages] = useState(false);
  const [style, setStyle] = useState("shopping-clean");
  const [showAdvancedCopy, setShowAdvancedCopy] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const thumbnailUrl = `/api/brandlinks/${encodeURIComponent(brandLinkId)}/thumbnail`;
      const read = async () => {
        const response = await fetch(thumbnailUrl, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok || !payload?.success) throw new Error(payload?.error || "썸네일 정보를 불러오지 못했습니다.");
        return payload.data as StudioData;
      };
      let nextData = await read();
      if (nextData.imageUrls.length === 0) {
        setSyncingImages(true);
        const response = await fetch(`/api/brandlinks/${encodeURIComponent(brandLinkId)}/scrape`, { method: "POST" });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success) {
          throw new Error(payload?.error || "여행상품 사진을 자동으로 가져오지 못했습니다.");
        }
        nextData = await read();
      }
      return nextData;
    };
    void load()
      .then((nextData) => {
        if (!active) return;
        setData(nextData);
        setCopy(nextData.saved?.copy || nextData.suggestedCopy);
        setSourceImageUrl(nextData.saved?.sourceImageUrl || nextData.imageUrls[0] || "");
        setPreviewDataUrl(nextData.previewDataUrl);
        setStyle(nextData.saved?.style || (nextData.connectKind === "TRAVEL" ? "travel-editorial" : "shopping-clean"));
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "썸네일 정보를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          setSyncingImages(false);
        }
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
        body: JSON.stringify({ sourceImageUrl, copy, style, save }),
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
            <h2 className="text-xl font-bold text-slate-900">{data?.connectKind === "TRAVEL" ? "여행 사진 썸네일 만들기" : "제품 사진 썸네일 만들기"}</h2>
            <p className="mt-1 text-sm text-slate-500">사진 선택, 스타일 선택, 적용까지 세 단계면 끝납니다.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-slate-500 hover:bg-slate-100" aria-label="닫기">✕</button>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-500">{syncingImages ? "상세 페이지에서 실제 여행 사진을 자동 수집하는 중..." : "상품 사진과 추천 문구를 불러오는 중..."}</div>
        ) : (
          <div className="grid gap-6 p-6 lg:grid-cols-[1fr_1.05fr]">
            <div className="space-y-6">
              <section className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">1</span><h3 className="font-semibold text-slate-900">대표 사진 선택</h3></div>
                <p className="mt-2 text-xs text-slate-500">{data?.connectKind === "TRAVEL" ? "가장 매력적인 여행지 장면을 고르세요." : "상품 형태와 색상이 정확히 보이는 원본을 고르세요. 상품 자체는 다시 그리지 않습니다."}</p>
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

              <section className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center gap-2"><span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white ${data?.connectKind === "TRAVEL" ? "bg-amber-500" : "bg-blue-600"}`}>2</span><h3 className="font-semibold text-slate-900">디자인 스타일</h3></div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {(data ? STYLE_OPTIONS[data.connectKind] : STYLE_OPTIONS.SHOPPING).map((option) => (
                    <button key={option.value} type="button" onClick={() => setStyle(option.value)} className={`rounded-xl border p-3 text-left transition ${style === option.value ? "border-blue-600 bg-blue-50 ring-2 ring-blue-100" : "border-slate-200 hover:border-slate-400"}`}>
                      <span className="block text-sm font-bold text-slate-900">{option.label}</span><span className="mt-1 block text-[11px] text-slate-500">{option.description}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center justify-between"><div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-600 text-xs font-bold text-white">3</span><h3 className="font-semibold text-slate-900">핵심 문구</h3></div><button type="button" onClick={() => setShowAdvancedCopy((value) => !value)} className="text-xs font-semibold text-slate-500 hover:text-slate-900">{showAdvancedCopy ? "간단히" : "상세 설정"}</button></div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {COPY_FIELDS.filter((field) => showAdvancedCopy || field.key === "headline" || field.key === "subline").map((field) => (
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
                <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">검증되지 않은 최저가·1위·직접 체험 문구는 자동 차단됩니다.</p>
              </section>
            </div>

            <section className="rounded-2xl bg-slate-950 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-white">완성 미리보기</h3>
                  <p className="text-xs text-slate-400">1600×900 · 네이버 첫 이미지용</p>
                </div>
              </div>
              <div className="mt-4 flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-slate-900">
                {previewDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewDataUrl} alt="생성된 제품 썸네일" className="h-full w-full object-contain" />
                ) : (
                  <p className="px-6 text-center text-sm text-slate-400">왼쪽에서 사진과 스타일을 고른 뒤 미리보기를 만드세요.</p>
                )}
              </div>
              {error && <p className="mt-3 rounded-lg bg-red-950/70 px-3 py-2 text-sm text-red-200">{error}</p>}
              {savedMessage && <p className="mt-3 rounded-lg bg-emerald-950/70 px-3 py-2 text-sm text-emerald-200">{savedMessage}</p>}
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button type="button" disabled={!canGenerate || generating} onClick={() => void generate(false)} className="rounded-xl border border-slate-600 px-4 py-3 font-semibold text-white hover:bg-slate-800 disabled:opacity-40">
                  {generating ? "만드는 중..." : "미리보기"}
                </button>
                <button type="button" disabled={!canGenerate || generating} onClick={() => void generate(true)} className="rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-500 disabled:opacity-40">
                  {generating ? "적용 중..." : "이 디자인 적용"}
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
