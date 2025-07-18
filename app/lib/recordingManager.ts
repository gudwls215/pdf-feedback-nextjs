import RecordRTC from 'recordrtc';
import { RecordingSession } from '../types';

export class RecordingManager {
  private recorder: RecordRTC | null = null;
  private stream: MediaStream | null = null;
  private isRecording: boolean = false;
  private recordedChunks: Blob[] = [];

  constructor() {}

  async startRecording(canvas: HTMLCanvasElement, audioStream?: MediaStream): Promise<void> {
    try {
      // 캔버스에서 미디어 스트림 생성
      const videoStream = (canvas as any).captureStream(30); // 30 FPS
      
      // 오디오 스트림이 있으면 합성
      if (audioStream) {
        const audioTracks = audioStream.getAudioTracks();
        audioTracks.forEach(track => videoStream.addTrack(track));
      }

      this.stream = videoStream;

      // RecordRTC 설정
      if (!this.stream) {
        throw new Error('No video stream available');
      }
      
      this.recorder = new RecordRTC(this.stream, {
        type: 'video',
        mimeType: 'video/webm;codecs=vp9',
        frameInterval: 90, // 더 나은 품질을 위해
        videoBitsPerSecond: 2000000, // 2Mbps
        canvas: {
          width: canvas.width,
          height: canvas.height
        }
      });

      this.recorder.startRecording();
      this.isRecording = true;
      
      console.log('Recording started');
    } catch (error) {
      console.error('Error starting recording:', error);
      throw error;
    }
  }

  stopRecording(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.recorder || !this.isRecording) {
        reject(new Error('No active recording'));
        return;
      }

      this.recorder.stopRecording(() => {
        const blob = this.recorder!.getBlob();
        this.isRecording = false;
        
        // 리소스 정리
        if (this.stream) {
          this.stream.getTracks().forEach(track => track.stop());
          this.stream = null;
        }
        
        resolve(blob);
      });
    });
  }

  pauseRecording(): void {
    if (this.recorder && this.isRecording) {
      this.recorder.pauseRecording();
    }
  }

  resumeRecording(): void {
    if (this.recorder && this.isRecording) {
      this.recorder.resumeRecording();
    }
  }

  getRecordingStatus(): boolean {
    return this.isRecording;
  }

  downloadRecording(blob: Blob, filename: string = 'feedback-recording.webm'): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async uploadRecording(blob: Blob, endpoint: string): Promise<Response> {
    const formData = new FormData();
    formData.append('recording', blob, 'feedback-recording.webm');
    
    return fetch(endpoint, {
      method: 'POST',
      body: formData
    });
  }

  destroy(): void {
    if (this.recorder) {
      if (this.isRecording) {
        this.recorder.stopRecording();
      }
      this.recorder.destroy();
      this.recorder = null;
    }
    
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    
    this.isRecording = false;
  }
}

// 녹화 세션 관리를 위한 유틸리티 함수들
export const createRecordingSession = (documentId: string, author: string): RecordingSession => {
  return {
    id: `rec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    documentId,
    startTime: Date.now(),
    annotations: [],
    status: 'recording'
  };
};

export const saveRecordingSession = async (session: RecordingSession, blob: Blob): Promise<void> => {
  // 로컬 스토리지에 세션 정보 저장
  const sessionData = {
    ...session,
    endTime: Date.now(),
    status: 'saved' as const
  };
  
  localStorage.setItem(`recording_${session.id}`, JSON.stringify(sessionData));
  
  // IndexedDB에 비디오 블롭 저장 (큰 파일을 위해)
  if ('indexedDB' in window) {
    const request = indexedDB.open('FeedbackRecordings', 1);
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('recordings')) {
        db.createObjectStore('recordings', { keyPath: 'id' });
      }
    };
    
    request.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const transaction = db.transaction(['recordings'], 'readwrite');
      const store = transaction.objectStore('recordings');
      
      store.put({
        id: session.id,
        blob: blob,
        timestamp: Date.now()
      });
    };
  }
};
