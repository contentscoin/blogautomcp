"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { isTopicCandidateList, type TopicCandidate } from "@/lib/topic-candidate-contract";

const CATEGORIES = [
  { id: "tech", label: "기술 / IT", icon: "💻" },
  { id: "business", label: "비즈니스 / 경제", icon: "💼" },
  { id: "lifestyle", label: "라이프스타일", icon: "❤️" },
  { id: "design", label: "디자인 / 크리에이티브", icon: "🎨" },
  { id: "marketing", label: "마케팅 / 트렌드", icon: "📈" },
  { id: "food", label: "음식 / 요리", icon: "🍽️" },
  { id: "travel", label: "여행 / 문화", icon: "✈️" },
  { id: "health", label: "건강 / 운동", icon: "💪" },
  { id: "education", label: "교육 / 자기계발", icon: "📚" },
  { id: "ai", label: "AI / 미래기술", icon: "✨" },
];

type Topic = TopicCandidate;

export default function TopicCandidatesPage() {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingIndex, setAddingIndex] = useState<number | null>(null);
  const [addedIndices, setAddedIndices] = useState<Set<number>>(new Set());
  const [warning, setWarning] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const [generatedInput, setGeneratedInput] = useState<{ category: string; keyword: string } | null>(null);
  const generationInFlight = useRef(false);
  const queueInFlight = useRef(false);
  const requestSequence = useRef(0);

  useEffect(() => () => { requestSequence.current++; }, []);

  async function handleGenerate() {
    if (!selectedCategory || !keyword.trim() || generationInFlight.current || queueInFlight.current) return;
    generationInFlight.current = true;
    const requestId = ++requestSequence.current;
    const input = { category: selectedCategory, keyword: keyword.trim() };
    setLoading(true);
    setError(null);
    setWarning(null);
    setCopyMessage("");
    setGeneratedInput(null);
    setTopics([]);
    setExpandedIndex(null);
    setAddedIndices(new Set());

    try {
      const res = await fetch("/api/topic-candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "생성 실패");
      if (!isTopicCandidateList(data.topics)) throw new Error("소재 응답 형식이 올바르지 않습니다. 다시 생성하세요.");
      if (requestSequence.current !== requestId) return;
      setTopics(data.topics);
      setGeneratedInput(input);
      if (data.fallback === true) setWarning(typeof data.warning === "string" && data.warning.trim()
        ? data.warning : "GPT 생성이 실패해 로컬 규칙으로 만든 후보입니다. 내용과 사실 근거를 검토한 뒤 사용하세요.");
    } catch (e) {
      if (requestSequence.current === requestId) setError(e instanceof Error ? e.message : "오류가 발생했습니다");
    } finally {
      if (requestSequence.current === requestId) { setLoading(false); generationInFlight.current = false; }
    }
  }

  async function handleAddToQueue(topic: Topic, index: number) {
    if (queueInFlight.current || generationInFlight.current || addedIndices.has(index) || !generatedInput) return;
    queueInFlight.current = true;
    setAddingIndex(index);
    try {
      const categoryLabel =
        CATEGORIES.find((c) => c.id === generatedInput.category)?.label || generatedInput.category;

      const res = await fetch("/api/topic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "prepare",
          topic: topic.title,
          keywords: generatedInput.keyword,
          type: "blog",
          topicCraftCategory: categoryLabel,
          intent: topic.subtopics.map((s) => s.subtitle).join(", "),
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "큐 추가 실패");
      }
      setAddedIndices((prev) => new Set(prev).add(index));
    } catch (e) {
      alert(e instanceof Error ? e.message : "큐 추가 실패");
    } finally {
      setAddingIndex(null);
      queueInFlight.current = false;
    }
  }

  async function copyTopic(topic: Topic) {
    setCopyMessage("");
    try {
      await navigator.clipboard.writeText(`제목: ${topic.title}\n\n${topic.content}\n\n${topic.hashtags.join(" ")}`);
      setCopyMessage("소재를 클립보드에 복사했습니다.");
    } catch {
      setCopyMessage("복사하지 못했습니다. 펼쳐진 소재 내용을 직접 선택해 복사하세요.");
    }
  }

  function renderMarkdown(text: string) {
    return text
      .split("\n")
      .map((line, i) => {
        if (line.startsWith("## ")) return <h3 key={i} className="text-base font-bold mt-4 mb-1 text-gray-800 dark:text-gray-200">{line.slice(3)}</h3>;
        if (line.startsWith("# ")) return <h2 key={i} className="text-lg font-bold mt-4 mb-1 text-gray-800 dark:text-gray-200">{line.slice(2)}</h2>;
        if (line.startsWith("- ")) return <li key={i} className="ml-4 list-disc text-sm text-gray-700 dark:text-gray-300">{line.slice(2)}</li>;
        if (line.trim() === "") return <br key={i} />;
        return <p key={i} className="text-sm text-gray-700 dark:text-gray-300 mb-1">{line}</p>;
      });
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center gap-4">
        <Link href="/" className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-sm">
          ← 홈
        </Link>
        <h1 className="text-lg font-bold text-gray-900 dark:text-white">📝 주제 소재 발굴</h1>
        <span className="text-xs text-gray-400 ml-auto">GPT-5 기반 블로그 소재 생성기</span>
      </header>

      <div className="max-w-4xl mx-auto p-4">
        {/* 카테고리 선택 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 mb-4">
          <p className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-3">카테고리 선택</p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                disabled={loading || addingIndex !== null}
                className={`p-2 rounded-lg text-xs font-medium text-center transition-all border ${
                  selectedCategory === cat.id
                    ? "bg-blue-500 text-white border-blue-500"
                    : "bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-blue-300"
                }`}
              >
                <div className="text-lg mb-1">{cat.icon}</div>
                <div className="leading-tight">{cat.label}</div>
              </button>
            ))}
          </div>

          {/* 키워드 입력 */}
          {selectedCategory && (
            <div className="mt-4 flex gap-2">
              <input
                type="text"
                value={keyword}
                disabled={loading || addingIndex !== null}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                placeholder="키워드 입력 (예: 재택근무 생산성, 서울 카페 추천)"
                className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:border-blue-400"
              />
              <button
                onClick={handleGenerate}
                disabled={!keyword.trim() || loading || addingIndex !== null}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
              >
                {loading ? "생성 중..." : "소재 생성 (10개)"}
              </button>
            </div>
          )}
        </div>

        {/* 오류 */}
        {error && (
          <div role="alert" className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3 mb-4 text-sm text-red-600 dark:text-red-400">
            ⚠️ {error}
          </div>
        )}
        {warning && <div role="status" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">⚠️ {warning}</div>}
        {copyMessage && <p role="status" className="mb-4 text-sm text-gray-700 dark:text-gray-300">{copyMessage}</p>}

        {/* 로딩 */}
        {loading && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center">
            <div className="text-3xl mb-3 animate-pulse">✨</div>
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">블로그 소재 10개 생성 중...</p>
            <p className="text-xs text-gray-400 mt-1">GPT-5가 소재를 작성하고 있습니다 (약 2~4분 소요)</p>
          </div>
        )}

        {/* 결과 목록 */}
        {topics.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-600 dark:text-gray-400">
                생성된 소재 {topics.length}개
              </p>
              <p className="text-xs text-gray-400">클릭하면 내용 확인 / 발행 큐에 추가 가능</p>
            </div>

            {topics.map((topic, i) => (
              <div
                key={i}
                className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden"
              >
                {/* 카드 헤더 */}
                <button
                  onClick={() => setExpandedIndex(expandedIndex === i ? null : i)}
                  className="w-full p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs text-blue-500 font-semibold">#{i + 1}</span>
                        {addedIndices.has(i) && (
                          <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 px-2 py-0.5 rounded-full">
                            ✓ 큐 추가됨
                          </span>
                        )}
                      </div>
                      <p className="font-semibold text-gray-900 dark:text-white text-sm leading-snug">
                        {topic.title}
                      </p>
                      {/* 소주제 미리보기 */}
                      <div className="flex gap-2 mt-2 flex-wrap">
                        {topic.subtopics.map((s, j) => (
                          <span
                            key={j}
                            className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded-full"
                          >
                            {s.subtitle}
                          </span>
                        ))}
                      </div>
                    </div>
                    <span className="text-gray-400 text-sm mt-1 flex-shrink-0">
                      {expandedIndex === i ? "▲" : "▼"}
                    </span>
                  </div>
                </button>

                {/* 펼쳐진 내용 */}
                {expandedIndex === i && (
                  <div className="border-t border-gray-100 dark:border-gray-700 p-4 space-y-4">
                    {/* 소주제 상세 */}
                    <div>
                      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                        소주제 구성
                      </p>
                      <div className="space-y-2">
                        {topic.subtopics.map((s, j) => (
                          <div key={j} className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-2">
                            <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">
                              {j + 1}. {s.subtitle}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{s.summary}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 본문 미리보기 */}
                    <div>
                      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                        본문 미리보기 ({topic.content.length.toLocaleString()}자)
                      </p>
                      <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 max-h-60 overflow-y-auto">
                        {renderMarkdown(topic.content)}
                      </div>
                    </div>

                    {/* 이미지 프롬프트 */}
                    <div>
                      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
                        이미지 프롬프트
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 rounded p-2 italic">
                        {topic.image_prompt}
                      </p>
                    </div>

                    {/* 해시태그 */}
                    <div>
                      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                        해시태그
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {topic.hashtags.map((tag, j) => (
                          <span
                            key={j}
                            className="text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* 액션 버튼 */}
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => handleAddToQueue(topic, i)}
                        disabled={addingIndex !== null || loading || addedIndices.has(i)}
                        className="flex-1 py-2 text-sm font-semibold rounded-lg bg-green-500 text-white hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {addedIndices.has(i)
                          ? "✓ 발행 큐에 추가됨"
                          : addingIndex === i
                          ? "추가 중..."
                          : "발행 큐에 추가"}
                      </button>
                      <button
                        onClick={() => void copyTopic(topic)}
                        className="px-3 py-2 text-sm font-semibold rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                      >
                        복사
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 빈 상태 */}
        {!loading && topics.length === 0 && !error && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center">
            <div className="text-4xl mb-3">📝</div>
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">카테고리와 키워드를 선택하고 소재를 생성하세요</p>
            <p className="text-xs text-gray-400 mt-1">GPT-5가 네이버 블로그용 소재 10개를 한 번에 생성합니다 (2~4분 소요)</p>
          </div>
        )}
      </div>
    </div>
  );
}
