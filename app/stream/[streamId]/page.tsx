'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { Volume2, VolumeX, Maximize, Minimize, Users, Clock, Signal } from 'lucide-react';

const StreamViewer: React.FC = () => {
  const params = useParams();
  const streamId = params.streamId as string;
  const videoRef = useRef<HTMLVideoElement>(null);
  const socketRef = useRef<any>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [connectionTime, setConnectionTime] = useState(0);
  const [viewerCount, setViewerCount] = useState(1);
  const [streamInfo, setStreamInfo] = useState<{width: number, height: number, hasVideo: boolean, hasAudio: boolean} | null>(null);
  
  const connectionTimeRef = useRef<NodeJS.Timeout | null>(null);
  
  // WebRTC 설정
  const rtcConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' }
    ]
  };

  // 연결 시간 타이머
  useEffect(() => {
    if (isConnected && !connectionTimeRef.current) {
      connectionTimeRef.current = setInterval(() => {
        setConnectionTime(prev => prev + 1);
      }, 1000);
    } else if (!isConnected && connectionTimeRef.current) {
      clearInterval(connectionTimeRef.current);
      connectionTimeRef.current = null;
    }

    return () => {
      if (connectionTimeRef.current) {
        clearInterval(connectionTimeRef.current);
        connectionTimeRef.current = null;
      }
    };
  }, [isConnected]);

  useEffect(() => {
    const connectToSignalingServer = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        // 스트림 ID 유효성 검사
        if (!streamId || streamId.length < 10) {
          throw new Error('유효하지 않은 스트림 ID입니다.');
        }
        
        console.log('시그널링 서버에 연결 중...', streamId);
        
        // Socket.IO 동적 임포트
        const io = await import('socket.io-client');
        const socket = io.default('http://192.168.0.152:3001', {
          transports: ['websocket', 'polling']
        });
        
        socketRef.current = socket;
        
        socket.on('connect', () => {
          console.log('시그널링 서버에 연결되었습니다');
          // 스트림에 참여
          socket.emit('join-stream', { streamId });
        });
        
        socket.on('stream-available', async (data) => {
          console.log('스트림 사용 가능:', data);
          await setupPeerConnection(data.hostSocketId);
        });
        
        socket.on('stream-not-found', () => {
          setError('스트림을 찾을 수 없습니다. 스트리머가 아직 시작하지 않았거나 이미 종료되었을 수 있습니다.');
          setIsLoading(false);
        });
        
        socket.on('offer', async (data) => {
          console.log('Offer 수신:', data);
          await handleOffer(data);
        });
        
        socket.on('answer', async (data) => {
          console.log('Answer 수신:', data);
          await handleAnswer(data);
        });
        
        socket.on('ice-candidate', async (data) => {
          console.log('ICE candidate 수신:', data);
          await handleIceCandidate(data);
        });
        
        socket.on('stream-ended', () => {
          console.log('스트림이 종료되었습니다');
          setError('스트림이 종료되었습니다.');
          setIsConnected(false);
          setIsLoading(false);
        });
        
        socket.on('disconnect', () => {
          console.log('시그널링 서버 연결 해제');
          if (!error) {
            setError('시그널링 서버와의 연결이 끊어졌습니다.');
          }
          setIsConnected(false);
        });
        
      } catch (err) {
        console.error('시그널링 서버 연결 실패:', err);
        setError(err instanceof Error ? err.message : '스트림 연결에 실패했습니다.');
        setIsLoading(false);
      }
    };
    
    const setupPeerConnection = async (hostSocketId: string) => {
      try {
        console.log('뷰어: Peer connection 설정 중...', hostSocketId);
        
        const peerConnection = new RTCPeerConnection(rtcConfiguration);
        peerConnectionRef.current = peerConnection;
        
        // 원격 스트림 수신
        peerConnection.ontrack = (event) => {
          console.log('뷰어: 원격 스트림 수신:', event);
          if (videoRef.current && event.streams[0]) {
            console.log('뷰어: 비디오 엘리먼트에 스트림 설정');
            const stream = event.streams[0];
            console.log('뷰어: 스트림 트랙 정보:', stream.getTracks().map(t => `${t.kind}: ${t.id}`));
            videoRef.current.srcObject = stream;
            
            // 스트림이 설정된 후 재생 시도
            videoRef.current.play().catch(error => {
              console.log('비디오 자동 재생 실패, 사용자 상호작용 필요:', error);
            });
            
            // 스트림 정보 업데이트
            const videoTracks = stream.getVideoTracks();
            const audioTracks = stream.getAudioTracks();
            setStreamInfo({
              width: videoRef.current.videoWidth,
              height: videoRef.current.videoHeight,
              hasVideo: videoTracks.length > 0,
              hasAudio: audioTracks.length > 0
            });
            
            // 비디오 트랙 상태 확인
            if (videoTracks.length > 0) {
              console.log('뷰어: 비디오 트랙 상태:', {
                enabled: videoTracks[0].enabled,
                readyState: videoTracks[0].readyState,
                settings: videoTracks[0].getSettings?.()
              });
            }
            
            setIsConnected(true);
            setIsLoading(false);
          }
        };
        
        // ICE candidate 이벤트
        peerConnection.onicecandidate = (event) => {
          if (event.candidate && socketRef.current) {
            console.log('뷰어: ICE candidate 전송:', event.candidate);
            socketRef.current.emit('ice-candidate', {
              candidate: event.candidate,
              targetSocketId: hostSocketId,
              streamId
            });
          }
        };
        
        // 연결 상태 변경
        peerConnection.onconnectionstatechange = () => {
          console.log('뷰어: Connection state:', peerConnection.connectionState);
          if (peerConnection.connectionState === 'connected') {
            console.log('뷰어: WebRTC 연결 성공!');
            setIsConnected(true);
            setIsLoading(false);
            
            // 연결 후 비디오 상태 확인
            if (videoRef.current) {
              console.log('뷰어: 비디오 엘리먼트 상태:', {
                srcObject: !!videoRef.current.srcObject,
                videoWidth: videoRef.current.videoWidth,
                videoHeight: videoRef.current.videoHeight,
                readyState: videoRef.current.readyState,
                paused: videoRef.current.paused
              });
            }
          } else if (peerConnection.connectionState === 'failed' || 
                    peerConnection.connectionState === 'disconnected') {
            console.log('뷰어: WebRTC 연결 실패/해제');
            setError('WebRTC 연결에 실패했습니다.');
            setIsConnected(false);
          }
        };
        
        console.log('뷰어: Peer connection 설정 완료, offer 대기 중...');
        
      } catch (error) {
        console.error('뷰어: Peer connection 설정 실패:', error);
        setError('WebRTC 연결 설정에 실패했습니다.');
        setIsLoading(false);
      }
    };
    
    const handleOffer = async (data: any) => {
      console.log('뷰어: Offer 수신, 처리 중...', data);
      if (peerConnectionRef.current && socketRef.current) {
        try {
          console.log('뷰어: Remote description 설정 중...');
          await peerConnectionRef.current.setRemoteDescription(data.offer);
          
          console.log('뷰어: Answer 생성 중...');
          const answer = await peerConnectionRef.current.createAnswer();
          await peerConnectionRef.current.setLocalDescription(answer);
          
          console.log('뷰어: Answer 전송 중...', answer);
          socketRef.current.emit('answer', {
            answer,
            targetSocketId: data.fromSocketId,
            streamId
          });
          
          console.log('뷰어: Answer 전송 완료');
        } catch (error) {
          console.error('뷰어: Offer 처리 실패:', error);
          setError('Offer 처리 중 오류가 발생했습니다.');
        }
      } else {
        console.error('뷰어: PeerConnection 또는 Socket이 없습니다');
      }
    };
    
    const handleAnswer = async (data: any) => {
      if (peerConnectionRef.current) {
        try {
          await peerConnectionRef.current.setRemoteDescription(data.answer);
          console.log('Answer 처리 완료');
        } catch (error) {
          console.error('Answer 처리 실패:', error);
        }
      }
    };
    
    const handleIceCandidate = async (data: any) => {
      console.log('뷰어: ICE candidate 수신:', data);
      if (peerConnectionRef.current) {
        try {
          await peerConnectionRef.current.addIceCandidate(data.candidate);
          console.log('뷰어: ICE candidate 추가 완료');
        } catch (error) {
          console.error('뷰어: ICE candidate 추가 실패:', error);
        }
      } else {
        console.error('뷰어: PeerConnection이 없습니다');
      }
    };
    
    connectToSignalingServer();
    
    return () => {
      // 컴포넌트 언마운트 시 연결 정리
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      
      setIsConnected(false);
      if (connectionTimeRef.current) {
        clearInterval(connectionTimeRef.current);
      }
    };
  }, [streamId]);

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
      setIsMuted(videoRef.current.muted);
    }
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  // 전체화면 상태 변경 감지
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center text-white">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <h2 className="text-xl font-semibold mb-2">스트림에 연결 중...</h2>
          <p className="text-gray-300">Stream ID: {streamId}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center text-white max-w-md">
          <div className="text-red-400 text-6xl mb-4">⚠️</div>
          <h2 className="text-xl font-semibold mb-2">연결 실패</h2>
          <p className="text-gray-300 mb-4">{error}</p>
          <div className="bg-gray-800 rounded-lg p-4 text-left">
            <h3 className="font-medium mb-2">가능한 원인:</h3>
            <ul className="text-sm space-y-1 text-gray-400">
              <li>• 스트림이 종료되었거나 아직 시작되지 않았습니다</li>
              <li>• 잘못된 스트림 링크입니다</li>
              <li>• 네트워크 연결에 문제가 있습니다</li>
              <li>• 호스트가 스트리밍을 중지했습니다</li>
            </ul>
          </div>
          <button 
            onClick={() => window.location.reload()} 
            className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            다시 시도
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900">
      {/* 헤더 */}
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <h1 className="text-white font-semibold">PDF Feedback - 실시간 스트림</h1>
            <div className="flex items-center space-x-2 text-green-400">
              <Signal size={16} className="animate-pulse" />
              <span className="text-sm">LIVE</span>
            </div>
          </div>
          
          <div className="flex items-center space-x-4 text-gray-300">
            <div className="flex items-center space-x-1">
              <Users size={16} />
              <span className="text-sm">{viewerCount}</span>
            </div>
            <div className="flex items-center space-x-1">
              <Clock size={16} />
              <span className="text-sm">{formatTime(connectionTime)}</span>
            </div>
            {streamInfo && (
              <div className="text-xs text-gray-400">
                {streamInfo.hasVideo ? '📹' : '❌'} {streamInfo.hasAudio ? '🔊' : '🔇'}
                {streamInfo.width > 0 && ` ${streamInfo.width}x${streamInfo.height}`}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 메인 비디오 영역 */}
      <div className="relative flex-1">
        {isConnected ? (
          <div className="relative w-full h-[calc(100vh-64px)] bg-black flex items-center justify-center">
            {/* 실제 스트림 비디오 */}
            <video
              ref={videoRef}
              className="w-full h-full object-contain"
              autoPlay
              playsInline
              muted={isMuted}
              controls={false}
              onLoadStart={() => console.log('비디오 로드 시작')}
              onLoadedData={() => console.log('비디오 데이터 로드됨')}
              onCanPlay={() => console.log('비디오 재생 가능')}
              onPlay={() => console.log('비디오 재생 시작')}
              onError={(e) => console.error('비디오 에러:', e)}
            />
            
            {/* 비디오 컨트롤 오버레이 */}
            <div className="absolute bottom-4 left-4 right-4 bg-black bg-opacity-50 rounded-lg px-4 py-2 flex items-center justify-between">
              <div className="flex items-center space-x-2 text-white">
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                <span className="text-sm">실시간 중계</span>
              </div>
              
              <div className="flex items-center space-x-2">
                <button
                  onClick={toggleMute}
                  className="p-2 text-white hover:bg-white hover:bg-opacity-20 rounded"
                  title={isMuted ? '음소거 해제' : '음소거'}
                >
                  {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
                </button>
                
                <button
                  onClick={toggleFullscreen}
                  className="p-2 text-white hover:bg-white hover:bg-opacity-20 rounded"
                  title={isFullscreen ? '전체화면 해제' : '전체화면'}
                >
                  {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="w-full h-[calc(100vh-64px)] bg-gray-800 flex items-center justify-center">
            <div className="text-center text-gray-400">
              <div className="text-4xl mb-4">📱</div>
              <p className="mb-2">스트림이 아직 시작되지 않았습니다</p>
              {streamInfo && (
                <div className="text-sm text-gray-500 mt-2">
                  연결됨 - 비디오: {streamInfo.hasVideo ? '있음' : '없음'}, 오디오: {streamInfo.hasAudio ? '있음' : '없음'}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default StreamViewer;
