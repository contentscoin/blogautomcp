"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface KeywordData {
    trending: string[];
    seasonal: string[];
    combinations: string[];
    tips: string[];
}

interface QualityFeedback {
    item: string;
    status: "pass" | "warn" | "fail";
    message: string;
}

interface QualityData {
    score: number;
    grade: string;
    feedback: QualityFeedback[];
    tips: string[];
}

type Category = "place" | "food" | "travel" | "parenting" | "product";

const CATEGORY_LABELS: Record<Category, string> = {
    place: "🏛️ 장소",
    food: "🍔 맛집",
    travel: "✈️ 여행",
    parenting: "👶 육아",
    product: "🛍️ 제품",
};

export default function KeywordsPage() {
    const [category, setCategory] = useState<Category>("place");
    const [location, setLocation] = useState("");
    const [baseKeyword, setBaseKeyword] = useState("");
    const [keywordData, setKeywordData] = useState<KeywordData | null>(null);
    const [qualityData, setQualityData] = useState<QualityData | null>(null);
    const [loading, setLoading] = useState(false);

    // 품질 체크용 상태
    const [checkTitle, setCheckTitle] = useState("");
    const [checkBody, setCheckBody] = useState("");
    const [checkImageCount, setCheckImageCount] = useState(5);
    const [checkHashtagCount, setCheckHashtagCount] = useState(15);

    const fetchKeywords = async () => {
        try {
            setLoading(true);
            const res = await fetch("/api/keywords", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "keywords",
                    category,
                    location,
                    baseKeyword,
                }),
            });
            const data = await res.json();
            if (data.success) {
                setKeywordData(data.data);
            }
        } catch (error) {
            console.error("키워드 조회 실패:", error);
        } finally {
            setLoading(false);
        }
    };

    const checkQuality = async () => {
        try {
            setLoading(true);
            const res = await fetch("/api/keywords", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "quality",
                    content: {
                        title: checkTitle,
                        body: checkBody,
                        imageCount: checkImageCount,
                        hashtagCount: checkHashtagCount,
                    },
                }),
            });
            const data = await res.json();
            if (data.success) {
                setQualityData(data.data);
            }
        } catch (error) {
            console.error("품질 분석 실패:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchKeywords();
    }, [category]);

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        alert("클립보드에 복사되었습니다!");
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
            {/* 헤더 */}
            <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
                <div className="max-w-6xl mx-auto px-4 py-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-xl font-bold text-slate-900">
                                🔍 키워드 분석
                            </h1>
                            <p className="text-sm text-slate-500">SEO 키워드 추천 & 품질 체크</p>
                        </div>
                        <Link
                            href="/"
                            className="px-4 py-2 text-sm bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"
                        >
                            ← 대시보드
                        </Link>
                    </div>
                </div>
            </header>

            <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
                {/* 카테고리 선택 */}
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                    <h2 className="font-semibold text-slate-800 mb-3">📂 카테고리 선택</h2>
                    <div className="flex flex-wrap gap-2">
                        {(Object.entries(CATEGORY_LABELS) as [Category, string][]).map(([key, label]) => (
                            <button
                                key={key}
                                onClick={() => setCategory(key)}
                                className={`px-4 py-2 rounded-lg font-medium transition-colors ${category === key
                                        ? "bg-blue-600 text-white"
                                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                    }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* 키워드 입력 */}
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                    <h2 className="font-semibold text-slate-800 mb-3">🎯 키워드 조합 생성</h2>
                    <div className="flex flex-wrap gap-3">
                        <input
                            type="text"
                            placeholder="지역명 (예: 강남, 부산)"
                            value={location}
                            onChange={(e) => setLocation(e.target.value)}
                            className="flex-1 min-w-[150px] px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <input
                            type="text"
                            placeholder="기본 키워드 (예: 카페, 펜션)"
                            value={baseKeyword}
                            onChange={(e) => setBaseKeyword(e.target.value)}
                            className="flex-1 min-w-[150px] px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button
                            onClick={fetchKeywords}
                            disabled={loading}
                            className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                        >
                            {loading ? "분석 중..." : "🔍 분석"}
                        </button>
                    </div>
                </div>

                {/* 키워드 결과 */}
                {keywordData && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* 트렌드 키워드 */}
                        <div className="bg-white border border-slate-200 rounded-xl p-4">
                            <h3 className="font-semibold text-slate-800 mb-3">🔥 트렌드 키워드</h3>
                            <div className="flex flex-wrap gap-2">
                                {keywordData.trending.map((kw, i) => (
                                    <button
                                        key={i}
                                        onClick={() => copyToClipboard(kw)}
                                        className="px-3 py-1 text-sm bg-orange-50 text-orange-700 rounded-full hover:bg-orange-100 transition-colors"
                                    >
                                        {kw}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* 계절 키워드 */}
                        <div className="bg-white border border-slate-200 rounded-xl p-4">
                            <h3 className="font-semibold text-slate-800 mb-3">🌸 계절 키워드</h3>
                            <div className="flex flex-wrap gap-2">
                                {keywordData.seasonal.map((kw, i) => (
                                    <button
                                        key={i}
                                        onClick={() => copyToClipboard(kw)}
                                        className="px-3 py-1 text-sm bg-green-50 text-green-700 rounded-full hover:bg-green-100 transition-colors"
                                    >
                                        {kw}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* 추천 조합 */}
                        <div className="bg-white border border-slate-200 rounded-xl p-4 md:col-span-2">
                            <h3 className="font-semibold text-slate-800 mb-3">✨ 추천 키워드 조합</h3>
                            {keywordData.combinations.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                    {keywordData.combinations.map((kw, i) => (
                                        <button
                                            key={i}
                                            onClick={() => copyToClipboard(kw)}
                                            className="px-3 py-1 text-sm bg-blue-50 text-blue-700 rounded-full hover:bg-blue-100 transition-colors border border-blue-200"
                                        >
                                            {kw}
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-slate-500 text-sm">지역명이나 키워드를 입력하면 조합이 생성됩니다.</p>
                            )}
                        </div>

                        {/* 팁 */}
                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 md:col-span-2">
                            <h3 className="font-semibold text-slate-800 mb-2">💡 SEO 팁</h3>
                            <ul className="text-sm text-slate-600 space-y-1">
                                {keywordData.tips.map((tip, i) => (
                                    <li key={i}>• {tip}</li>
                                ))}
                            </ul>
                        </div>
                    </div>
                )}

                {/* 콘텐츠 품질 체크 */}
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                    <h2 className="font-semibold text-slate-800 mb-3">📊 콘텐츠 품질 체크</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div>
                            <label className="block text-sm text-slate-600 mb-1">제목</label>
                            <input
                                type="text"
                                placeholder="블로그 제목 입력"
                                value={checkTitle}
                                onChange={(e) => setCheckTitle(e.target.value)}
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div className="flex gap-4">
                            <div className="flex-1">
                                <label className="block text-sm text-slate-600 mb-1">이미지 수</label>
                                <input
                                    type="number"
                                    value={checkImageCount}
                                    onChange={(e) => setCheckImageCount(parseInt(e.target.value) || 0)}
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            <div className="flex-1">
                                <label className="block text-sm text-slate-600 mb-1">해시태그 수</label>
                                <input
                                    type="number"
                                    value={checkHashtagCount}
                                    onChange={(e) => setCheckHashtagCount(parseInt(e.target.value) || 0)}
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm text-slate-600 mb-1">본문 (또는 글자수)</label>
                            <textarea
                                placeholder="본문 내용을 붙여넣거나 예상 글자수를 입력하세요"
                                value={checkBody}
                                onChange={(e) => setCheckBody(e.target.value)}
                                rows={3}
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <span className="text-xs text-slate-500">{checkBody.length}자</span>
                        </div>
                    </div>
                    <button
                        onClick={checkQuality}
                        disabled={loading}
                        className="px-6 py-2 bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
                    >
                        {loading ? "분석 중..." : "📊 품질 분석"}
                    </button>
                </div>

                {/* 품질 결과 */}
                {qualityData && (
                    <div className="bg-white border border-slate-200 rounded-xl p-4">
                        <div className="flex items-center gap-4 mb-4">
                            <div className={`text-4xl font-bold ${qualityData.grade === "A" ? "text-green-600" :
                                    qualityData.grade === "B" ? "text-blue-600" :
                                        qualityData.grade === "C" ? "text-yellow-600" : "text-red-600"
                                }`}>
                                {qualityData.grade}
                            </div>
                            <div>
                                <div className="text-xl font-semibold text-slate-800">
                                    품질 점수: {qualityData.score}/100
                                </div>
                                <div className="text-sm text-slate-500">
                                    {qualityData.score >= 80 ? "상위노출 가능성 높음" :
                                        qualityData.score >= 60 ? "개선 권장" : "개선 필요"}
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            {qualityData.feedback.map((fb, i) => (
                                <div key={i} className="flex items-center gap-2">
                                    <span className={`text-lg ${fb.status === "pass" ? "text-green-500" :
                                            fb.status === "warn" ? "text-yellow-500" : "text-red-500"
                                        }`}>
                                        {fb.status === "pass" ? "✅" : fb.status === "warn" ? "⚠️" : "❌"}
                                    </span>
                                    <span className="text-sm text-slate-700">{fb.item}:</span>
                                    <span className="text-sm text-slate-500">{fb.message}</span>
                                </div>
                            ))}
                        </div>

                        <div className="mt-4 p-3 bg-slate-50 rounded-lg">
                            {qualityData.tips.map((tip, i) => (
                                <p key={i} className="text-sm text-slate-600">💡 {tip}</p>
                            ))}
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
