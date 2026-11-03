# 하루살림 — 개인 가계부

HTML/CSS/JavaScript 프런트엔드와 Express API, Neon PostgreSQL로 만든 개인 가계부입니다.

## 로컬 실행

1. Neon에서 PostgreSQL 프로젝트를 만들고 연결 문자열을 복사합니다.
2. 프로젝트 루트에 `.env` 파일을 만들고 `DATABASE_URL`, `APP_PASSWORD`를 입력합니다.
3. 아래 명령을 실행합니다.

```bash
npm install
node --env-file=.env server.js
```

브라우저에서 `http://localhost:3000`을 엽니다. `expenses` 테이블과 인덱스는 첫 인증 API 요청 때 자동 생성됩니다.

## Vercel 배포

1. 이 폴더를 GitHub 저장소에 push합니다.
2. Vercel에서 저장소를 Import합니다.
3. Project Settings → Environment Variables에 다음 값을 등록합니다.
   - `DATABASE_URL`: Neon 연결 문자열
   - `APP_PASSWORD`: 앱 로그인에 사용할 충분히 긴 비밀번호
4. Deploy를 실행합니다.

`.env` 파일은 `.gitignore`에 포함되어 있으므로 커밋하지 마세요. Neon에서는 Vercel 연동 또는 pooled connection string 사용을 권장합니다.

## API

- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/status`
- `GET/POST /api/expenses`
- `PUT/DELETE /api/expenses/:id`
- `GET /api/stats?month=YYYY-MM`
