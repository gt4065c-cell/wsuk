# 조선 100인 — 매일 인물 그림 4장 만들기

게시된 사이트: https://claude.ai/artifact/GZnAniKuZ5CuMjtEBYYbR8
그림 폴더: `chosun100/img/NNN.jpg` (번호 3자리, 예: 002.jpg)

## 순서

1. 브랜치 `ccr-8509818b-b3shpp` 를 받아 체크아웃한다 (`git fetch origin ccr-8509818b-b3shpp && git checkout ccr-8509818b-b3shpp`).
2. `python3 -I chosun100/scripts/next_batch.py 4` 로 아직 그림이 없는 다음 4명을 얻는다. 결과가 비어 있으면 100명 모두 완성된 것이므로 아무것도 하지 않고 끝낸다.
3. 인물마다 그림 1장을 만든다 (ElevenLabs `creative_generate_image`, 안 되면 Canva `generate-image`).
   - 세로 2:3, 영화 스틸 같은 사실적 시네마틱 인물 사진, 어두운 실내 조명, 조선 시대 고증 복식.
   - 화면 안에 글자·자막·로고를 넣지 않는다.
   - 프롬프트 예: `Cinematic portrait still, Joseon dynasty Korea, {영문 인물 설명: 신분/역할}, {이야기(copy)를 보여주는 장면}, historically accurate {era} costume, moody low-key lighting, dark ink-black background tones, 35mm film, photorealistic, vertical 2:3, no text`
   - 생성 결과가 여러 장이면 가장 고증·구도가 좋은 1장을 고른다.
4. 그림을 받아 400×600 JPG(품질 82 안팎, 60KB 내외)로 줄여 `chosun100/img/NNN.jpg` 로 저장한다.
5. 사이트를 다시 게시한다: Artifact publish, `url` = 위 사이트 주소, `file_path` = `chosun100/index.html`,
   `files` 에 새 그림 4장을 `img/NNN.jpg` 경로로 넣는다 (기존 그림은 그대로 남는다).
   게시 전 반드시 `action: "read"` 로 사이트를 한 번 읽는다.
6. 커밋 후 `git push -u origin ccr-8509818b-b3shpp`.
7. 오늘 만든 4명의 이름과 남은 인원을 짧게 보고한다.
