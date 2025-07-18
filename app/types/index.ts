export interface FeedbackAnnotation {
  id: string;
  type: 'highlight' | 'text' | 'drawing' | 'mask';
  x: number;
  y: number;
  width?: number;
  height?: number;
  content?: string;
  color?: string;
  timestamp: number;
  author: string;
}

export interface PDFDocument {
  id: string;
  name: string;
  url: string;
  totalPages: number;
  currentPage: number;
}

export interface RecordingSession {
  id: string;
  documentId: string;
  startTime: number;
  endTime?: number;
  annotations: FeedbackAnnotation[];
  videoBlob?: Blob;
  status: 'recording' | 'stopped' | 'saved';
}

export interface WebRTCPeer {
  id: string;
  name: string;
  isHost: boolean;
  stream?: MediaStream;
}

export interface Room {
  id: string;
  name: string;
  hostId: string;
  participants: WebRTCPeer[];
  document?: PDFDocument;
  createdAt: number;
}
