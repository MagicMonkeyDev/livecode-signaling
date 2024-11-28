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

const streams = new Map(); // username -> streamInfo
const viewers = new Map();

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('get-streams', () => {
    const streamList = Array.from(streams.values()).map(stream => ({
      streamId: stream.id,
      username: stream.username,
      title: stream.title,
      description: stream.description,
      pumpLink: stream.pumpLink,
      viewerCount: stream.viewers.size
    }));
    socket.emit('initial-streams', streamList);
  });

  socket.on('start-stream', (streamInfo, callback) => {
    console.log('Stream started:', socket.id);
    const { username } = streamInfo;
    
    // Check if user is already streaming
    const existingStream = streams.get(username);
    if (existingStream) {
      if (callback) {
        callback({ success: false, error: 'User already streaming' });
      }
      return;
    }
    
    const streamId = `${username}_${Date.now()}`;
    const streamData = {
      ...streamInfo,
      id: streamId,
      streamerId: socket.id,
      username,
      viewers: new Set()
    };
    
    streams.set(username, streamData);
    
    // Broadcast new stream to all clients
    io.emit('stream-added', {
      streamId,
      username,
      ...streamInfo,
      viewerCount: 0
    });
    
    if (callback) {
      callback({ success: true, streamId });
    }
  });

  socket.on('join-stream', ({ username }) => {
    const stream = streams.get(username);
    if (stream) {
      console.log(`Viewer ${socket.id} joined stream for ${username}`);
      viewers.set(socket.id, username);
      stream.viewers.add(socket.id);
      
      // Notify streamer of new viewer
      io.to(stream.streamerId).emit('viewer-joined', {
        viewerId: socket.id
      });
      
      // Update viewer count
      io.emit('viewer-count-update', {
        username,
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
    const streamerStream = Array.from(streams.entries()).find(([_, s]) => s.streamerId === socket.id);
    if (streamerStream) {
      const [username, stream] = streamerStream;
      stream.viewers.forEach(viewerId => {
        io.to(viewerId).emit('stream-ended', stream.id);
      });
      io.emit('stream-removed', stream.id);
      streams.delete(username);
    }
    
    // Handle viewer disconnect
    if (viewers.has(socket.id)) {
      const username = viewers.get(socket.id);
      const stream = streams.get(username);
      if (stream) {
        stream.viewers.delete(socket.id);
        io.to(stream.streamerId).emit('viewer-left', {
          viewerId: socket.id
        });
        io.emit('viewer-count-update', {
          username,
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