# Codex Luna/low 및 ChatGPT default 정책

## 고정 규칙

- Codex SDK의 원고 작성, 구조화 출력, 문장 편집, OCR, 이미지 판독,
  최종 이미지 검수와 이미지 생성 제어는 `gpt-6-luna`만 사용한다.
- Codex reasoning effort는 `low`만 허용한다. 다른 값은 호출 전에 거부한다.
- `gpt-6-astra`는 Codex와 ChatGPT 브라우저 양쪽에서 금지한다.
- ChatGPT 브라우저 자동화는 `https://chatgpt.com/`의 일반 새 대화와
  `default` 모델만 사용한다. 모델별 URL이나 커스텀 GPT를 선택하지 않는다.
- 직접 OpenAI API 및 API 키 기반 폴백은 사용하지 않는다.

## 시행 위치

- `scripts/lib/draft-runtime-policy.json`: 배포·Electron·설정 API 공통값
- `scripts/lib/text-model-policy.ts`: 모델과 effort 허용 목록
- `scripts/lib/codex-draft-provider.ts`: 모든 Codex 스레드의 모델·effort 전달
- `src/lib/codex-image-generation.ts`: 이미지 생성 제어 스레드의 동일 정책
- `src/lib/chatgpt-browser-automation.ts`: ChatGPT 브라우저 `default` 환경

## 실패 원칙

허용되지 않은 모델이나 effort가 들어오면 공급자 호출 전에
`TEXT_MODEL_POLICY` 오류로 중단한다. 다른 모델로 자동 전환하거나 로컬
저품질 원고로 대체하지 않는다.
