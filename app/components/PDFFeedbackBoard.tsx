'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Upload, Play, Square, ChevronLeft, ChevronRight, Pen, Type, Eraser, MousePointer, Minus, Plus } from 'lucide-react';

// 타입 정의
type PDFDocumentProxy = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<any>;
};

type RecorderType = {
  startRecording: () => void;
  stopRecording: (callback: () => void) => void;
  getBlob: () => Blob;
};

const PDFFeedbackBoard: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [pdfLoaded, setPdfLoaded] = useState(false);
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.5);
  const [loading, setLoading] = useState(false);
  
  // 녹화 관련 상태
  const [recorder, setRecorder] = useState<RecorderType | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // 화이트보드 관련 상태
  const [selectedTool, setSelectedTool] = useState<'pointer' | 'pen' | 'text' | 'eraser' | 'mask'>('pointer');
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState(3);
  const [brushColor, setBrushColor] = useState('#ff0000');
  const [maskColor, setMaskColor] = useState('#ffff00'); // 마스킹 전용 색상
  const [maskOpacity, setMaskOpacity] = useState(0.05); // 마스킹 투명도 - 매우 연하게
  const [textInput, setTextInput] = useState('');
  const [textPosition, setTextPosition] = useState<{ x: number; y: number } | null>(null);
  const [showTextInput, setShowTextInput] = useState(false);
  const [maskPath, setMaskPath] = useState<{x: number, y: number}[]>([]); // 마스킹 경로 저장
  
  // 드래그 관련 상태
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [canvasPosition, setCanvasPosition] = useState({ x: 0, y: 0 });
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  // PDF.js worker 설정
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // PDF.js 동적 임포트
      import('pdfjs-dist').then((pdfjsLib) => {
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.js';
      });
    }
  }, []);

  // PDF 로딩 완료 시 첫 페이지 렌더링
  useEffect(() => {
    if (pdfDocument && pdfLoaded && canvasRef.current) {
      renderPage(pdfDocument, currentPage, scale);
      // 오버레이 캔버스 크기도 설정
      setupOverlayCanvas();
    }
  }, [pdfDocument, pdfLoaded]);

  const setupOverlayCanvas = () => {
    if (canvasRef.current && overlayCanvasRef.current) {
      const mainCanvas = canvasRef.current;
      const overlayCanvas = overlayCanvasRef.current;
      
      // 오버레이 캔버스를 메인 캔버스와 동일한 크기로 설정
      overlayCanvas.width = mainCanvas.width;
      overlayCanvas.height = mainCanvas.height;
      
      // CSS 스타일도 동일하게 설정
      const mainCanvasStyle = window.getComputedStyle(mainCanvas);
      overlayCanvas.style.width = mainCanvasStyle.width;
      overlayCanvas.style.height = mainCanvasStyle.height;
    }
  };

  // 줌 변경 함수
  const changeScale = async (newScale: number) => {
    if (!pdfDocument) return;
    
    setScale(newScale);
    await renderPage(pdfDocument, currentPage, newScale);
    // 오버레이는 클리어하지 않고 크기만 조정
    setTimeout(() => setupOverlayCanvas(), 50);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || file.type !== 'application/pdf') {
      console.error('Invalid file type:', file?.type);
      return;
    }

    setLoading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      
      // PDF.js 동적 임포트
      const pdfjsLib = await import('pdfjs-dist');
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

  const renderPage = async (pdf: PDFDocumentProxy, pageNumber: number, customScale?: number) => {
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
      
      // 페이지 렌더링 후 오버레이 캔버스 크기 업데이트
      setupOverlayCanvas();
    } catch (error) {
      console.error('페이지 렌더링 실패:', error);
    }
  };

  // 마우스 이벤트 핸들러들
  const handleMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = overlayCanvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    if (selectedTool === 'pointer') {
      // 포인터 도구일 때는 드래그 시작
      setIsDragging(true);
      setDragStart({ x: event.clientX - canvasPosition.x, y: event.clientY - canvasPosition.y });
      return;
    }
    
    if (selectedTool === 'text') {
      setTextPosition({ x, y });
      setShowTextInput(true);
      setTimeout(() => textInputRef.current?.focus(), 100);
      return;
    }
    
    setIsDrawing(true);
    
    if (selectedTool === 'pen' || selectedTool === 'mask') {
      startDrawing(x, y);
    } else if (selectedTool === 'eraser') {
      startErasing(x, y);
    }
  };
  
  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (selectedTool === 'pointer' && isDragging) {
      // 포인터 도구로 드래그 중
      const newX = event.clientX - dragStart.x;
      const newY = event.clientY - dragStart.y;
      setCanvasPosition({ x: newX, y: newY });
      return;
    }
    
    if (!isDrawing || selectedTool === 'pointer' || selectedTool === 'text') return;
    
    const rect = overlayCanvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    if (selectedTool === 'pen' || selectedTool === 'mask') {
      continueDrawing(x, y);
    } else if (selectedTool === 'eraser') {
      continueErasing(x, y);
    }
  };
  
  const handleMouseUp = () => {
    setIsDrawing(false);
    setIsDragging(false);
    
    // 마스킹 도구인 경우 최종 처리
    if (selectedTool === 'mask' && maskPath.length > 0) {
      finalizeMask();
    }
    
    // 지우개 사용 후 composite operation 리셋하고 globalAlpha도 리셋
    const canvas = overlayCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1.0; // 투명도 리셋
      }
    }
  };

  // 마우스 휠로 줌 제어
  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    if (event.ctrlKey) {
      event.preventDefault();
      const delta = event.deltaY > 0 ? -0.1 : 0.1;
      const newScale = Math.max(0.5, Math.min(3, scale + delta));
      changeScale(newScale);
    }
  };

  // 보드 전체에서의 휠 이벤트 (스크롤 또는 줌)
  const handleBoardWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (event.ctrlKey) {
      event.preventDefault();
      const delta = event.deltaY > 0 ? -0.1 : 0.1;
      const newScale = Math.max(0.5, Math.min(3, scale + delta));
      changeScale(newScale);
    }
  };
  
  // 그리기 함수들
  const startDrawing = (x: number, y: number) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    if (selectedTool === 'mask') {
      // 마스킹 도구: 경로 시작
      setMaskPath([{ x, y }]);
    } else {
      // 일반 펜 도구
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1.0;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.strokeStyle = brushColor;
      ctx.fillStyle = brushColor;
      ctx.lineWidth = brushSize;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    }
  };
  
  const continueDrawing = (x: number, y: number) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    if (selectedTool === 'mask') {
      // 마스킹 도구: 경로에 점 추가하고 실시간 미리보기
      setMaskPath(prevPath => {
        const newPath = [...prevPath, { x, y }];
        drawMaskPreview(newPath);
        return newPath;
      });
    } else {
      // 일반 펜 도구
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  };

  // 마스킹 미리보기 그리기
  const drawMaskPreview = (path: {x: number, y: number}[]) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas || path.length < 2) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // 현재 캔버스 상태를 임시로 저장
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    // 캔버스 지우고 다시 그리기
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 기존 내용 복원 (마스킹 미리보기 제외)
    ctx.putImageData(imageData, 0, 0);
    
    // 새 마스킹 경로 그리기
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = maskOpacity; // 전체 투명도 설정
    
    // 마스킹 색상 설정
    const r = parseInt(maskColor.slice(1, 3), 16);
    const g = parseInt(maskColor.slice(3, 5), 16);
    const b = parseInt(maskColor.slice(5, 7), 16);
    
    ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`; // 투명도는 globalAlpha로 처리
    ctx.lineWidth = brushSize * 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) {
      ctx.lineTo(path[i].x, path[i].y);
    }
    ctx.stroke();
    
    ctx.restore();
  };

  // 마스킹 완료 처리
  const finalizeMask = () => {
    if (maskPath.length < 2) return;
    
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // 최종 마스킹 그리기
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = maskOpacity; // 전체 투명도 설정
    
    const r = parseInt(maskColor.slice(1, 3), 16);
    const g = parseInt(maskColor.slice(3, 5), 16);
    const b = parseInt(maskColor.slice(5, 7), 16);
    
    ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`; // 투명도는 globalAlpha로 처리
    ctx.lineWidth = brushSize * 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    ctx.beginPath();
    ctx.moveTo(maskPath[0].x, maskPath[0].y);
    for (let i = 1; i < maskPath.length; i++) {
      ctx.lineTo(maskPath[i].x, maskPath[i].y);
    }
    ctx.stroke();
    
    ctx.restore();
    setMaskPath([]);
  };
  
  const startErasing = (x: number, y: number) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(x, y, brushSize * 2, 0, Math.PI * 2);
    ctx.fill();
  };
  
  const continueErasing = (x: number, y: number) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(x, y, brushSize * 2, 0, Math.PI * 2);
    ctx.fill();
  };
  
  // 텍스트 추가
  const addText = () => {
    if (!textInput.trim() || !textPosition || !overlayCanvasRef.current) return;
    
    const canvas = overlayCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1.0; // 텍스트는 불투명
    ctx.font = `${brushSize * 5}px Arial`;
    ctx.fillStyle = brushColor;
    ctx.fillText(textInput, textPosition.x, textPosition.y);
    
    setTextInput('');
    setTextPosition(null);
    setShowTextInput(false);
  };
  
  // 오버레이 클리어
  const clearOverlay = () => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const goToPage = async (pageNumber: number) => {
    if (!pdfDocument || pageNumber < 1 || pageNumber > totalPages) return;
    
    setCurrentPage(pageNumber);
    await renderPage(pdfDocument, pageNumber);
    // 페이지 변경 시 오버레이 클리어
    clearOverlay();
  };

  // 녹화 관련 함수들
  const startRecording = async () => {
    try {
      // 화면 캡처 시작
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 }
        },
        audio: true // 시스템 오디오와 마이크 포함
      });

      // RecordRTC 동적 임포트
      const RecordRTC = (await import('recordrtc')).default;

      // RecordRTC 설정
      const options = {
        type: 'video' as const,
        mimeType: 'video/webm;codecs=vp9' as const,
        bitsPerSecond: 8000000, // 8Mbps
        videoBitsPerSecond: 6000000,
        audioBitsPerSecond: 128000
      };

      const recordRTC = new RecordRTC(stream, options);
      recordRTC.startRecording();
      
      setRecorder(recordRTC);
      setIsRecording(true);
      setRecordingTime(0);
      
      // 녹화 시간 카운터 시작
      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
      
      console.log('화면 녹화가 시작되었습니다.');
      
      // 스트림 종료 이벤트 처리 (사용자가 브라우저에서 공유 중지한 경우)
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        stopRecording();
      });
      
    } catch (error) {
      console.error('녹화 시작 실패:', error);
      alert('화면 녹화를 시작할 수 없습니다. 브라우저에서 화면 공유 권한을 허용해주세요.');
    }
  };

  const stopRecording = () => {
    if (!recorder) return;
    
    recorder.stopRecording(() => {
      const blob = recorder.getBlob();
      setRecordedBlob(blob);
      
      // 녹화 파일 다운로드
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pdf-feedback-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      console.log('녹화가 완료되었습니다.');
    });
    
    setRecorder(null);
    setIsRecording(false);
    setRecordingTime(0);
    
    // 녹화 시간 카운터 중지
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  // 컴포넌트 언마운트 시 정리
  useEffect(() => {
    return () => {
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
      if (recorder) {
        recorder.stopRecording(() => {});
      }
    };
  }, [recorder]);

  return (
    <div className="flex flex-col h-[90vh] bg-white rounded-lg shadow-lg">
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
            <>
              <div className="text-sm text-gray-600">
                <span>페이지 {currentPage} / {totalPages}</span>
                <span className="ml-2">({Math.round(scale * 100)}%)</span>
              </div>
              
              {/* 화이트보드 도구들 */}
              <div className="flex items-center space-x-2 border-l pl-4">
                {[
                  { tool: 'pointer' as const, icon: MousePointer, label: '포인터' },
                  { tool: 'pen' as const, icon: Pen, label: '펜' },
                  { tool: 'text' as const, icon: Type, label: '텍스트' },
                  { tool: 'mask' as const, icon: Square, label: '마스킹' },
                  { tool: 'eraser' as const, icon: Eraser, label: '지우개' },
                ].map(({ tool, icon: Icon, label }) => (
                  <button
                    key={tool}
                    onClick={() => setSelectedTool(tool)}
                    className={`p-2 rounded-lg transition-colors ${
                      selectedTool === tool
                        ? 'bg-blue-100 text-blue-600 border border-blue-300'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                    title={label}
                  >
                    <Icon size={16} />
                  </button>
                ))}
                
                {/* 브러시 크기 조절 */}
                <div className="flex items-center space-x-1 border-l pl-2">
                  <button
                    onClick={() => setBrushSize(Math.max(1, brushSize - 1))}
                    className="p-1 rounded hover:bg-gray-200"
                  >
                    <Minus size={12} />
                  </button>
                  <span className="text-xs w-6 text-center">{brushSize}</span>
                  <button
                    onClick={() => setBrushSize(Math.min(20, brushSize + 1))}
                    className="p-1 rounded hover:bg-gray-200"
                  >
                    <Plus size={12} />
                  </button>
                </div>
                
                {/* 색상 선택 */}
                <div className="flex items-center space-x-2">
                  <input
                    type="color"
                    value={brushColor}
                    onChange={(e) => setBrushColor(e.target.value)}
                    className="w-8 h-8 rounded border cursor-pointer"
                    title="펜 색상"
                  />
                  
                  {/* 마스킹 도구 선택 시 추가 컨트롤 */}
                  {selectedTool === 'mask' && (
                    <div className="flex items-center space-x-2 border-l pl-2">
                      <input
                        type="color"
                        value={maskColor}
                        onChange={(e) => setMaskColor(e.target.value)}
                        className="w-8 h-8 rounded border cursor-pointer"
                        title="마스킹 색상"
                      />
                      <div className="flex flex-col items-center">
                        <span className="text-xs text-gray-600 mb-1">투명도</span>
                        <input
                          type="range"
                          min="0.05"
                          max="0.5"
                          step="0.05"
                          value={maskOpacity}
                          onChange={(e) => setMaskOpacity(parseFloat(e.target.value))}
                          className="w-16 h-1"
                          title={`투명도: ${Math.round(maskOpacity * 100)}%`}
                        />
                        <span className="text-xs text-gray-500">{Math.round(maskOpacity * 100)}%</span>
                      </div>
                    </div>
                  )}
                </div>
                
                {/* 클리어 버튼 */}
                <button
                  onClick={clearOverlay}
                  className="px-3 py-1 text-xs bg-red-100 text-red-600 rounded hover:bg-red-200"
                >
                  지우기
                </button>
              </div>
            </>
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
          {isRecording && (
            <span className="bg-red-800 px-2 py-1 rounded text-sm">
              {Math.floor(recordingTime / 60)}:{(recordingTime % 60).toString().padStart(2, '0')}
            </span>
          )}
        </button>
      </div>

      {/* 메인 콘텐츠 영역 */}
      <div className="flex-1 flex flex-col">
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-gray-600">PDF 로딩 중...</p>
            </div>
          </div>
        ) : pdfLoaded ? (
          <>
            {/* 무한 스크롤 보드 */}
            <div 
              ref={boardRef}
              className="flex-1 overflow-auto bg-gray-50 relative"
              style={{ 
                cursor: selectedTool === 'pointer' && !isDragging ? 'grab' : 
                       selectedTool === 'pointer' && isDragging ? 'grabbing' : 'default'
              }}
              onWheel={handleBoardWheel}
            >
              {/* PDF 캔버스 컨테이너 */}
              <div 
                className="absolute"
                style={{
                  left: `${canvasPosition.x + 100}px`,
                  top: `${canvasPosition.y + 100}px`,
                  transform: 'translate3d(0, 0, 0)', // GPU 가속
                }}
              >
                <div className="relative">
                  <canvas
                    ref={canvasRef}
                    className="border border-gray-300 rounded-lg shadow-lg bg-white"
                    style={{ width: 'auto', height: 'auto' }}
                  />
                  {/* 오버레이 캔버스 - 화이트보드 */}
                  <canvas
                    ref={overlayCanvasRef}
                    className="absolute top-0 left-0 rounded-lg"
                    style={{ 
                      width: 'auto', 
                      height: 'auto',
                      cursor: selectedTool === 'pointer' ? (isDragging ? 'grabbing' : 'grab') : 
                             selectedTool === 'pen' ? 'crosshair' :
                             selectedTool === 'text' ? 'text' :
                             selectedTool === 'mask' ? 'crosshair' :
                             selectedTool === 'eraser' ? 'grab' : 'default'
                    }}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    onWheel={handleWheel}
                  />
                  
                  {/* 텍스트 입력 */}
                  {showTextInput && textPosition && (
                    <div
                      className="absolute bg-white border border-gray-300 rounded shadow-lg p-2"
                      style={{
                        left: textPosition.x,
                        top: textPosition.y,
                        zIndex: 1000
                      }}
                    >
                      <input
                        ref={textInputRef}
                        type="text"
                        value={textInput}
                        onChange={(e) => setTextInput(e.target.value)}
                        onKeyPress={(e) => {
                          if (e.key === 'Enter') {
                            addText();
                          } else if (e.key === 'Escape') {
                            setShowTextInput(false);
                            setTextInput('');
                            setTextPosition(null);
                          }
                        }}
                        className="px-2 py-1 border border-gray-300 rounded text-sm"
                        placeholder="텍스트 입력..."
                        autoFocus
                      />
                      <div className="flex space-x-1 mt-1">
                        <button
                          onClick={addText}
                          className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
                        >
                          추가
                        </button>
                        <button
                          onClick={() => {
                            setShowTextInput(false);
                            setTextInput('');
                            setTextPosition(null);
                          }}
                          className="px-2 py-1 bg-gray-300 text-gray-700 text-xs rounded hover:bg-gray-400"
                        >
                          취소
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            
            {/* 하단 컨트롤 패널 */}
            <div className="p-3 bg-white border-t flex items-center justify-center space-x-6">
              {/* 페이지 네비게이션 */}
              {totalPages > 1 && (
                <div className="flex items-center space-x-4 bg-gray-50 rounded-lg px-4 py-2">
                  <button
                    onClick={() => goToPage(currentPage - 1)}
                    disabled={currentPage <= 1}
                    className="flex items-center space-x-1 px-3 py-1 bg-white text-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                  >
                    <ChevronLeft size={16} />
                    <span>이전</span>
                  </button>
                  
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-700">페이지</span>
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
                    <span className="text-sm text-gray-700">/ {totalPages}</span>
                  </div>
                  
                  <button
                    onClick={() => goToPage(currentPage + 1)}
                    disabled={currentPage >= totalPages}
                    className="flex items-center space-x-1 px-3 py-1 bg-white text-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                  >
                    <span>다음</span>
                    <ChevronRight size={16} />
                  </button>
                </div>
              )}
              
              {/* 줌 컨트롤 */}
              <div className="flex items-center space-x-2 bg-gray-50 rounded-lg px-3 py-2">
                <button
                  onClick={() => changeScale(Math.max(0.5, scale - 0.25))}
                  className="px-2 py-1 bg-white text-gray-700 rounded hover:bg-gray-100 transition-colors"
                  disabled={scale <= 0.5}
                >
                  -
                </button>
                
                {/* 빠른 줌 버튼들 */}
                <button
                  onClick={() => changeScale(0.5)}
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    Math.abs(scale - 0.5) < 0.1 ? 'bg-blue-100 text-blue-600' : 'bg-white text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  50%
                </button>
                <button
                  onClick={() => changeScale(1.0)}
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    Math.abs(scale - 1.0) < 0.1 ? 'bg-blue-100 text-blue-600' : 'bg-white text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  100%
                </button>
                <button
                  onClick={() => changeScale(1.5)}
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    Math.abs(scale - 1.5) < 0.1 ? 'bg-blue-100 text-blue-600' : 'bg-white text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  150%
                </button>
                
                <span className="text-sm text-gray-800 min-w-[50px] text-center font-mono">
                  {Math.round(scale * 100)}%
                </span>
                
                <button
                  onClick={() => changeScale(Math.min(3, scale + 0.25))}
                  className="px-2 py-1 bg-white text-gray-700 rounded hover:bg-gray-100 transition-colors"
                  disabled={scale >= 3}
                >
                  +
                </button>
              </div>

              {/* 포지션 리셋 버튼 */}
              <button
                onClick={() => setCanvasPosition({ x: 0, y: 0 })}
                className="px-3 py-2 bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100 text-sm"
              >
                중앙으로
              </button>
              
              {/* 녹화 상태 표시 */}
              {isRecording && (
                <div className="flex items-center space-x-2 px-3 py-2 bg-red-100 text-red-600 rounded-lg text-sm">
                  <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                  <span>녹화 중 ({Math.floor(recordingTime / 60)}:{(recordingTime % 60).toString().padStart(2, '0')})</span>
                </div>
              )}
              
              {/* 녹화된 파일이 있을 때 안내 */}
              {recordedBlob && !isRecording && (
                <div className="flex items-center space-x-2 px-3 py-2 bg-green-100 text-green-600 rounded-lg text-sm">
                  <span>✓ 녹화 완료 - 파일이 다운로드되었습니다</span>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <Upload size={48} className="mx-auto mb-4 text-gray-300" />
              <p className="text-lg mb-2">PDF 파일을 업로드하세요</p>
              <p className="text-sm">논문에 피드백을 추가하고 녹화할 수 있습니다</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PDFFeedbackBoard;
