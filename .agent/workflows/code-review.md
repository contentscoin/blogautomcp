---
description: 코드 품질, 보안, 유지보수성 리뷰
---

# /code-review 워크플로우

이 워크플로우는 **Athena** 에이전트를 호출하여 코드 리뷰를 수행합니다.

## 리뷰 항목

### 🔒 보안
- [ ] 하드코딩된 비밀번호/API 키 없음
- [ ] 입력 검증 완료
- [ ] SQL 인젝션 방지
- [ ] XSS 방지

### ⚡ 성능
- [ ] N+1 쿼리 문제 없음
- [ ] 불필요한 재렌더링 없음
- [ ] 적절한 캐싱 적용

### 🧹 코드 품질
- [ ] 함수가 작음 (<50줄)
- [ ] 파일이 집중됨 (<800줄)
- [ ] 깊은 중첩 없음 (>4 레벨)
- [ ] console.log 없음

### 📝 문서화
- [ ] 복잡한 로직에 주석
- [ ] 함수/타입에 JSDoc

## 명령어

```
/code-review [파일 경로 또는 PR 번호]
```

## 예시

```
/code-review src/lib/auth.ts
```

**Athena 응답:**
```markdown
# 코드 리뷰: src/lib/auth.ts

## 🔒 보안 (Critical)
- ⚠️ Line 23: API 키가 하드코딩됨
  ```diff
  - const apiKey = "sk-xxx"
  + const apiKey = process.env.API_KEY
  ```

## ⚡ 성능 (Warning)
- Line 45: 루프 내 DB 쿼리 -> N+1 문제
  - 권장: 배치 쿼리로 변경

## 🧹 코드 품질 (Info)
- Line 67-89: 함수가 너무 길음 (52줄)
  - 권장: 헬퍼 함수로 분리

## ✅ 좋은 점
- 타입 정의 명확
- 에러 처리 적절
- 테스트 커버리지 85%
```

## 관련 에이전트

- **Athena** - 코드 분석 및 리뷰
- **Hephaestus** - 추천 사항 구현
