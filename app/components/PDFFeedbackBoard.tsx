'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Upload, Play, Square, ChevronLeft, ChevronRight } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';

const PDFFeedbackBoard: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [pdfLoaded, setPdfLoaded] = useState(false);
  const [pdfDocument, setPdfDocument] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.5);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // PDF.js worker 설정
  useEffect(() => {
    if (typeof window !== 'undefined') {
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.js';
    }
  }, []);

  // PDF 로딩 완료 시 첫 페이지 렌더링
  useEffect(() => {
    if (pdfDocument && pdfLoaded && canvasRef.current) {
      renderPage(pdfDocument, currentPage, scale);
    }
  }, [pdfDocument, pdfLoaded]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || file.type !== 'application/pdf') {
      console.error('Invalid file type:', file?.type);
      return;
    }

    setLoading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument(arrayBuffer);
      const pdf = await loadingTask.promise;
      
      setPdfDocument(pdf);
      setTotalPages(pdf.numPages);
      setCurrentPage(1);
      setPdfLoaded(true);
      
      // useEffect에서 자동으로 렌더링됨
    } catch (error) {
      console.error('PDF 로드 실패:', error);
      // 사용자에게 더 자세한 에러 정보 제공
      if (error instanceof Error) {
        console.error('Error details:', error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const renderPage = async (pdf: pdfjsLib.PDFDocumentProxy, pageNumber: number, customScale?: number) => {
    if (!canvasRef.current) {
      console.log('Canvas not ready');
      return;
    }
    
    try {
      console.log(`Rendering page ${pageNumber} with scale ${customScale || scale}`);
      const page = await pdf.getPage(pageNumber);
      const currentScale = customScale || scale;
      const viewport = page.getViewport({ scale: currentScale });
      
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      
      if (!context) {
        console.log('Canvas context not available');
        return;
      }
      
      // 캔버스 크기 설정
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      
      // 캔버스 클리어
      context.clearRect(0, 0, canvas.width, canvas.height);
      
      const renderContext = {
        canvasContext: context,
        viewport: viewport,
      };
      
      await page.render(renderContext).promise;
      console.log(`Page ${pageNumber} rendered successfully`);
    } catch (error) {
      console.error('페이지 렌더링 실패:', error);
    }
  };

  const goToPage = async (pageNumber: number) => {
    if (!pdfDocument || pageNumber < 1 || pageNumber > totalPages) return;
    
    setCurrentPage(pageNumber);
    await renderPage(pdfDocument, pageNumber);
  };

  const toggleRecording = () => {
    setIsRecording(!isRecording);
  };

  return (
    <div className="flex flex-col h-[80vh] bg-white rounded-lg shadow-lg">
      {/* 상단 툴바 */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center space-x-4">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            onChange={handleFileUpload}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            disabled={loading}
          >
            <Upload size={16} />
            <span>{loading ? '로딩 중...' : 'PDF 업로드'}</span>
          </button>
          
          {pdfLoaded && (
            <div className="text-sm text-gray-600">
              <span>페이지 {currentPage} / {totalPages}</span>
              <span className="ml-2">({Math.round(scale * 100)}%)</span>
            </div>
          )}
        </div>

        <button
          onClick={toggleRecording}
          disabled={!pdfLoaded}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg ${
            isRecording
              ? 'bg-red-600 text-white hover:bg-red-700'
              : 'bg-green-600 text-white hover:bg-green-700'
          } disabled:bg-gray-400 disabled:cursor-not-allowed`}
        >
          {isRecording ? <Square size={16} /> : <Play size={16} />}
          <span>{isRecording ? '녹화 중지' : '녹화 시작'}</span>
        </button>
      </div>

      {/* 메인 콘텐츠 영역 */}
      <div className="flex-1 flex items-center justify-center p-4">
        {loading ? (
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">PDF 로딩 중...</p>
          </div>
        ) : pdfLoaded ? (
          <div className="flex flex-col items-center">
            {/* PDF 캔버스 */}
            <div className="relative">
              <canvas
                ref={canvasRef}
                className="border border-gray-300 rounded-lg shadow-lg max-w-full max-h-[60vh]"
                style={{ width: 'auto', height: 'auto' }}
              />
            </div>
            
            {/* 페이지 네비게이션 */}
            {totalPages > 1 && (
              <div className="mt-4 flex items-center space-x-4 bg-white rounded-lg shadow-md px-4 py-2">
                <button
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage <= 1}
                  className="flex items-center space-x-1 px-3 py-1 bg-gray-100 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-200"
                >
                  <ChevronLeft size={16} />
                  <span>이전</span>
                </button>
                
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-600">페이지</span>
                  <input
                    type="number"
                    value={currentPage}
                    onChange={(e) => {
                      const page = parseInt(e.target.value);
                      if (page >= 1 && page <= totalPages) {
                        goToPage(page);
                      }
                    }}
                    className="w-16 px-2 py-1 text-center border border-gray-300 rounded"
                    min={1}
                    max={totalPages}
                  />
                  <span className="text-sm text-gray-600">/ {totalPages}</span>
                </div>
                
                <button
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage >= totalPages}
                  className="flex items-center space-x-1 px-3 py-1 bg-gray-100 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-200"
                >
                  <span>다음</span>
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
            
            {/* 줌 컨트롤 */}
            <div className="mt-2 flex items-center space-x-2 bg-white rounded-lg shadow-md px-3 py-1">
              <button
                onClick={async () => {
                  const newScale = Math.max(0.5, scale - 0.25);
                  setScale(newScale);
                  if (pdfDocument) {
                    await renderPage(pdfDocument, currentPage, newScale);
                  }
                }}
                className="px-2 py-1 bg-gray-100 rounded hover:bg-gray-200"
              >
                -
              </button>
              <span className="text-sm text-gray-600 min-w-[50px] text-center">
                {Math.round(scale * 100)}%
              </span>
              <button
                onClick={async () => {
                  const newScale = Math.min(3, scale + 0.25);
                  setScale(newScale);
                  if (pdfDocument) {
                    await renderPage(pdfDocument, currentPage, newScale);
                  }
                }}
                className="px-2 py-1 bg-gray-100 rounded hover:bg-gray-200"
              >
                +
              </button>
            </div>
            
            {/* 녹화 상태 표시 */}
            {isRecording && (
              <div className="mt-4 flex items-center space-x-2 px-3 py-1 bg-red-100 text-red-600 rounded-full text-sm">
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                <span>녹화 중...</span>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center text-gray-500">
            <Upload size={48} className="mx-auto mb-4 text-gray-300" />
            <p className="text-lg mb-2">PDF 파일을 업로드하세요</p>
            <p className="text-sm">논문에 피드백을 추가하고 녹화할 수 있습니다</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default PDFFeedbackBoard;
