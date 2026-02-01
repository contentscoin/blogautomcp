---
description: 빌드 에러 분석 및 자동 수정
---

# /build-fix 워크플로우

이 워크플로우는 **Hephaestus** 에이전트를 호출하여 빌드 에러를 분석하고 수정합니다.

## 워크플로우 단계

// turbo-all
1. 빌드 에러 로그 수집
2. 에러 원인 분석
3. 수정 사항 적용
4. 빌드 재실행
5. 성공 시까지 반복

## 명령어

```
/build-fix
```

## 예시

**빌드 에러 발생:**
```
error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.
  at src/utils/calculate.ts:15:23
```

**Hephaestus 응답:**
```markdown
# 빌드 에러 분석

## 에러 위치
- 파일: `src/utils/calculate.ts`
- 라인: 15

## 원인
`calculate` 함수에 string 타입이 전달됨. number 타입 필요.

## 수정
```diff
- const result = calculate(userInput);
+ const result = calculate(Number(userInput));
```

## 추가 검증
- 유사 패턴 파일 검색 중...
- `src/pages/dashboard.tsx:42` 에서 동일 문제 발견
```

## 에러 유형별 처리

### TypeScript 에러
- 타입 불일치 → 타입 변환 또는 타입 정의 수정
- 누락된 import → 자동 import 추가

### ESLint 에러
- 포맷 문제 → `npm run lint:fix`
- 규칙 위반 → 코드 수정 또는 규칙 비활성화(주석)

### 런타임 에러
- undefined 접근 → 옵셔널 체이닝 적용
- 비동기 처리 문제 → async/await 검증

## 관련 에이전트

- **Hephaestus** - 빌드 에러 수정
- **Athena** - 루트 원인 분석
