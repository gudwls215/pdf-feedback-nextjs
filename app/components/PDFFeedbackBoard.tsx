'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Upload, Play, Square, ChevronLeft, ChevronRight, Pen, Type, Eraser, MousePointer, Minus, Plus, Share, Users, Copy, ExternalLink } from 'lucide-react';

// 타입 정의
type PDFDocumentProxy = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<any>;
};

type RecorderType = {
  startRecording: () => void;
  stopRecording: (callback: () => void) => void;
  getBlob: () => Blob;
  destroy?: () => void;
  getInternalRecorder?: () => any;
  getState?: () => string;
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
  const [recordedFiles, setRecordedFiles] = useState<{name: string, blob: Blob, timestamp: Date}[]>([]);
  const [showFileList, setShowFileList] = useState(false);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // 실시간 스트리밍 관련 상태
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingTime, setStreamingTime] = useState(0);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [showStreamingModal, setShowStreamingModal] = useState(false);
  const [streamingUrl, setStreamingUrl] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'failed'>('disconnected');
  const [viewerCount, setViewerCount] = useState(0);
  const streamingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const socketRef = useRef<any>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const streamIdRef = useRef<string>('');
  
  // 뷰어 연결 대기 큐
  const pendingViewersRef = useRef<string[]>([]);
  const isStreamReadyRef = useRef<boolean>(false);
  const localStreamRef = useRef<MediaStream | null>(null); // 즉시 접근 가능한 스트림 ref
  
  // WebRTC 설정
  const rtcConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' }
    ]
  };
  
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

  // 스트리밍 시간 업데이트를 위한 useEffect
  useEffect(() => {
    if (isStreaming && !streamingIntervalRef.current) {
      streamingIntervalRef.current = setInterval(() => {
        setStreamingTime(prev => prev + 1);
      }, 1000);
    } else if (!isStreaming && streamingIntervalRef.current) {
      clearInterval(streamingIntervalRef.current);
      streamingIntervalRef.current = null;
    }

    return () => {
      if (streamingIntervalRef.current) {
        clearInterval(streamingIntervalRef.current);
        streamingIntervalRef.current = null;
      }
    };
  }, [isStreaming]);

  // 녹화 시간 업데이트를 위한 별도 useEffect
  useEffect(() => {
    if (isRecording && !recordingIntervalRef.current) {
      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime(prev => {
          //console.log('Recording time updated:', prev + 1); // 디버그용
          return prev + 1;
        });
      }, 1000);
    } else if (!isRecording && recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }

    return () => {
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
    };
  }, [isRecording]);

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

  // 실시간 스트리밍 관련 함수들
  const connectToSignalingServer = () => {
    if (typeof window === 'undefined') return null;
    
    // Socket.IO 동적 임포트
    import('socket.io-client').then((io) => {
      const socket = io.default('http://192.168.0.152:3001', {
        transports: ['websocket', 'polling']
      });
      
      socketRef.current = socket;
      
      socket.on('connect', () => {
        console.log('시그널링 서버에 연결되었습니다');
      });
      
      socket.on('stream-started', (data) => {
        console.log('스트림 시작됨:', data);
      });
      
      socket.on('viewer-joined', (data) => {
        console.log('새 뷰어 참여:', data);
        setViewerCount(data.viewerCount);
        
        // 스트림이 준비된 경우 즉시 연결 시도, 아니면 큐에 추가
        console.log('스트림 준비 상태:', isStreamReadyRef.current, '로컬 스트림 ref:', !!localStreamRef.current, '로컬 스트림 state:', !!localStream);
        if (isStreamReadyRef.current && localStreamRef.current) {
          console.log('스트림 준비됨, 즉시 뷰어 연결 처리:', data.viewerId);
          setupPeerConnectionForStreamer(data.viewerId);
        } else if (isStreamReadyRef.current && localStream) {
          // localStreamRef가 null이지만 state에는 스트림이 있을 때 setupPeerConnection 호출
          console.log('스트림 준비됨 (state 기반), setupPeerConnection 호출:', data.viewerId);
          setupPeerConnection(data.viewerId);
        } else {
          console.log('스트림이 아직 준비되지 않음, 뷰어를 대기 큐에 추가:', data.viewerId);
          pendingViewersRef.current.push(data.viewerId);
        }
      });
      
      socket.on('viewer-left', (data) => {
        console.log('뷰어 나감:', data);
        setViewerCount(data.viewerCount);
      });
      
      socket.on('offer', async (data) => {
        console.log('Offer 수신:', data);
        await handleOffer(data);
      });
      
      socket.on('answer', async (data) => {
        console.log('스트리머: Answer 수신:', data);
        await handleAnswer(data);
      });
      
      socket.on('ice-candidate', async (data) => {
        console.log('ICE candidate 수신:', data);
        await handleIceCandidate(data);
      });
      
      socket.on('stream-ended', () => {
        console.log('스트림 종료됨');
        stopStreaming();
      });
      
      socket.on('disconnect', () => {
        console.log('시그널링 서버 연결 해제');
        setConnectionStatus('disconnected');
      });
    });
  };
  
  const setupPeerConnection = async (viewerId: string) => {
    if (!localStream) return;
    
    const peerConnection = new RTCPeerConnection(rtcConfiguration);
    peerConnectionRef.current = peerConnection;
    
    // 로컬 스트림을 peer connection에 추가
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });
    
    // ICE candidate 이벤트
    peerConnection.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('ice-candidate', {
          candidate: event.candidate,
          targetSocketId: viewerId,
          streamId: streamIdRef.current
        });
      }
    };
    
    // Offer 생성 및 전송
    try {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      
      if (socketRef.current) {
        socketRef.current.emit('offer', {
          offer,
          targetSocketId: viewerId,
          streamId: streamIdRef.current
        });
      }
    } catch (error) {
      console.error('Offer 생성 실패:', error);
    }
  };
  
  const setupPeerConnectionForStreamer = async (viewerId: string) => {
    console.log('스트리머: 새 뷰어를 위한 Peer connection 설정 중...', viewerId);
    
    // 로컬 스트림 확인 (ref 사용)
    const currentStream = localStreamRef.current;
    if (!currentStream || !isStreamReadyRef.current) {
      console.error('로컬 스트림이 준비되지 않음:', { 
        hasLocalStreamRef: !!currentStream, 
        hasLocalStreamState: !!localStream,
        isStreamReady: isStreamReadyRef.current 
      });
      
      // 뷰어를 대기 큐에 추가
      if (!pendingViewersRef.current.includes(viewerId)) {
        console.log('뷰어를 대기 큐에 추가:', viewerId);
        pendingViewersRef.current.push(viewerId);
      }
      return;
    }
    
    try {
      const peerConnection = new RTCPeerConnection(rtcConfiguration);
      
      console.log('로컬 스트림 트랙들:', currentStream.getTracks().map(t => `${t.kind}: ${t.id}`));
      
      // 로컬 스트림을 peer connection에 추가
      currentStream.getTracks().forEach(track => {
        console.log('트랙 추가:', track.kind, track.id);
        peerConnection.addTrack(track, currentStream);
      });
      
      // ICE candidate 이벤트
      peerConnection.onicecandidate = (event) => {
        if (event.candidate && socketRef.current) {
          console.log('스트리머: ICE candidate 전송:', event.candidate.candidate);
          socketRef.current.emit('ice-candidate', {
            candidate: event.candidate,
            targetSocketId: viewerId,
            streamId: streamIdRef.current
          });
        }
      };
      
      // 연결 상태 변경
      peerConnection.onconnectionstatechange = () => {
        console.log('스트리머 연결 상태:', peerConnection.connectionState);
      };
      
      // ICE 연결 상태 변경
      peerConnection.oniceconnectionstatechange = () => {
        console.log('스트리머 ICE 연결 상태:', peerConnection.iceConnectionState);
      };
      
      // Offer 생성 및 전송
      console.log('Offer 생성 중...');
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      
      console.log('Offer 생성 완료:', {
        type: offer.type,
        sdp: offer.sdp?.substring(0, 100) + '...'
      });
      
      if (socketRef.current) {
        socketRef.current.emit('offer', {
          offer,
          targetSocketId: viewerId,
          streamId: streamIdRef.current
        });
        console.log('스트리머: Offer 전송됨 -> 뷰어:', viewerId);
      } else {
        console.error('Socket이 연결되지 않음');
      }
      
      // 이 peer connection을 저장 (여러 뷰어 지원을 위해서는 Map을 사용해야 함)
      peerConnectionRef.current = peerConnection;
      
    } catch (error) {
      console.error('스트리머: Peer connection 설정 실패:', error);
    }
  };
  
  // 대기 중인 뷰어들 처리
  const processPendingViewers = () => {
    if (!isStreamReadyRef.current || !localStreamRef.current) {
      console.log('스트림이 아직 준비되지 않아 대기 중인 뷰어 처리를 건너뜁니다:', {
        isStreamReady: isStreamReadyRef.current,
        hasLocalStreamRef: !!localStreamRef.current,
        hasLocalStreamState: !!localStream
      });
      return;
    }
    
    const pendingViewers = [...pendingViewersRef.current];
    pendingViewersRef.current = []; // 큐 초기화
    
    console.log('대기 중인 뷰어들 처리:', pendingViewers);
    
    pendingViewers.forEach((viewerId) => {
      console.log('대기 중인 뷰어 연결 처리:', viewerId);
      setupPeerConnectionForStreamer(viewerId);
    });
  };
  
  const handleOffer = async (data: any) => {
    // 이 함수는 뷰어 측에서 사용됩니다
    // 스트리머는 offer를 받지 않으므로 현재는 비어있습니다
  };
  
  const handleAnswer = async (data: any) => {
    console.log('스트리머: Answer 처리 중...', data);
    if (peerConnectionRef.current) {
      try {
        await peerConnectionRef.current.setRemoteDescription(data.answer);
        console.log('스트리머: Answer 처리 완료 - WebRTC 연결 설정됨');
      } catch (error) {
        console.error('스트리머: Answer 처리 실패:', error);
      }
    } else {
      console.error('스트리머: PeerConnection이 없습니다');
    }
  };
  
  const handleIceCandidate = async (data: any) => {
    console.log('스트리머: ICE candidate 수신:', data);
    if (peerConnectionRef.current) {
      try {
        await peerConnectionRef.current.addIceCandidate(data.candidate);
        console.log('스트리머: ICE candidate 추가 완료');
      } catch (error) {
        console.error('스트리머: ICE candidate 추가 실패:', error);
      }
    } else {
      console.error('스트리머: PeerConnection이 없습니다');
    }
  };

  const startStreaming = async () => {
    try {
      console.log('Starting live streaming...');
      setConnectionStatus('connecting');
      
      // 화면 캡처 시작
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 }
        },
        audio: true // 시스템 오디오
      });

      // 마이크 오디오 캡처 시작
      let micStream: MediaStream | null = null;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
        console.log('마이크 오디오 캡처 성공');
      } catch (micError) {
        console.warn('마이크 접근 실패, 화면 오디오만 스트리밍합니다:', micError);
      }

      // 오디오 스트림 합성
      let finalStream = displayStream;
      
      if (micStream && displayStream.getAudioTracks().length > 0) {
        // 화면 오디오와 마이크 오디오를 모두 합성
        const audioContext = new AudioContext();
        const destination = audioContext.createMediaStreamDestination();
        
        // 화면 오디오 추가
        const displayAudioSource = audioContext.createMediaStreamSource(displayStream);
        displayAudioSource.connect(destination);
        
        // 마이크 오디오 추가
        const micAudioSource = audioContext.createMediaStreamSource(micStream);
        micAudioSource.connect(destination);
        
        // 새로운 스트림 생성 (비디오는 기존 것, 오디오는 합성된 것)
        const videoTrack = displayStream.getVideoTracks()[0];
        const combinedAudioTrack = destination.stream.getAudioTracks()[0];
        
        finalStream = new MediaStream([videoTrack, combinedAudioTrack]);
        console.log('화면 오디오와 마이크 오디오를 합성했습니다');
      } else if (micStream) {
        // 화면 오디오가 없고 마이크만 있는 경우
        const videoTrack = displayStream.getVideoTracks()[0];
        const micAudioTrack = micStream.getAudioTracks()[0];
        finalStream = new MediaStream([videoTrack, micAudioTrack]);
        console.log('마이크 오디오만 추가했습니다');
      }
      

      console.log('최종 스트림 트랙:', !!finalStream);
      // 스트림을 먼저 저장하고 준비 상태 표시 (state와 ref 모두 설정)
      setLocalStream(finalStream);
      localStreamRef.current = finalStream; // ref에도 즉시 저장
      isStreamReadyRef.current = true; // 스트림 준비 완료 표시
      console.log('로컬 스트림 설정 완료:', finalStream.getTracks().map(t => t.kind));
      
      // 고유한 스트리밍 ID 생성
      const streamId = Date.now().toString(36) + Math.random().toString(36).substr(2);
      streamIdRef.current = streamId;
      const generatedUrl = `${window.location.origin}/stream/${streamId}`;
      setStreamingUrl(generatedUrl);
      
      // 상태 업데이트
      setIsStreaming(true);
      setStreamingTime(0);
      setConnectionStatus('connected');
      
      console.log('실시간 스트리밍이 시작되었습니다 (화면 + 마이크)');
      console.log('스트리밍 URL:', generatedUrl);
      
      // 로컬 스트림이 준비된 후에 시그널링 서버에 연결
      connectToSignalingServer();
      
      // 약간의 지연 후 스트림 시작 알림 및 대기 중인 뷰어 처리
      setTimeout(() => {
        if (socketRef.current) {
          console.log('시그널링 서버에 스트림 시작 알림 전송');
          socketRef.current.emit('start-stream', { streamId });
          
          // 대기 중인 뷰어들 처리
          processPendingViewers();
        } else {
          console.error('시그널링 서버가 아직 연결되지 않음');
        }
      }, 2000);
      
      // 스트림 종료 이벤트 처리
      finalStream.getVideoTracks()[0].addEventListener('ended', () => {
        console.log('Video track ended, stopping streaming...');
        stopStreaming();
      });
      
    } catch (error) {
      console.error('스트리밍 시작 실패:', error);
      setConnectionStatus('failed');
      
      let errorMessage = '실시간 스트리밍을 시작할 수 없습니다.';
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          errorMessage = '화면 공유 또는 마이크 권한이 거부되었습니다. 브라우저에서 권한을 허용해주세요.';
        } else if (error.name === 'NotSupportedError') {
          errorMessage = '이 브라우저에서는 화면 공유를 지원하지 않습니다.';
        } else if (error.name === 'NotFoundError') {
          errorMessage = '화면 공유 소스 또는 마이크를 찾을 수 없습니다.';
        }
      }
      
      alert(errorMessage);
      
      // 실패 시 상태 리셋
      setIsStreaming(false);
      setLocalStream(null);
      setStreamingTime(0);
      setConnectionStatus('disconnected');
    }
  };

  const stopStreaming = () => {
    console.log('Stopping streaming...');
    
    // 시그널링 서버에 스트림 종료 알림
    if (socketRef.current && streamIdRef.current) {
      socketRef.current.emit('stop-stream', { streamId: streamIdRef.current });
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    
    // Peer connection 정리
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    
    if (localStream) {
      // 모든 트랙 정지
      localStream.getTracks().forEach(track => {
        try {
          track.stop();
          console.log('Stream track stopped:', track.kind);
        } catch (error) {
          console.error('Error stopping track:', error);
        }
      });
      
      setLocalStream(null);
    }
    
    // 스트림 준비 상태와 대기 큐 초기화
    isStreamReadyRef.current = false;
    localStreamRef.current = null; // ref도 초기화
    pendingViewersRef.current = [];
    
    setIsStreaming(false);
    setStreamingTime(0);
    setConnectionStatus('disconnected');
    setStreamingUrl('');
    setViewerCount(0);
    streamIdRef.current = '';
    
    console.log('실시간 스트리밍이 종료되었습니다');
  };

  const toggleStreaming = () => {
    if (isStreaming) {
      stopStreaming();
    } else {
      startStreaming();
    }
  };

  // URL 복사 함수
  const copyStreamingUrl = async () => {
    if (!streamingUrl) return;
    
    try {
      await navigator.clipboard.writeText(streamingUrl);
      alert('스트리밍 URL이 클립보드에 복사되었습니다!');
    } catch (error) {
      console.error('URL 복사 실패:', error);
      // fallback - 수동으로 선택할 수 있도록
      const textArea = document.createElement('textarea');
      textArea.value = streamingUrl;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        alert('스트리밍 URL이 클립보드에 복사되었습니다!');
      } catch (fallbackError) {
        alert(`URL을 수동으로 복사해주세요: ${streamingUrl}`);
      }
      document.body.removeChild(textArea);
    }
  };

  // 녹화 관련 함수들
  const startRecording = async () => {
    try {
      // 이전 recorder가 있으면 먼저 완전히 정리하고 분리
      if (recorder) {
        console.log('Cleaning up previous recorder before starting new recording...');
        
        // 현재 recorder를 로컬 변수로 복사하여 완전히 분리
        const oldRecorder = recorder;
        setRecorder(null); // 즉시 상태를 null로 변경
        setRecordingTime(0);
        
        // 이전 recorder를 별도로 정리 (비동기적으로)
        setTimeout(async () => {
          try {
            await cleanupOldRecorder(oldRecorder);
          } catch (cleanupError) {
            console.error('Old recorder cleanup failed:', cleanupError);
          }
        }, 100);
        
        // 정리 작업이 완료될 때까지 충분히 대기
        await new Promise(resolve => setTimeout(resolve, 800));
      }
      
      console.log('Starting completely new recording...');
      
      // 화면 캡처 시작
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 }
        },
        audio: true // 시스템 오디오
      });
      

      // 마이크 오디오 캡처 시작
      let micStream: MediaStream | null = null;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
        console.log('마이크 오디오 캡처 성공');
      } catch (micError) {
        console.warn('마이크 접근 실패, 화면 오디오만 녹화합니다:', micError);
      }

      // 오디오 스트림 합성
      let finalStream = displayStream;
      
      if (micStream && displayStream.getAudioTracks().length > 0) {
        // 화면 오디오와 마이크 오디오를 모두 합성
        const audioContext = new AudioContext();
        const destination = audioContext.createMediaStreamDestination();
        
        // 화면 오디오 추가
        const displayAudioSource = audioContext.createMediaStreamSource(displayStream);
        displayAudioSource.connect(destination);
        
        // 마이크 오디오 추가
        const micAudioSource = audioContext.createMediaStreamSource(micStream);
        micAudioSource.connect(destination);
        
        // 새로운 스트림 생성 (비디오는 기존 것, 오디오는 합성된 것)
        const videoTrack = displayStream.getVideoTracks()[0];
        const combinedAudioTrack = destination.stream.getAudioTracks()[0];
        
        finalStream = new MediaStream([videoTrack, combinedAudioTrack]);
        console.log('화면 오디오와 마이크 오디오를 합성했습니다');
      } else if (micStream) {
        // 화면 오디오가 없고 마이크만 있는 경우
        const videoTrack = displayStream.getVideoTracks()[0];
        const micAudioTrack = micStream.getAudioTracks()[0];
        finalStream = new MediaStream([videoTrack, micAudioTrack]);
        console.log('마이크 오디오만 추가했습니다');
      }

      // 완전히 새로운 RecordRTC 인스턴스 생성
      console.log('Creating completely fresh RecordRTC instance...');
      
      // RecordRTC 동적 임포트 (매번 새로 임포트)
      const RecordRTCModule = await import('recordrtc');
      const RecordRTC = RecordRTCModule.default;

      // RecordRTC 설정 - 새로운 인스턴스용 최적화된 설정
      const options = {
        type: 'video' as const,
        mimeType: 'video/webm;codecs=vp9' as const,
        bitsPerSecond: 4000000,
        videoBitsPerSecond: 3000000,
        audioBitsPerSecond: 128000,
        timeSlice: 1000, // 1초마다 데이터 수집
        checkForInactiveTracks: true,
        bufferSize: 16384 as const,
        // 새 인스턴스 보장을 위한 추가 옵션들
        numberOfAudioChannels: 2 as const,
        desiredSampRate: 44100
      };

      // 완전히 새로운 RecordRTC 객체 생성
      const recordRTC = new RecordRTC(finalStream, options);
      console.log('New RecordRTC instance created with fresh stream');
      
      // 녹화 시작 전 유효성 재확인
      console.log('Validating new recorder before start...');
      
      // 스트림 유효성 확인
      const videoTracks = finalStream.getVideoTracks();
      const audioTracks = finalStream.getAudioTracks();
      console.log('Video tracks:', videoTracks.length, 'Audio tracks:', audioTracks.length);
      
      if (videoTracks.length === 0) {
        throw new Error('No video tracks available');
      }
      
      // RecordRTC 내부 상태 초기화 확인
      try {
        const internalRecorder = recordRTC.getInternalRecorder?.();
        console.log('Internal recorder type:', internalRecorder?.constructor?.name || 'unknown');
      } catch (checkError) {
        console.log('Could not check internal recorder:', checkError);
      }
      
      // 녹화 시작
      console.log('Starting fresh recording...');
      recordRTC.startRecording();
      
      // 상태 확인 (안전하게)
      try {
        const state = recordRTC.getState ? recordRTC.getState() : 'unknown';
        console.log('Fresh RecordRTC state after start:', state);
      } catch (stateError) {
        console.log('Could not get fresh recorder state:', stateError);
      }
      
      // 새 recorder 설정 (이전 recorder는 이미 분리됨)
      setRecorder(recordRTC);
      setIsRecording(true);
      setRecordingTime(0);
      
      console.log('새로운 화면 녹화가 시작되었습니다 (마이크 포함)');
      
      // 스트림 종료 이벤트 처리 (사용자가 브라우저에서 공유 중지한 경우)
      videoTracks[0].addEventListener('ended', () => {
        console.log('Video track ended, stopping recording...');
        if (recordingTime < 2) {
          console.warn('Recording stopped too early, may result in empty blob');
        }
        stopRecording();
      });
      
    } catch (error) {
      console.error('녹화 시작 실패:', error);
      
      let errorMessage = '화면 녹화를 시작할 수 없습니다.';
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          errorMessage = '화면 공유 또는 마이크 권한이 거부되었습니다. 브라우저에서 권한을 허용해주세요.';
        } else if (error.name === 'NotSupportedError') {
          errorMessage = '이 브라우저에서는 화면 녹화를 지원하지 않습니다.';
        } else if (error.name === 'NotFoundError') {
          errorMessage = '화면 공유 소스 또는 마이크를 찾을 수 없습니다.';
        }
      }
      
      alert(errorMessage);
      
      // 실패 시 상태 리셋
      setIsRecording(false);
      setRecorder(null);
      setRecordingTime(0);
    }
  };

  const stopRecording = () => {
    if (!recorder) {
      console.log('No recorder to stop');
      return;
    }
    
    console.log('Stopping recording...');
    
    // 먼저 상태를 변경
    setIsRecording(false);
    
    try {
      recorder.stopRecording(() => {
        console.log('Recording stopped successfully');
        
        try {
          const blob = recorder.getBlob();
          console.log('Blob size:', blob ? blob.size : 'null');
          
          if (blob && blob.size > 0) {
            setRecordedBlob(blob);
            
            // 파일명 생성
            const timestamp = new Date();
            const fileName = `pdf-feedback-${timestamp.toISOString().slice(0, 19).replace(/:/g, '-')}.webm`;
            
            // 녹화된 파일 목록에 추가
            setRecordedFiles(prev => [...prev, {
              name: fileName,
              blob: blob,
              timestamp: timestamp
            }]);
            
            // 녹화 파일 자동 다운로드
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            console.log('녹화가 완료되었습니다. 파일:', fileName);
          } else {
            console.error('Recording blob is empty or null');
            alert('녹화된 데이터가 없습니다. 녹화 시간이 너무 짧거나 오류가 발생했을 수 있습니다.');
          }
        } catch (blobError) {
          console.error('Error processing blob:', blobError);
          alert('녹화 파일 처리 중 오류가 발생했습니다.');
        }
        
        // 콜백 완료 후 recorder 정리
        cleanupRecorder();
      });
      
      // 타임아웃을 설정하여 콜백이 실행되지 않을 경우 대비
      setTimeout(() => {
        if (recorder) {
          try {
            console.log('Timeout fallback: Checking for blob...');
            const blob = recorder.getBlob();
            
            if (blob && blob.size > 0) {
              console.log('Timeout fallback: Processing blob, size:', blob.size);
              setRecordedBlob(blob);
              
              const timestamp = new Date();
              const fileName = `pdf-feedback-${timestamp.toISOString().slice(0, 19).replace(/:/g, '-')}.webm`;
              
              setRecordedFiles(prev => [...prev, {
                name: fileName,
                blob: blob,
                timestamp: timestamp
              }]);
              
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = fileName;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
              
              console.log('녹화가 완료되었습니다 (타임아웃 처리). 파일:', fileName);
            } else {
              console.log('Timeout fallback: No valid blob available');
            }
          } catch (timeoutError) {
            console.error('Timeout fallback error:', timeoutError);
          }
          
          // 타임아웃에서도 정리
          cleanupRecorder();
        }
      }, 3000); // 3초 타임아웃
      
    } catch (error) {
      console.error('Recording stop error:', error);
      
      // 에러가 발생해도 기본적인 정리 작업은 수행
      try {
        const blob = recorder.getBlob();
        if (blob && blob.size > 0) {
          setRecordedBlob(blob);
          console.log('Emergency blob save completed, size:', blob.size);
        } else {
          console.log('Emergency: No valid blob available');
        }
      } catch (blobError) {
        console.error('Emergency blob save failed:', blobError);
      }
      
      cleanupRecorder();
    }
  };

  // Recorder 정리 함수 - 기존 인스턴스 완전 분리용
  const cleanupOldRecorder = async (oldRecorder: RecorderType) => {
    if (!oldRecorder) {
      console.log('No old recorder to cleanup');
      return;
    }
    
    console.log('Cleaning up old recorder instance...');
    
    try {
      // 1. 스트림 트랙 먼저 정지
      if (oldRecorder.getInternalRecorder && typeof oldRecorder.getInternalRecorder === 'function') {
        try {
          const internalRecorder = oldRecorder.getInternalRecorder();
          if (internalRecorder && internalRecorder.stream) {
            console.log('Stopping old recorder tracks...');
            internalRecorder.stream.getTracks().forEach((track: MediaStreamTrack) => {
              try {
                track.stop();
                console.log('Old track stopped:', track.kind);
              } catch (trackError) {
                console.error('Error stopping old track:', trackError);
              }
            });
          }
        } catch (internalError) {
          console.error('Error accessing old internal recorder:', internalError);
        }
      }
      
      // 2. RecordRTC 객체 완전 파괴
      if (oldRecorder.destroy && typeof oldRecorder.destroy === 'function') {
        try {
          // 내부 상태 확인 후 destroy 호출
          const recorderInternal = (oldRecorder as any).recorder;
          if (recorderInternal) {
            // reset 함수가 존재하고 null이 아닌 경우에만 destroy 호출
            if (recorderInternal.reset && typeof recorderInternal.reset === 'function') {
              oldRecorder.destroy();
              console.log('Old recorder destroyed successfully');
            } else {
              console.log('Old recorder reset is null, manual cleanup');
              // 수동으로 내부 상태 정리
              if (recorderInternal.stream) {
                recorderInternal.stream.getTracks().forEach((track: MediaStreamTrack) => {
                  try {
                    track.stop();
                  } catch (e) {
                    console.error('Error in manual cleanup:', e);
                  }
                });
              }
            }
          }
        } catch (destroyError) {
          console.error('Error destroying old recorder:', destroyError);
        }
      }
      
      // 3. 메모리 정리를 위한 약간의 대기
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.error('Old recorder cleanup failed:', error);
    }
    
    console.log('Old recorder cleanup completed');
  };

  // Recorder 정리 함수 - 현재 인스턴스용 (간소화)
  const cleanupRecorder = () => {
    console.log('Cleaning up current recorder...');
    
    // 현재 recorder 상태만 정리
    const currentRecorder = recorder;
    setRecorder(null);
    setRecordingTime(0);
    
    if (currentRecorder) {
      // 비동기적으로 정리 (UI 블로킹 방지)
      setTimeout(() => cleanupOldRecorder(currentRecorder), 0);
    }
    
    console.log('Current recorder state cleared');
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  // 파일 다운로드 함수
  const downloadFile = (file: {name: string, blob: Blob}) => {
    const url = URL.createObjectURL(file.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 파일 삭제 함수
  const deleteFile = (index: number) => {
    setRecordedFiles(prev => prev.filter((_, i) => i !== index));
  };

  // 컴포넌트 언마운트 시 정리
  useEffect(() => {
    return () => {
      console.log('Component unmounting...');
      
      // 타이머 정리
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
      
      if (streamingIntervalRef.current) {
        clearInterval(streamingIntervalRef.current);
        streamingIntervalRef.current = null;
      }
      
      // recorder가 있으면 정리
      if (recorder) {
        console.log('Component unmounting, cleaning up recorder...');
        try {
          // 녹화 중이면 중지 시도 (하지만 콜백은 기다리지 않음)
          if (isRecording) {
            try {
              recorder.stopRecording(() => {
                console.log('Recording stopped during cleanup');
              });
            } catch (stopError) {
              console.error('Error stopping recording during cleanup:', stopError);
            }
          }
          
          // 정리 함수 호출
          cleanupRecorder();
        } catch (error) {
          console.error('Cleanup during unmount failed:', error);
          // 강제로 상태만 초기화
          setRecorder(null);
          setRecordingTime(0);
        }
      }
      
      // 스트리밍이 있으면 정리
      if (localStreamRef.current) {
        console.log('Component unmounting, stopping streaming...');
        localStreamRef.current.getTracks().forEach(track => {
          try {
            track.stop();
          } catch (error) {
            console.error('Error stopping stream track:', error);
          }
        });
        localStreamRef.current = null;
        setLocalStream(null);
        setIsStreaming(false);
      }
      
      // Socket 연결 정리
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      
      // Peer connection 정리
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      
      // 스트림 준비 상태와 대기 큐 초기화
      isStreamReadyRef.current = false;
      pendingViewersRef.current = [];
    };
  }, []); // 의존성 배열을 비워서 컴포넌트 마운트 시에만 등록

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

        <div className="flex items-center space-x-2">
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

          {/* 실시간 스트리밍 버튼 */}
          <button
            onClick={toggleStreaming}
            disabled={!pdfLoaded}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg ${
              isStreaming
                ? 'bg-purple-600 text-white hover:bg-purple-700'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            } disabled:bg-gray-400 disabled:cursor-not-allowed`}
          >
            {isStreaming ? <Square size={16} /> : <Share size={16} />}
            <span>{isStreaming ? '스트리밍 중지' : '실시간 공유'}</span>
            {isStreaming && (
              <span className="bg-purple-800 px-2 py-1 rounded text-sm">
                {Math.floor(streamingTime / 60)}:{(streamingTime % 60).toString().padStart(2, '0')}
              </span>
            )}
          </button>

          {/* 스트리밍 URL 공유 버튼 */}
          {isStreaming && streamingUrl && (
            <button
              onClick={() => setShowStreamingModal(true)}
              className="flex items-center space-x-2 px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
            >
              <Users size={16} />
              <span>공유 링크</span>
            </button>
          )}

          {/* 녹화된 파일 목록 버튼 */}
          {recordedFiles.length > 0 && (
            <button
              onClick={() => setShowFileList(!showFileList)}
              className="flex items-center space-x-2 px-3 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
            >
              <span>파일 ({recordedFiles.length})</span>
            </button>
          )}
        </div>
      </div>
      
      {/* 스트리밍 URL 공유 모달 */}
      {showStreamingModal && streamingUrl && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-lg w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold flex items-center space-x-2">
                <Share className="text-purple-600" size={20} />
                <span>실시간 스트리밍 공유</span>
              </h3>
              <button
                onClick={() => setShowStreamingModal(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            
            <div className="space-y-4">
              {/* 연결 상태 */}
              <div className="flex items-center space-x-2">
                <div className={`w-3 h-3 rounded-full ${
                  connectionStatus === 'connected' ? 'bg-green-500' : 
                  connectionStatus === 'connecting' ? 'bg-yellow-500' : 
                  connectionStatus === 'failed' ? 'bg-red-500' : 'bg-gray-400'
                }`}></div>
                <span className="text-sm text-gray-600">
                  상태: {
                    connectionStatus === 'connected' ? '연결됨' :
                    connectionStatus === 'connecting' ? '연결 중...' :
                    connectionStatus === 'failed' ? '연결 실패' : '연결되지 않음'
                  }
                </span>
              </div>

              {/* 스트리밍 시간 */}
              <div className="text-sm text-gray-600">
                스트리밍 시간: {Math.floor(streamingTime / 60)}:{(streamingTime % 60).toString().padStart(2, '0')}
                <span className="ml-4">뷰어: {viewerCount}명</span>
              </div>

              {/* URL 공유 섹션 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  공유 링크 (다른 사용자가 이 링크로 실시간 화면을 볼 수 있습니다)
                </label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={streamingUrl}
                    readOnly
                    className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm bg-gray-50"
                  />
                  <button
                    onClick={copyStreamingUrl}
                    className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center space-x-1"
                  >
                    <Copy size={14} />
                    <span>복사</span>
                  </button>
                </div>
              </div>

              {/* 안내 메시지 */}
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <h4 className="font-medium text-purple-800 mb-2">📡 실시간 스트리밍 안내</h4>
                <div className="text-sm text-purple-700 space-y-1">
                  <p>• 다른 사용자가 위 링크를 통해 실시간으로 화면을 볼 수 있습니다</p>
                  <p>• 화면 공유와 마이크 음성이 모두 전달됩니다</p>
                  <p>• 스트리밍을 중지하면 링크가 비활성화됩니다</p>
                  <p>• WebRTC 기반으로 지연 시간이 매우 낮습니다</p>
                </div>
              </div>

              {/* 기술적 정보 */}
              <div className="bg-gray-50 rounded-lg p-3">
                <h4 className="font-medium text-gray-800 mb-2">🔧 기술 정보</h4>
                <div className="text-xs text-gray-600 space-y-1">
                  <p>• 프로토콜: WebRTC (P2P 연결)</p>
                  <p>• 화질: 최대 1920x1080 @ 30fps</p>
                  <p>• 오디오: 화면 오디오 + 마이크 (44.1kHz, 스테레오)</p>
                  <p>• 지연시간: 약 100-500ms</p>
                </div>
              </div>

              {/* 액션 버튼들 */}
              <div className="flex space-x-2 pt-2">
                <button
                  onClick={() => window.open(streamingUrl, '_blank')}
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 flex items-center justify-center space-x-2"
                >
                  <ExternalLink size={16} />
                  <span>새 창에서 보기</span>
                </button>
                <button
                  onClick={stopStreaming}
                  className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                >
                  스트리밍 중지
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 녹화된 파일 목록 모달 */}
      {showFileList && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">녹화된 파일 목록</h3>
              <button
                onClick={() => setShowFileList(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            
            {recordedFiles.length === 0 ? (
              <p className="text-gray-500 text-center py-8">녹화된 파일이 없습니다.</p>
            ) : (
              <div className="space-y-3">
                {recordedFiles.map((file, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex-1">
                      <div className="font-medium text-sm">{file.name}</div>
                      <div className="text-xs text-gray-500 mt-1">
                        {file.timestamp.toLocaleString('ko-KR')}
                        <span className="ml-2">
                          크기: {(file.blob.size / 1024 / 1024).toFixed(1)} MB
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => downloadFile(file)}
                        className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                      >
                        다운로드
                      </button>
                      <button
                        onClick={() => deleteFile(index)}
                        className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700"
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            <div className="mt-6 p-4 bg-blue-50 rounded-lg">
              <h4 className="font-medium text-blue-800 mb-2">💡 파일 위치 안내</h4>
              <div className="text-sm text-blue-700 space-y-1">
                <p>• 녹화 완료 시 자동으로 다운로드 폴더에 저장됩니다</p>
                <p>• 기본 위치: <code className="bg-blue-100 px-1 rounded">C:\Users\[사용자명]\Downloads\</code></p>
                <p>• 파일명 형식: <code className="bg-blue-100 px-1 rounded">pdf-feedback-YYYY-MM-DD-HH-mm-ss.webm</code></p>
                <p>• 브라우저 설정에서 다운로드 폴더를 변경할 수 있습니다</p>
              </div>
            </div>
          </div>
        </div>
      )}

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
                        className="px-2 py-1 border border-gray-300 rounded text-sm text-black"
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
              
              {/* 스트리밍 상태 표시 */}
              {isStreaming && (
                <div className="flex items-center space-x-2 px-3 py-2 bg-purple-100 text-purple-600 rounded-lg text-sm">
                  <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse"></div>
                  <span>실시간 공유 중 ({Math.floor(streamingTime / 60)}:{(streamingTime % 60).toString().padStart(2, '0')})</span>
                </div>
              )}
              
              {/* 녹화된 파일이 있을 때 안내 */}
              {recordedBlob && !isRecording && !isStreaming && (
                <div className="flex items-center space-x-2 px-3 py-2 bg-green-100 text-green-600 rounded-lg text-sm cursor-pointer"
                     onClick={() => setShowFileList(true)}>
                  <span>✓ 녹화 완료 - 다운로드 폴더에 저장됨 (클릭하여 파일 목록 보기)</span>
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
