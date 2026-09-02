"use client";

import { useEffect, useMemo, useState } from "react";

interface ThumbnailCopy {
  productNameLabel: string;
  headline: string;
  subline: string;
  badge: string;
  cta: string;
}

interface ThumbnailMood {
  id: string;
  label: string;
  description: string;
}

interface ThumbnailQc {
  checked: boolean;
  pass: boolean;
  score: number;
  failures: string[];
  note: string;
}

interface StudioData {
  productName: string;
  connectKind: "SHOPPING" | "TRAVEL";
  imageUrls: string[];
  suggestedCopy: ThumbnailCopy;
  saved: { sourceImageUrl: string; copy: ThumbnailCopy; style?: string } | null;
  previewDataUrl: string | null;
  engine: "gpt-image" | "local";
  moods: ThumbnailMood[];
  qcMinScore: number;
  maxAttempts: number;
}

interface GenerateResult {
  previewDataUrl: string | null;
  engine: "gpt-image" | "local";
  qc: ThumbnailQc | null;
  attempts: number;
  logs: string[];
}

interface ProductThumbnailStudioProps {
  brandLinkId: string;
  productName: string;
  onClose: () => void;
}

const COPY_FIELDS: Array<{ key: keyof ThumbnailCopy; label: string; hint: string; maxLength: number; recommended?: number }> = [
  { key: "productNameLabel", label: "제품명 라벨", hint: "제품을 정확히 식별하는 이름", maxLength: 36 },
  { key: "headline", label: "메인 카피", hint: "10자 이내가 가장 정확하게 그려집니다", maxLength: 24, recommended: 10 },
  { key: "subline", label: "보조 카피", hint: "확인할 특징 2~3개", maxLength: 44 },
  { key: "badge", label: "상단 배지", hint: "구매 체크처럼 짧게", maxLength: 16 },
  { key: "cta", label: "하단 문구", hint: "장단점 보기처럼 중립적으로", maxLength: 20 },
];

