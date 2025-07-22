import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  // PDF.js 파일들을 위한 정적 파일 서빙 설정
  async headers() {
    return [
      {
        source: '/pdfjs/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
