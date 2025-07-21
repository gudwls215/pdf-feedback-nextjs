const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// CORS 설정
app.use(cors({
  origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
  credentials: true
}));

const io = socketIo(server, {
  cors: {
    origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
    methods: ["GET", "POST"],
    credentials: true
  }
});

// 활성 스트림 저장
const activeStreams = new Map();

app.get('/', (req, res) => {
  res.json({ 
    message: 'WebRTC Signaling Server', 
    activeStreams: Array.from(activeStreams.keys())
  });
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // 스트리머가 스트림을 시작할 때
  socket.on('start-stream', (data) => {
    const { streamId } = data;
    console.log('Stream started:', streamId, 'by', socket.id);
    
    activeStreams.set(streamId, {
      hostSocketId: socket.id,
      viewers: new Set(),
      startTime: Date.now()
    });
    
    socket.join(streamId);
    socket.emit('stream-started', { streamId });
  });

  // 뷰어가 스트림에 참여할 때
  socket.on('join-stream', (data) => {
    const { streamId } = data;
    console.log('Viewer joining stream:', streamId, 'viewer:', socket.id);
    
    const stream = activeStreams.get(streamId);
    if (stream) {
      stream.viewers.add(socket.id);
      socket.join(streamId);
      
      // 스트리머에게 새 뷰어 알림
      socket.to(stream.hostSocketId).emit('viewer-joined', {
        viewerId: socket.id,
        viewerCount: stream.viewers.size
      });
      
      // 뷰어에게 스트리머 정보 전송
      socket.emit('stream-available', {
        streamId,
        hostSocketId: stream.hostSocketId
      });
    } else {
      socket.emit('stream-not-found', { streamId });
    }
  });

  // WebRTC offer 전달
  socket.on('offer', (data) => {
    const { streamId, offer, targetSocketId } = data;
    console.log('Forwarding offer from', socket.id, 'to', targetSocketId);
    socket.to(targetSocketId).emit('offer', {
      offer,
      fromSocketId: socket.id,
      streamId
    });
  });

  // WebRTC answer 전달
  socket.on('answer', (data) => {
    const { streamId, answer, targetSocketId } = data;
    console.log('Forwarding answer from', socket.id, 'to', targetSocketId);
    socket.to(targetSocketId).emit('answer', {
      answer,
      fromSocketId: socket.id,
      streamId
    });
  });

  // ICE candidate 전달
  socket.on('ice-candidate', (data) => {
    const { candidate, targetSocketId, streamId } = data;
    socket.to(targetSocketId).emit('ice-candidate', {
      candidate,
      fromSocketId: socket.id,
      streamId
    });
  });

  // 스트림 종료
  socket.on('stop-stream', (data) => {
    const { streamId } = data;
    console.log('Stream stopped:', streamId);
    
    const stream = activeStreams.get(streamId);
    if (stream && stream.hostSocketId === socket.id) {
      // 모든 뷰어에게 스트림 종료 알림
      socket.to(streamId).emit('stream-ended', { streamId });
      activeStreams.delete(streamId);
    }
  });

  // 연결 해제 처리
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    // 스트리머가 연결 해제된 경우
    for (const [streamId, stream] of activeStreams.entries()) {
      if (stream.hostSocketId === socket.id) {
        socket.to(streamId).emit('stream-ended', { streamId });
        activeStreams.delete(streamId);
        console.log('Stream ended due to host disconnect:', streamId);
      } else if (stream.viewers.has(socket.id)) {
        // 뷰어가 연결 해제된 경우
        stream.viewers.delete(socket.id);
        socket.to(stream.hostSocketId).emit('viewer-left', {
          viewerId: socket.id,
          viewerCount: stream.viewers.size
        });
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
});
