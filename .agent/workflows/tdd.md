---
description: 테스트 주도 개발(TDD) 워크플로우. 테스트 먼저 작성 후 구현.
---

# /tdd 워크플로우

이 워크플로우는 **Hephaestus** 에이전트와 함께 TDD 방법론을 적용합니다.

## TDD 사이클

```
RED → GREEN → REFACTOR
```

1. **RED**: 실패하는 테스트 작성
2. **GREEN**: 테스트를 통과하는 최소한의 코드 작성
3. **REFACTOR**: 코드 정리 및 개선

## 워크플로우 단계

// turbo-all
1. 인터페이스/타입 정의
2. 실패하는 테스트 작성 (RED)
3. `npm test` 실행 - 실패 확인
4. 최소한의 구현 작성 (GREEN)
5. `npm test` 실행 - 통과 확인
6. 리팩토링 (REFACTOR)
7. 커버리지 확인 (80%+)

## 명령어

```
/tdd [기능 설명]
```

## 예시

```
/tdd 사용자 인증 함수 구현
```

**Hephaestus 응답:**
```typescript
// 1. 인터페이스 정의
interface AuthResult {
  success: boolean;
  user?: User;
  error?: string;
}

// 2. 테스트 작성 (RED)
describe('authenticateUser', () => {
  it('should return success with valid credentials', async () => {
    const result = await authenticateUser('test@email.com', 'password123');
    expect(result.success).toBe(true);
    expect(result.user).toBeDefined();
  });

  it('should return error with invalid credentials', async () => {
    const result = await authenticateUser('test@email.com', 'wrong');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid credentials');
  });
});

// 3. npm test - 실패 확인 ❌

// 4. 구현 (GREEN)
async function authenticateUser(email: string, password: string): Promise<AuthResult> {
  const user = await db.users.findByEmail(email);
  if (!user || !await bcrypt.compare(password, user.passwordHash)) {
    return { success: false, error: 'Invalid credentials' };
  }
  return { success: true, user };
}

// 5. npm test - 통과 ✅
```

## 관련 에이전트

- **Hephaestus** - 테스트 및 구현 코드 작성
- **Athena** - 테스트 코드 리뷰 및 커버리지 분석
