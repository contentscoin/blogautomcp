# 출처

- 원본: https://github.com/contentscoin/skillsphotoreal (디렉터리 `photoreal/`)
- 커밋: 92cca71 (2026-09-24 기준 main)
- 원본 파일(SKILL.md, references/, scripts/build_prompt.py, evals/)은 수정하지 않고 그대로 보관한다.

## BlogAutoMCP 적용
- 프롬프트 조립은 `scripts/lib/photoreal/`(TypeScript 이식)이 담당한다. 문장 풀·층 규칙은 `scripts/build_prompt.py`와 같다.
- 블로그용 장면(쇼핑 연출 배경, 여행 장소)을 추가했다. 사람이 없는 컷에는 L1~L3만, 사람이 나오는 컷에만 L4·L5를 넣는다.
- 이미지 생성은 Codex CLI 내장 image_generation(ChatGPT 로그인, gpt-image-2)으로 한다. 자세한 흐름은 `docs/image-generation-workflow.md`.
