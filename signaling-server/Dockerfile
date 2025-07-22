# 시그널링 서버용 Dockerfile
FROM node:20.16.0-alpine

WORKDIR /app

# 패키지 매니저 및 필수 도구 설치
RUN apk add --no-cache libc6-compat

# 의존성 파일 복사 및 설치
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 애플리케이션 코드 복사
COPY server.js ./

# 포트 노출
EXPOSE 4001

# 환경변수 설정
ENV NODE_ENV=production

# 애플리케이션 시작
CMD ["node", "server.js"]
