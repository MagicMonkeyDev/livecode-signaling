import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const streams = new Map(); // streamId -> streamInfo
const viewers = new Map();

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('get-streams', () => {
    // Convert streams Map to array of stream info
    const streamList = Array.from(streams.values()).map(stream => ({
      streamId: stream.streamerId || stream.id,
      title: stream.title,
      description: stream.description,
      pumpLink: stream.pumpLink,
      viewerCount: stream.viewers.size
    }));
    socket.emit('initial-streams', streamList);
  });

  socket.on('start-stream', (streamInfo, callback) => {
    console.log('Stream started:', socket.id);
    const streamId = `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const streamData = {
      ...streamInfo,
      id: streamId,
      streamerId: socket.id,
      viewers: new Set()
    };
    
    streams.set(streamId, streamData);
    
    // Broadcast new stream to all clients
    io.emit('stream-added', {
      streamId,
      ...streamInfo,
      viewerCount: 0
    });
    
    if (callback) {
      callback({ success: true, streamId });
    }
  });

  socket.on('join-stream', ({ streamId }) => {
    const stream = streams.get(streamId);
    if (stream) {
      console.log(`Viewer ${socket.id} joined stream ${streamId}`);
      viewers.set(socket.id, streamId);
      stream.viewers.add(socket.id);
      
      // Notify streamer of new viewer
      io.to(stream.streamerId).emit('viewer-joined', {
        viewerId: socket.id
      });
      
      // Update viewer count
      io.emit('viewer-count-update', {
        streamId,
        count: stream.viewers.size
      });
    }
  });

  socket.on('offer', ({ offer, viewerId }) => {
    io.to(viewerId).emit('offer', {
      offer,
      streamerId: socket.id
    });
  });

  socket.on('answer', ({ answer, streamerId }) => {
    io.to(streamerId).emit('answer', {
      answer,
      viewerId: socket.id
    });
  });

  socket.on('ice-candidate', ({ candidate, targetId }) => {
    io.to(targetId).emit('ice-candidate', {
      candidate,
      from: socket.id
    });
  });

  socket.on('chat-message', ({ streamId, user, text }) => {
    const stream = streams.get(streamId);
    if (stream) {
      // Broadcast message to streamer and all viewers
      io.to(stream.streamerId).emit('chat-message', { user, text });
      stream.viewers.forEach(viewerId => {
        io.to(viewerId).emit('chat-message', { user, text });
      });
    }
  });

  socket.on('disconnect', () => {
    // Handle streamer disconnect
    const streamerStream = Array.from(streams.values()).find(s => s.streamerId === socket.id);
    if (streamerStream) {
      streamerStream.viewers.forEach(viewerId => {
        io.to(viewerId).emit('stream-ended', streamerStream.id);
      });
      io.emit('stream-removed', streamerStream.id);
      streams.delete(streamerStream.id);
    }
    
    // Handle viewer disconnect
    if (viewers.has(socket.id)) {
      const streamId = viewers.get(socket.id);
      const stream = streams.get(streamId);
      if (stream) {
        stream.viewers.delete(socket.id);
        io.to(stream.streamerId).emit('viewer-left', {
          viewerId: socket.id
        });
        io.emit('viewer-count-update', {
          streamId,
          count: stream.viewers.size
        });
      }
      viewers.delete(socket.id);
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});