const FAILURE_LABELS: Record<string, string> = {
  productDistorted: "제품 왜곡",
  productNameMissing: "제품명 누락",
  koreanTypo: "한글 오탈자",
  textCut: "글자 잘림",
  productSmall: "제품이 작음",
  notPhotoreal: "실사감 부족",
  mockup: "불필요한 목업",
  forbiddenInfo: "금지 정보",
  lowContrast: "대비 부족",
  extraText: "불필요한 문구",
};

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
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [syncingImages, setSyncingImages] = useState(false);
  const [mood, setMood] = useState("");
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
        const savedMood = nextData.saved?.style && nextData.moods.some((item) => item.id === nextData.saved?.style) ? nextData.saved.style : nextData.moods[0]?.id || "";
        setMood(savedMood);
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

  useEffect(() => {
    if (!generating) return;
    setElapsed(0);
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [generating]);

  const canGenerate = useMemo(
    () => Boolean(sourceImageUrl && copy.productNameLabel.trim() && copy.headline.trim()),
    [copy.headline, copy.productNameLabel, sourceImageUrl],
  );
  const isGenerative = data?.engine === "gpt-image";

  const generate = async (save: boolean, engine: "gpt-image" | "local" = isGenerative ? "gpt-image" : "local") => {
    if (!canGenerate) return;
    setGenerating(true);
    setError(null);
    setSavedMessage(null);
    try {
      const response = await fetch(`/api/brandlinks/${encodeURIComponent(brandLinkId)}/thumbnail`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceImageUrl, copy, mood, save, engine }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.success) throw new Error(payload?.error || "썸네일 생성에 실패했습니다.");
      setPreviewDataUrl(payload.data.previewDataUrl);
      setResult(payload.data as GenerateResult);
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
            <h2 className="text-xl font-bold text-slate-900">{data?.connectKind === "TRAVEL" ? "여행 썸네일 만들기" : "제품 썸네일 만들기"}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {isGenerative
                ? `gpt-image 가 문구까지 한 번에 그리고, 비전 검수(${data?.qcMinScore ?? 95}점 이상)를 통과한 결과만 사용합니다. 최대 ${data?.maxAttempts ?? 4}회 자동 재생성.`
                : "OpenAI API 키가 없어 로컬 합성 방식으로 만듭니다. 설정에서 키를 넣으면 생성형 썸네일을 쓸 수 있어요."}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-slate-500 hover:bg-slate-100" aria-label="닫기">✕</button>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-500">{syncingImages ? "상세 페이지에서 실제 사진을 자동 수집하는 중..." : "상품 사진과 추천 문구를 불러오는 중..."}</div>
        ) : (
          <div className="grid gap-6 p-6 lg:grid-cols-[1fr_1.05fr]">
            <div className="space-y-6">
              <section className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">1</span><h3 className="font-semibold text-slate-900">참조 사진 선택</h3></div>
                <p className="mt-2 text-xs text-slate-500">{data?.connectKind === "TRAVEL" ? "여행지가 잘 드러나는 장면을 고르세요. 이 사진의 장소·분위기를 기준으로 그립니다." : "상품 형태와 색상이 정확히 보이는 원본을 고르세요. 이 사진을 기준으로 상품을 충실하게 그립니다."}</p>
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
                <div className="flex items-center gap-2"><span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white ${data?.connectKind === "TRAVEL" ? "bg-amber-500" : "bg-blue-600"}`}>2</span><h3 className="font-semibold text-slate-900">장면·무드</h3></div>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {(data?.moods || []).map((option) => (
                    <button key={option.id} type="button" onClick={() => setMood(option.id)} className={`rounded-xl border p-3 text-left transition ${mood === option.id ? "border-blue-600 bg-blue-50 ring-2 ring-blue-100" : "border-slate-200 hover:border-slate-400"}`}>
                      <span className="block text-sm font-bold text-slate-900">{option.label}</span><span className="mt-1 block text-[11px] text-slate-500">{option.description}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-600 text-xs font-bold text-white">3</span><h3 className="font-semibold text-slate-900">핵심 문구</h3></div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {COPY_FIELDS.filter((field) => showAdvancedCopy || field.key === "headline" || field.key === "subline").map((field) => {
                    const overRecommended = field.recommended !== undefined && copy[field.key].length > field.recommended;
                    return (
                      <label key={field.key} className={field.key === "subline" ? "sm:col-span-2" : ""}>
                        <span className="flex items-center justify-between text-sm font-medium text-slate-700">
                          {field.label}
                          <span className={`text-xs ${overRecommended ? "text-amber-600" : "text-slate-400"}`}>
                            {copy[field.key].length}/{field.maxLength}{field.recommended ? ` (권장 ${field.recommended})` : ""}
                          </span>
                        </span>
                        <input
                          value={copy[field.key]}
                          maxLength={field.maxLength}
                          onChange={(event) => setCopy((current) => ({ ...current, [field.key]: event.target.value }))}
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                          placeholder={field.hint}
                        />
                      </label>
                    );
                  })}
                </div>
                <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">검증되지 않은 최저가·1위·직접 체험 문구는 자동 차단됩니다. 한글 문구는 짧을수록 정확하게 그려집니다.</p>
              </section>
            </div>

            <section className="rounded-2xl bg-slate-950 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-white">완성 미리보기</h3>
                  <p className="text-xs text-slate-400">1024×1024 · 네이버 첫 이미지용 (검색 결과 1:1 크롭 대응)</p>
                </div>
                {result && (
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${result.engine === "gpt-image" ? "bg-emerald-900 text-emerald-200" : "bg-slate-800 text-slate-300"}`}>
                    {result.engine === "gpt-image" ? "gpt-image" : "로컬 합성"}
                  </span>
                )}
              </div>
              <div className="mt-4 flex aspect-square items-center justify-center overflow-hidden rounded-xl bg-slate-900">
                {generating ? (
                  <p className="px-6 text-center text-sm text-slate-300">
                    {isGenerative ? `생성 → 검수 → 교정 중... ${elapsed}초` : `합성 중... ${elapsed}초`}
                    <br />
                    <span className="text-xs text-slate-500">gpt-image 는 시도당 수십 초가 걸립니다.</span>
                  </p>
                ) : previewDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewDataUrl} alt="생성된 썸네일" className="h-full w-full object-contain" />
                ) : (
                  <p className="px-6 text-center text-sm text-slate-400">왼쪽에서 사진과 무드를 고른 뒤 생성하세요.</p>
                )}
              </div>
              {result?.qc && (
                <div className="mt-3 rounded-lg bg-slate-900 px-3 py-2 text-xs text-slate-300">
                  {result.qc.checked ? (
                    <>
                      <span className={`font-semibold ${result.qc.pass ? "text-emerald-300" : "text-amber-300"}`}>검수 {result.qc.score}점 {result.qc.pass ? "통과" : "미달"}</span>
                      <span className="ml-2 text-slate-400">시도 {result.attempts}회</span>
                      {result.qc.failures.length > 0 && (
                        <span className="ml-2 text-slate-400">· {result.qc.failures.map((code) => FAILURE_LABELS[code] || code).join(", ")}</span>
                      )}
                      {result.qc.note && <p className="mt-1 text-slate-500">{result.qc.note}</p>}
                    </>
                  ) : (
                    <span className="text-slate-400">검수 생략 · {result.qc.note}</span>
                  )}
                </div>
              )}
              {result && result.logs.length > 0 && (
                <details className="mt-2 text-xs text-slate-500">
                  <summary className="cursor-pointer">생성 로그 {result.logs.length}줄</summary>
                  <ul className="mt-1 space-y-0.5">{result.logs.map((line, index) => <li key={index}>{line}</li>)}</ul>
                </details>
              )}
              {error && <p className="mt-3 rounded-lg bg-red-950/70 px-3 py-2 text-sm text-red-200">{error}</p>}
              {savedMessage && <p className="mt-3 rounded-lg bg-emerald-950/70 px-3 py-2 text-sm text-emerald-200">{savedMessage}</p>}
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button type="button" disabled={!canGenerate || generating} onClick={() => void generate(false)} className="rounded-xl border border-slate-600 px-4 py-3 font-semibold text-white hover:bg-slate-800 disabled:opacity-40">
                  {generating ? "만드는 중..." : previewDataUrl ? "다시 생성" : "생성"}
                </button>
                <button type="button" disabled={!canGenerate || generating} onClick={() => void generate(true)} className="rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-500 disabled:opacity-40">
                  {generating ? "적용 중..." : "생성해서 적용"}
                </button>
              </div>
              {isGenerative && (
                <button type="button" disabled={!canGenerate || generating} onClick={() => void generate(false, "local")} className="mt-2 w-full rounded-xl px-4 py-2 text-xs text-slate-400 hover:text-white disabled:opacity-40">
                  빠른 로컬 합성으로 만들기 (원본 사진 + 문구 합성, 생성형 아님)
                </button>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
