'use client';

import React from 'react';
import PDFFeedbackBoard from './components/PDFFeedbackBoard';

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center">
      <header className="bg-white shadow-sm border-b w-full flex justify-center">
        <div className="max-w-[1600px] w-full px-8">
          <div className="flex justify-between items-center py-4">
            <h1 className="text-2xl font-bold text-gray-900">
              논문 피드백 서비스
            </h1>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-500">
                PDF 로드 • 마스킹 • 녹화 • 공유
              </span>
            </div>
          </div>
        </div>
      </header>
      <main className="flex justify-center w-full py-6">
        <div className="max-w-[1600px] w-full px-8 flex justify-center">
          <PDFFeedbackBoard />
        </div>
      </main>
    </div>
  );
}
