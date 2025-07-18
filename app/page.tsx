'use client';

import React from 'react';
import PDFFeedbackBoard from './components/PDFFeedbackBoard';

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
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
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <PDFFeedbackBoard />
      </main>
    </div>
  );
}
