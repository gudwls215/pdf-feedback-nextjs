'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { Volume2, VolumeX, Maximize, Minimize, Users, Clock, Signal, MessageCircle, X, Send } from 'lucide-react';

const StreamViewer: React.FC = () => {
  const params = useParams();
  const streamId = params.streamId as string;
  const videoRef = useRef<HTMLVideoElement>(null);
  const socketRef = useRef<any>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);

  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [connectionTime, setConnectionTime] = useState(0);
  const [viewerCount, setViewerCount] = useState(1);
  const [streamInfo, setStreamInfo] = useState<{ width: number, height: number, hasVideo: boolean, hasAudio: boolean } | null>(null);
  const [chatMessages, setChatMessages] = useState<{ id: string, sender: string, message: string, timestamp: Date, isStreamer: boolean }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [showChat, setShowChat] = useState(false);
  const [viewerName, setViewerName] = useState('');

  const connectionTimeRef = useRef<NodeJS.Timeout | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // WebRTC 설정 - TURN 서버 (자체 coturn + 공용 TURN 폴백)
  const turnUrl = process.env.NEXT_PUBLIC_TURN_SERVER_URL || '';
  const turnUser = process.env.NEXT_PUBLIC_TURN_USERNAME || '';
  const turnCred = process.env.NEXT_PUBLIC_TURN_CREDENTIAL || '';

  const rtcConfiguration: RTCConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      // 자체 TURN 서버 (UDP + TCP)
      ...(turnUrl ? [
        { urls: turnUrl, username: turnUser, credential: turnCred },
        { urls: turnUrl.replace(':3478', ':3478?transport=tcp'), username: turnUser, credential: turnCred },
      ] : []),
      // 공용 TURN 서버 폴백 (자체 TURN 서버 연결 실패 시 사용)
      {
        urls: [
          'turn:openrelay.metered.ca:80',
          'turn:openrelay.metered.ca:80?transport=tcp',
          'turn:openrelay.metered.ca:443',
          'turn:openrelay.metered.ca:443?transport=tcp',
        ],
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
    ],
    bundlePolicy: 'max-bundle' as RTCBundlePolicy,
    rtcpMuxPolicy: 'require' as RTCRtcpMuxPolicy,
    iceTransportPolicy: 'all' as RTCIceTransportPolicy,
    iceCandidatePoolSize: 1,
  };

  console.log('ICE 설정:', {
    turnUrl: turnUrl || '(없음)',
    hasTurn: !!turnUrl,
    totalIceServers: rtcConfiguration.iceServers?.length,
    servers: rtcConfiguration.iceServers?.map(s => typeof s.urls === 'string' ? s.urls : s.urls?.[0]),
  });

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

  // 뷰어 이름 설정
  useEffect(() => {
    const savedName = localStorage.getItem('viewerName');
    if (savedName) {
      setViewerName(savedName);
    } else {
      const randomName = `뷰어${Math.floor(Math.random() * 1000)}`;
      setViewerName(randomName);
      localStorage.setItem('viewerName', randomName);
    }
  }, []);


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
        const signalingServerUrl = process.env.NEXT_PUBLIC_SIGNALING_SERVER_URL || '/api/signaling';
        const socket = io.default(signalingServerUrl, {
          transports: ['websocket', 'polling']
        });

        socketRef.current = socket;

        socket.on('connect', () => {
          console.log('🟢 뷰어: 시그널링 서버에 연결되었습니다');
          // 스트림에 참여
          console.log('🟢 뷰어: 스트림 참여 요청:', { streamId });
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

        socket.on('chat-message', (data) => {
          console.log('🟢 뷰어: 채팅 메시지 수신:', {
            senderName: data.senderName,
            message: data.message,
            isStreamer: data.isStreamer
          });
          
          const newMessage = {
            id: Date.now().toString() + Math.random().toString(36).substr(2),
            sender: data.senderName || '스트리머',
            message: data.message,
            timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
            isStreamer: data.isStreamer || false
          };
          
          console.log('🟢 뷰어: 새 메시지 추가:', newMessage);
          setChatMessages(prev => {
            console.log('🟢 뷰어: 이전 메시지 개수:', prev.length);
            const updated = [...prev, newMessage];
            console.log('🟢 뷰어: 업데이트된 메시지 개수:', updated.length);
            return updated;
          });

          // 채팅창이 열려있으면 맨 아래로 스크롤
          if (showChat) {
            setTimeout(() => {
              if (chatEndRef.current) {
                console.log('🟢 뷰어: 채팅창 스크롤 이동');
                chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
              }
            }, 100);
          }
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
          console.log('뷰어: 원격 스트림 수신 (ontrack 이벤트 발생):', event);

          // streams[0]이 있고 videoRef가 있으면 스트림 할당
          if (event.streams && event.streams[0]) {
            const stream = event.streams[0];
            if (videoRef.current) {
              videoRef.current.srcObject = stream;
              videoRef.current.play().catch(() => { });
              setStreamInfo({
                width: videoRef.current.videoWidth,
                height: videoRef.current.videoHeight,
                hasVideo: stream.getVideoTracks().length > 0,
                hasAudio: stream.getAudioTracks().length > 0
              });
            } else {
              // videoRef가 아직 마운트되지 않은 경우, 100ms 후 재시도
              setTimeout(() => {
                if (videoRef.current) {
                  videoRef.current.srcObject = stream;
                  videoRef.current.play().catch(() => { });
                }
              }, 100);
            }
          } else {
            console.warn('뷰어: ontrack 이벤트가 발생했으나, 스트림이 없습니다.', event);
          }

        };

        // ICE candidate 이벤트 - 상세 로깅 포함
        const candidateStats = { host: 0, srflx: 0, relay: 0, prflx: 0 };
        peerConnection.onicecandidate = (event) => {
          if (event.candidate && socketRef.current) {
            const c = event.candidate;
            const cType = c.type || 'unknown';
            if (cType in candidateStats) candidateStats[cType as keyof typeof candidateStats]++;
            console.log(`뷰어: ICE candidate [${cType}] ${c.protocol} ${c.address}:${c.port} relay=${c.relatedAddress || 'N/A'}`);
            socketRef.current.emit('ice-candidate', {
              candidate: event.candidate,
              targetSocketId: hostSocketId,
              streamId
            });
          } else if (!event.candidate) {
            // ICE gathering 완료
            console.log('뷰어: ICE gathering 완료. 후보 통계:', JSON.stringify(candidateStats));
            if (candidateStats.relay === 0) {
              console.warn('⚠️ 뷰어: relay(TURN) 후보가 0개입니다! TURN 서버에 접근할 수 없습니다. NAT 환경에서 연결 실패 가능성 높음.');
            }
          }
        };

        // 연결 상태 변경
        peerConnection.onconnectionstatechange = () => {
          const connectionState = peerConnection.connectionState;
          console.log('뷰어: Connection state 변경:', connectionState);

          switch (connectionState) {
            case 'connecting':
              setIsLoading(true);
              break;
            case 'connected':
              console.log('뷰어: WebRTC 연결 성공!');
              setIsConnected(true);
              setIsLoading(false);
              setError(null);

              // 연결 후 비디오 상태 확인 (약간의 지연 후)
              setTimeout(() => {
                if (videoRef.current) {
                  console.log('뷰어: 비디오 엘리먼트 상태 (연결 직후):', {
                    srcObject: !!videoRef.current.srcObject,
                    videoWidth: videoRef.current.videoWidth,
                    videoHeight: videoRef.current.videoHeight,
                    readyState: videoRef.current.readyState,
                    paused: videoRef.current.paused,
                    muted: videoRef.current.muted,
                  });
                  // videoWidth가 0이면 스트림은 연결되었지만 비디오 데이터가 오지 않는 상태
                  if (videoRef.current.videoWidth === 0) {
                    console.warn('경고: WebRTC는 연결되었으나 비디오 프레임이 수신되지 않고 있습니다. (검은 화면 원인)');
                  }
                }
              }, 1000);
              break;
            case 'disconnected':
              console.log('뷰어: WebRTC 연결 해제, 재연결 시도...');
              // disconnected는 일시적일 수 있으므로 바로 에러 표시하지 않음
              setTimeout(() => {
                if (peerConnection.connectionState === 'disconnected') {
                  if (!error) setError('WebRTC 연결이 해제되었습니다. 재연결을 시도합니다...');
                  setIsConnected(false);
                }
              }, 5000);
              break;
            case 'closed':
              console.log('뷰어: WebRTC 연결 종료');
              if (!error) setError('WebRTC 연결이 해제되었습니다.');
              setIsConnected(false);
              break;
            case 'failed':
              console.error('뷰어: WebRTC 연결 실패');
              setError('WebRTC 연결에 실패했습니다. 네트워크 상태를 확인하거나 다시 시도해주세요. (NAT/방화벽 환경에서 TURN 서버가 필요할 수 있습니다)');
              setIsConnected(false);
              setIsLoading(false);
              break;
          }
        };

        // ICE 연결 상태 모니터링 (더 세밀한 디버깅)
        peerConnection.oniceconnectionstatechange = () => {
          console.log('뷰어: ICE connection state:', peerConnection.iceConnectionState);
          if (peerConnection.iceConnectionState === 'failed') {
            console.error('뷰어: ICE 연결 실패 - TURN 서버가 필요할 수 있습니다');
            // ICE restart 시도
            if (peerConnectionRef.current === peerConnection) {
              console.log('뷰어: ICE restart 시도...');
              peerConnection.restartIce();
            }
          }
        };

        // ICE gathering 상태 모니터링
        peerConnection.onicegatheringstatechange = () => {
          console.log('뷰어: ICE gathering state:', peerConnection.iceGatheringState);
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

  // 채팅 메시지 전송
  const sendChatMessage = () => {
    if (!chatInput.trim() || !socketRef.current) {
      console.log('🟢 뷰어: 채팅 전송 실패 - 입력값 또는 소켓 없음:', {
        inputTrimmed: chatInput.trim(),
        hasSocket: !!socketRef.current
      });
      return;
    }

    console.log('🟢 뷰어: 채팅 메시지 전송 시작:', {
      message: chatInput,
      streamId: streamId,
      viewerName: viewerName
    });

    const message = {
      id: Date.now().toString() + Math.random().toString(36).substr(2),
      sender: viewerName,
      message: chatInput,
      timestamp: new Date(),
      isStreamer: false
    };

    // 로컬에 메시지 추가
    console.log('🟢 뷰어: 로컬 메시지 추가:', message);
    setChatMessages(prev => {
      const updated = [...prev, message];
      console.log('🟢 뷰어: 로컬 메시지 업데이트 완료, 총 개수:', updated.length);
      return updated;
    });

    // 소켓을 통해 스트리머에게 전송
    const socketData = {
      streamId,
      senderName: viewerName,
      message: chatInput,
      isStreamer: false
    };
    
    console.log('🟢 뷰어: 소켓으로 메시지 전송:', socketData);
    socketRef.current.emit('chat-message', socketData);

    setChatInput('');

    // 채팅창 맨 아래로 스크롤
    setTimeout(() => {
      if (chatEndRef.current) {
        console.log('🟢 뷰어: 채팅창 스크롤 이동');
        chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
      }
    }, 100);
  };

  // Enter 키로 메시지 전송
  const handleChatKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  };

  // 채팅창 열기/닫기
  const toggleChat = () => {
    setShowChat(prev => !prev);
    if (!showChat) {
      // 채팅창을 열면 맨 아래로 스크롤
      setTimeout(() => {
        if (chatEndRef.current) {
          chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
      }, 100);
    }
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
    <div className={`min-h-screen bg-gray-900 transition-all duration-300 ${showChat ? 'pr-80' : ''}`}>
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
              style={{
                imageRendering: 'crisp-edges', // 픽셀 선명도 향상
                filter: 'contrast(1.05) brightness(1.02)', // 약간의 대비/밝기 개선
              }}
              onLoadStart={() => console.log('비디오 로드 시작 (onLoadStart)')}
              onLoadedData={() => {
                console.log('비디오 데이터 로드됨 (onLoadedData)');
                // 비디오 로드 시 최고 품질로 설정
                if (videoRef.current) {
                  videoRef.current.style.imageRendering = 'auto';
                  videoRef.current.style.transform = 'translateZ(0)'; // GPU 가속
                }
              }}
              onCanPlay={() => console.log('비디오 재생 가능 (onCanPlay)')}
              onPlay={() => console.log('비디오 재생 시작 (onPlay)')}
              onPlaying={() => console.log('비디오 재생 중 (onPlaying)')}
              onError={(e) => console.error('비디오 에러:', e)}
            />

            {/* 비디오 컨트롤 오버레이 */}
            <div className="absolute bottom-4 left-4 right-4 bg-black bg-opacity-50 rounded-lg px-4 py-2 flex items-center justify-between opacity-80 hover:opacity-100 transition-opacity">
              <div className="flex items-center space-x-2 text-white">
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                <span className="text-sm">실시간 중계</span>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={toggleMute}
                  className="p-2 text-white hover:bg-white hover:bg-opacity-20 rounded-full"
                  title={isMuted ? '음소거 해제' : '음소거'}
                >
                  {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
                </button>

                <button
                  onClick={toggleFullscreen}
                  className="p-2 text-white hover:bg-white hover:bg-opacity-20 rounded-full"
                  title={isFullscreen ? '전체화면 해제' : '전체화면'}
                >
                  {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
                </button>

                <button
                  onClick={toggleChat}
                  className="p-2 text-white hover:bg-white hover:bg-opacity-20 rounded-full"
                  title="채팅"
                >
                  <MessageCircle size={20} />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="w-full h-[calc(100vh-64px)] bg-gray-800 flex items-center justify-center">
            <div className="text-center text-gray-400">
              <div className="text-4xl mb-4">📺</div>
              <p className="mb-2">스트림을 기다리는 중...</p>
              {streamInfo && (
                <div className="text-sm text-gray-500 mt-2">
                  연결됨 - 비디오: {streamInfo.hasVideo ? '있음' : '없음'}, 오디오: {streamInfo.hasAudio ? '있음' : '없음'}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 채팅 패널 */}
      {showChat && (
        <div className="fixed top-0 right-0 h-full w-80 bg-white shadow-xl border-l border-gray-200 z-40 flex flex-col">
          {/* 채팅 헤더 */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gradient-to-r from-green-500 to-green-600">
            <div className="flex items-center space-x-2">
              <MessageCircle className="text-white" size={20} />
              <h3 className="text-white font-semibold">실시간 채팅</h3>
              <span className="bg-white/20 text-white text-xs px-2 py-1 rounded-full">
                {viewerName}
              </span>
            </div>
            <button
              onClick={toggleChat}
              className="text-white/80 hover:text-white p-1 rounded-md hover:bg-white/10 transition-colors"
            >
              <X size={18} />
            </button>
          </div>
          
          {/* 채팅 메시지 영역 */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
            {/* 디버깅 정보 */}
            <div className="text-xs text-gray-400 text-center border-b pb-2">
              메시지 개수: {chatMessages.length} | 뷰어: {viewerName}
            </div>
            
            {chatMessages.length === 0 ? (
              <div className="text-center text-gray-500 mt-8">
                <MessageCircle className="mx-auto mb-2 text-gray-400" size={48} />
                <p>아직 채팅 메시지가 없습니다.</p>
                <p className="text-sm">스트리머와 소통해보세요!</p>
              </div>
            ) : (
              chatMessages.map((msg) => {
                return (
                  <div
                    key={msg.id}
                    className={`flex ${msg.isStreamer ? 'justify-start' : 'justify-end'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-3 py-2 ${
                        msg.isStreamer
                          ? 'bg-white text-gray-800 shadow-sm border rounded-bl-none'
                          : 'bg-green-500 text-white rounded-br-none'
                      }`}
                    >
                      <div className={`text-xs mb-1 ${msg.isStreamer ? 'text-gray-500' : 'text-green-100'}`}>
                        {msg.sender} • {msg.timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                      </div>
                      <div className="break-words">{msg.message}</div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={chatEndRef} />
          </div>
          
          {/* 채팅 입력 영역 */}
          <div className="border-t border-gray-200 p-4 bg-white">
            <div className="flex space-x-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyPress={handleChatKeyPress}
                placeholder="메시지를 입력하세요..."
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent text-gray-700"
                maxLength={500}
              />
              <button
                onClick={sendChatMessage}
                disabled={!chatInput.trim()}
                className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center"
              >
                <Send size={16} />
              </button>
            </div>
            <div className="text-xs text-gray-500 mt-1 text-center">
              {chatInput.length}/500
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StreamViewer;
