# v1.3.94 — Luna/low 고정 및 Astra 차단

- Codex 기반 원고·검토·이미지 제어 작업을 `gpt-6-luna`와 reasoning effort `low`로 고정합니다.
- ChatGPT 브라우저 작업은 계정의 `default` 모델을 사용하며 특정 모델이나 커스텀 GPT를 선택하지 않습니다.
- `gpt-6-astra`, 다른 Codex 모델, `low`보다 높은 reasoning effort 요청은 실행 전에 명시적으로 거부합니다.
- OpenAI API 모델 경로를 사용하지 않고 로그인된 ChatGPT/Codex 계정 경로만 유지합니다.
- 데스크톱 고정 설정과 패키지 검증에서 동일한 모델 정책을 확인합니다.

## 검증

- `npm run test:text-model-policy`
- `npm run test:fixed-draft-settings`
- `npm run test:codex-draft-provider`
- `npm run test:chatgpt-browser-automation`
- `npm run test:codex-image`
- `npm run test:post-spec`
- `npm run typecheck`
- `npx tsc --noEmit --project tsconfig.scripts.json --pretty false`
- `npm run build`
- `npm run test:packaged-update -- -AppPath out/release-1.3.94-final/win-unpacked/BrandConnect Automation.exe`
- `npm run site:update:verify -- out/release-1.3.94-final`

## 배포

- GitHub 릴리스: `v1.3.94`
- Windows 자동 업데이트 피드: `https://blogautomcp.hiway350051.chatgpt.site/api/updates/windows`
- 설치 파일: `BrandConnect-Automation-Setup-1.3.94.exe`
- 설치 파일 크기: `345060380` bytes
- 설치 파일 SHA-256: `acf5f068144d8a981171c96f53639b16af1406a45478ff7b79a66b247dae0351`
- blockmap SHA-256: `aa7aca52eb70e5ec00bc804681339df82d8480ba1028cf9682ed1bdd6fa074af`
