import SimplePeer from 'simple-peer';
import { WebRTCPeer } from '../types';

export class WebRTCManager {
  private peer: SimplePeer.Instance | null = null;
  private localStream: MediaStream | null = null;
  private remoteStreams: Map<string, MediaStream> = new Map();
  private onDataCallback?: (data: any) => void;
  private onStreamCallback?: (stream: MediaStream, peerId: string) => void;

  constructor() {
    this.setupLocalStream();
  }

  private async setupLocalStream(): Promise<void> {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
    } catch (error) {
      console.error('Error accessing media devices:', error);
    }
  }

  createPeer(isInitiator: boolean = false): SimplePeer.Instance {
    if (this.peer) {
      this.peer.destroy();
    }

    this.peer = new SimplePeer({
      initiator: isInitiator,
      trickle: false,
      stream: this.localStream || undefined,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      }
    });

    this.peer.on('signal', (data: any) => {
      console.log('WebRTC signal:', data);
      // 시그널링 서버로 전송해야 함
    });

    this.peer.on('connect', () => {
      console.log('WebRTC connection established');
    });

    this.peer.on('data', (data: any) => {
      const parsedData = JSON.parse(data.toString());
      if (this.onDataCallback) {
        this.onDataCallback(parsedData);
      }
    });

    this.peer.on('stream', (stream: MediaStream) => {
      console.log('Received remote stream');
      if (this.onStreamCallback) {
        this.onStreamCallback(stream, 'remote');
      }
    });

    this.peer.on('error', (error: any) => {
      console.error('WebRTC error:', error);
    });

    this.peer.on('close', () => {
      console.log('WebRTC connection closed');
    });

    return this.peer;
  }

  sendData(data: any): void {
    if (this.peer && this.peer.connected) {
      this.peer.send(JSON.stringify(data));
    }
  }

  processSignal(signal: any): void {
    if (this.peer) {
      this.peer.signal(signal);
    }
  }

  onData(callback: (data: any) => void): void {
    this.onDataCallback = callback;
  }

  onStream(callback: (stream: MediaStream, peerId: string) => void): void {
    this.onStreamCallback = callback;
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  destroy(): void {
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
  }
}

export const createRoom = (): string => {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

export const shareScreen = async (): Promise<MediaStream | null> => {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        // cursor와 displaySurface는 타입 에러를 방지하기 위해 제거
      } as MediaTrackConstraints,
      audio: true
    });
    return stream;
  } catch (error) {
    console.error('Error sharing screen:', error);
    return null;
  }
};
