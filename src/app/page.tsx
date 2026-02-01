"use client";

import { useState, useEffect, useCallback } from "react";
import SessionStatus from "@/components/SessionStatus";

type ContentMode = "product" | "topic" | "review";
type ReviewCategory = "place" | "food" | "travel" | "parenting" | "product";

interface BrandLink {
  id: string;
  url: string;
  productName: string | null;
  productPrice: string | null;
  storeName: string | null;
  imageUrls: string | null;
  status: string;
  publishedAt: string | null;
  postUrl: string | null;
  errorMessage: string | null;
  memo: string | null;
  createdAt: string;
}

export default function Dashboard() {
  const [links, setLinks] = useState<BrandLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [newUrl, setNewUrl] = useState("");
  const [newMemo, setNewMemo] = useState("");
  const [adding, setAdding] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);

  // V5: 콘텐츠 모드
  const [contentMode, setContentMode] = useState<ContentMode>("product");

  // V5: 리뷰 모드
  const [reviewPlaceName, setReviewPlaceName] = useState("");
  const [reviewAddress, setReviewAddress] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewKeywords, setReviewKeywords] = useState("");
  const [reviewCategory, setReviewCategory] = useState<ReviewCategory>("place");
  const [reviewTips, setReviewTips] = useState("");
  const [placeSearchResults, setPlaceSearchResults] = useState<any[]>([]);
  const [searchingPlace, setSearchingPlace] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewResult, setReviewResult] = useState<any>(null);

  const fetchLinks = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/brandlinks");
      const data = await res.json();
      if (data.success) {
        setLinks(data.data);
      }
    } catch (error) {
      console.error("링크 조회 실패:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLinks();
  }, [fetchLinks]);

  // 링크 추가
  const handleAddLink = async () => {
    if (!newUrl.trim()) {
      alert("브랜드커넥트 URL을 입력하세요.");
      return;
    }

    try {
      setAdding(true);
      const res = await fetch("/api/brandlinks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: newUrl.trim(), memo: newMemo.trim() }),
      });

      const data = await res.json();

      if (data.success) {
        setNewUrl("");
        setNewMemo("");
        fetchLinks();
        alert("링크가 추가되었습니다!");
      } else {
        alert(`오류: ${data.error}`);
      }
    } catch (error) {
      console.error("링크 추가 실패:", error);
      alert("링크 추가 중 오류가 발생했습니다.");
    } finally {
      setAdding(false);
    }
  };

  // 링크 삭제
  const handleDeleteLink = async (id: string) => {
    if (!confirm("정말 삭제하시겠습니까?")) return;

    try {
      const res = await fetch(`/api/brandlinks/${id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        fetchLinks();
      }
    } catch (error) {
      console.error("삭제 실패:", error);
    }
  };

  // 발행하기
  const handlePublish = async (id: string) => {
    if (!confirm("이 상품으로 블로그 글을 발행하시겠습니까?")) return;

    try {
      setPublishingId(id);
      const res = await fetch(`/api/brandlinks/${id}/publish`, {
        method: "POST",
      });

      const data = await res.json();

      if (data.success) {
        alert("발행이 시작되었습니다. 브라우저가 열립니다.");
        // 상태 폴링
        const pollStatus = setInterval(async () => {
          const statusRes = await fetch(`/api/brandlinks/${id}`);
          const statusData = await statusRes.json();

          if (statusData.data.status !== "PUBLISHING") {
            clearInterval(pollStatus);
            fetchLinks();
            setPublishingId(null);

            if (statusData.data.status === "PUBLISHED") {
              alert("✅ 발행 완료!");
            } else if (statusData.data.status === "FAILED") {
              alert(`❌ 발행 실패: ${statusData.data.errorMessage}`);
            }
          }
        }, 3000);
      } else {
        alert(`오류: ${data.error}`);
        setPublishingId(null);
      }
    } catch (error) {
      console.error("발행 실패:", error);
      alert("발행 중 오류가 발생했습니다.");
      setPublishingId(null);
    }
  };

  // 통계 계산
  const stats = {
    total: links.length,
    ready: links.filter((l) => l.status === "READY").length,
    published: links.filter((l) => l.status === "PUBLISHED").length,
    failed: links.filter((l) => l.status === "FAILED").length,
  };

  // 상태 배지 색상
  const getStatusColor = (status: string) => {
    switch (status) {
      case "READY": return "bg-blue-100 text-blue-800";
      case "PUBLISHING": return "bg-yellow-100 text-yellow-800";
      case "PUBLISHED": return "bg-green-100 text-green-800";
      case "FAILED": return "bg-red-100 text-red-800";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "READY": return "대기";
      case "PUBLISHING": return "발행중";
      case "PUBLISHED": return "발행완료";
      case "FAILED": return "실패";
      default: return status;
    }
  };

  // V5: 리뷰 생성
  const handleReview = async (publish: boolean) => {
    if (!reviewPlaceName || !reviewNotes) {
      alert("장소명과 메모는 필수입니다.");
      return;
    }

    try {
      setReviewLoading(true);
      setReviewResult(null);

      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          placeName: reviewPlaceName,
          address: reviewAddress,
          rawNotes: reviewNotes,
          keywords: reviewKeywords,
          tips: reviewTips,
          category: reviewCategory,
          publish,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setReviewResult(data.data);
        if (publish) {
          alert("블로그 글이 발행되었습니다!");
        }
      } else {
        alert(`오류: ${data.error}`);
      }
    } catch (error) {
      console.error("리뷰 생성 실패:", error);
      alert("리뷰 생성 중 오류가 발생했습니다.");
    } finally {
      setReviewLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* 헤더 */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-slate-900">
                📝 네이버 블로그 자동화
              </h1>
              <p className="text-sm text-slate-500">브랜드커넥트 링크 관리 &amp; 발행</p>
            </div>
            <button
              onClick={() => fetchLinks()}
              className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              title="새로고침"
            >
              🔄
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* 세션 상태 */}
        <SessionStatus />

        {/* 통계 카드 */}
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4 text-center">
            <div className="text-3xl font-bold text-slate-800">{stats.total}</div>
            <div className="text-sm text-slate-500">전체</div>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
            <div className="text-3xl font-bold text-blue-600">{stats.ready}</div>
            <div className="text-sm text-blue-600">대기중</div>
          </div>
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
            <div className="text-3xl font-bold text-emerald-600">{stats.published}</div>
            <div className="text-sm text-emerald-600">발행완료</div>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
            <div className="text-3xl font-bold text-red-600">{stats.failed}</div>
            <div className="text-sm text-red-600">실패</div>
          </div>
        </div>

        {/* V5: 콘텐츠 생성 모드 탭 */}
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setContentMode("product")}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${contentMode === "product"
                ? "bg-blue-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
            >
              🛒 상품 리뷰
            </button>
            <button
              onClick={() => setContentMode("review")}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${contentMode === "review"
                ? "bg-emerald-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
            >
              📝 장소/제품 리뷰
            </button>
          </div>

          {/* 리뷰 모드 폼 */}
          {contentMode === "review" && (
            <div className="space-y-4 border-t pt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">장소/제품명 *</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={reviewPlaceName}
                      onChange={(e) => setReviewPlaceName(e.target.value)}
                      placeholder="예: 뽀로로테마파크 다산"
                      className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <button
                      onClick={async () => {
                        if (!reviewPlaceName) return;
                        setSearchingPlace(true);
                        try {
                          const res = await fetch(`/api/place?q=${encodeURIComponent(reviewPlaceName)}`);
                          const data = await res.json();
                          if (data.success && data.data.places?.length > 0) {
                            setPlaceSearchResults(data.data.places);
                          } else {
                            setPlaceSearchResults([]);
                          }
                        } catch (e) {
                          console.error(e);
                        } finally {
                          setSearchingPlace(false);
                        }
                      }}
                      disabled={!reviewPlaceName || searchingPlace}
                      className="px-3 py-2 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 disabled:opacity-50"
                    >
                      {searchingPlace ? "⏳" : "🔍"}
                    </button>
                  </div>
                  {placeSearchResults.length > 0 && (
                    <div className="mt-2 border border-slate-200 rounded-lg max-h-40 overflow-y-auto">
                      {placeSearchResults.map((place, idx) => (
                        <button
                          key={idx}
                          onClick={() => {
                            setReviewPlaceName(place.title);
                            setReviewAddress(place.roadAddress || place.address);
                            setPlaceSearchResults([]);
                          }}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-emerald-50 border-b last:border-b-0"
                        >
                          <div className="font-medium">{place.title}</div>
                          <div className="text-slate-500 text-xs">{place.roadAddress || place.address}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">주소</label>
                  <input
                    type="text"
                    value={reviewAddress}
                    onChange={(e) => setReviewAddress(e.target.value)}
                    placeholder="예: 경기 남양주시 다산지금로 202"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">카테고리</label>
                <div className="flex gap-2 flex-wrap">
                  {[
                    { value: "place", label: "📍 장소" },
                    { value: "food", label: "🍽️ 맛집" },
                    { value: "travel", label: "✈️ 여행" },
                    { value: "parenting", label: "👶 육아" },
                    { value: "product", label: "📦 제품" },
                  ].map((cat) => (
                    <button
                      key={cat.value}
                      onClick={() => setReviewCategory(cat.value as ReviewCategory)}
                      className={`px-3 py-1 rounded-lg text-sm ${reviewCategory === cat.value
                        ? "bg-emerald-600 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">메모/경험 *</label>
                <textarea
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder="방문 경험, 느낀점, 장점, 특이사항 등을 자유롭게 작성해주세요..."
                  rows={4}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">키워드 (쉼표로 구분)</label>
                  <input
                    type="text"
                    value={reviewKeywords}
                    onChange={(e) => setReviewKeywords(e.target.value)}
                    placeholder="남양주, 아이와가볼만한곳, 실내놀이터"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">TIP (쉼표로 구분)</label>
                  <input
                    type="text"
                    value={reviewTips}
                    onChange={(e) => setReviewTips(e.target.value)}
                    placeholder="주차 무료, 평일 방문 추천"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => handleReview(false)}
                  disabled={reviewLoading}
                  className="px-6 py-2 bg-slate-600 text-white font-medium rounded-lg hover:bg-slate-700 disabled:opacity-50"
                >
                  {reviewLoading ? "생성 중..." : "✨ 미리보기"}
                </button>
                <button
                  onClick={() => handleReview(true)}
                  disabled={reviewLoading}
                  className="px-6 py-2 bg-emerald-600 text-white font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                >
                  {reviewLoading ? "발행 중..." : "🚀 바로 발행"}
                </button>
              </div>

              {/* 리뷰 결과 */}
              {reviewResult && (
                <div className="mt-4 p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
                  <h3 className="font-semibold text-emerald-800 mb-2">📄 생성된 리뷰</h3>
                  <p className="text-lg font-medium text-slate-800">{reviewResult.title || reviewPlaceName}</p>
                  {reviewResult.published && (
                    <p className="text-sm text-emerald-600 mt-2">✅ 블로그에 발행되었습니다!</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 링크 추가 폼 - 상품 모드에서만 표시 */}
        {contentMode === "product" && (
          <>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <h2 className="font-semibold text-slate-800 mb-3">➕ 브랜드커넥트 링크 추가</h2>
              <div className="flex gap-3">
                <input
                  type="url"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder="https://naver.me/xxx 또는 브랜드커넥트 URL"
                  className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="text"
                  value={newMemo}
                  onChange={(e) => setNewMemo(e.target.value)}
                  placeholder="메모 (선택)"
                  className="w-48 px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={handleAddLink}
                  disabled={adding}
                  className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {adding ? "추가 중..." : "추가"}
                </button>
              </div>
            </div>

            {/* 링크 테이블 */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">상품</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">URL</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-slate-600">상태</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-slate-600">메모</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-slate-600">작업</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                        로딩 중...
                      </td>
                    </tr>
                  ) : links.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                        등록된 링크가 없습니다. 위에서 브랜드커넥트 링크를 추가하세요.
                      </td>
                    </tr>
                  ) : (
                    links.map((link) => (
                      <tr key={link.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            {/* 이미지 썸네일 */}
                            {link.imageUrls && JSON.parse(link.imageUrls)[0] && (
                              <img
                                src={JSON.parse(link.imageUrls)[0]}
                                alt=""
                                className="w-12 h-12 object-cover rounded-lg"
                              />
                            )}
                            <div>
                              <div className="font-medium text-slate-800">
                                {link.productName || "(상품 정보 없음)"}
                              </div>
                              {link.productPrice && (
                                <div className="text-sm text-slate-500">{link.productPrice}</div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <a
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline text-sm"
                          >
                            {link.url.length > 40 ? link.url.substring(0, 40) + "..." : link.url}
                          </a>
                          {link.postUrl && (
                            <div className="mt-1">
                              <a
                                href={link.postUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-green-600 hover:underline text-xs"
                              >
                                📄 발행된 글 보기
                              </a>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(link.status)}`}>
                            {getStatusText(link.status)}
                          </span>
                          {link.errorMessage && (
                            <div className="text-xs text-red-500 mt-1" title={link.errorMessage}>
                              ⚠️
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center text-sm text-slate-500">
                          {link.memo || "-"}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-2">
                            {/* 발행하기 버튼 */}
                            {link.status === "READY" && (
                              <button
                                onClick={() => handlePublish(link.id)}
                                disabled={publishingId === link.id}
                                className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 transition-colors"
                              >
                                {publishingId === link.id ? "⏳" : "🚀 발행"}
                              </button>
                            )}

                            {/* 재발행 */}
                            {link.status === "FAILED" && (
                              <button
                                onClick={() => handlePublish(link.id)}
                                disabled={publishingId === link.id}
                                className="px-3 py-1 text-sm bg-amber-500 text-white rounded hover:bg-amber-600 disabled:opacity-50 transition-colors"
                              >
                                🔄 재시도
                              </button>
                            )}

                            {/* 삭제 */}
                            <button
                              onClick={() => handleDeleteLink(link.id)}
                              className="px-3 py-1 text-sm bg-red-100 text-red-600 rounded hover:bg-red-200 transition-colors"
                              title="삭제"
                            >
                              🗑️
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* 사용 안내 */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
          <h3 className="font-medium text-slate-800 mb-2">💡 사용 방법</h3>
          <ol className="text-sm text-slate-600 space-y-1 list-decimal list-inside">
            <li>먼저 <code className="bg-slate-200 px-1 rounded">npm run login</code>으로 네이버 로그인</li>
            <li>브랜드커넥트 링크를 추가 (https://naver.me/xxx 형태)</li>
            <li>🚀 발행 버튼으로 블로그 글 자동 작성 &amp; 발행</li>
          </ol>
        </div>
      </main>

      {/* 푸터 */}
      <footer className="border-t border-slate-200 bg-white mt-8">
        <div className="max-w-6xl mx-auto px-4 py-4 text-center text-sm text-slate-500">
          네이버 블로그 자동화 시스템 • 브랜드커넥트
        </div>
      </footer>
    </div>
  );
}
