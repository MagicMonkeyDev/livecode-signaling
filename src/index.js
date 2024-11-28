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

const streams = new Map();
const viewers = new Map();

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('start-stream', (streamInfo) => {
    console.log('Stream started:', socket.id);
    streams.set(socket.id, {
      ...streamInfo,
      streamerId: socket.id,
      viewers: new Set()
    });
    
    // Broadcast new stream to all clients
    io.emit('stream-added', {
      streamId: socket.id,
      ...streamInfo
    });
  });

  socket.on('join-stream', ({ streamId }) => {
    const stream = streams.get(streamId);
    if (stream) {
      console.log('Viewer joined:', socket.id);
      viewers.set(socket.id, streamId);
      stream.viewers.add(socket.id);
      
      // Notify streamer of new viewer
      io.to(streamId).emit('viewer-joined', {
        viewerId: socket.id
      });
      
      // Update viewer count
      io.to(streamId).emit('viewer-count', stream.viewers.size);
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

  socket.on('disconnect', () => {
    // Handle streamer disconnect
    if (streams.has(socket.id)) {
      const stream = streams.get(socket.id);
      stream.viewers.forEach(viewerId => {
        io.to(viewerId).emit('stream-ended');
      });
      streams.delete(socket.id);
      io.emit('stream-removed', socket.id);
    }
    
    // Handle viewer disconnect
    if (viewers.has(socket.id)) {
      const streamId = viewers.get(socket.id);
      const stream = streams.get(streamId);
      if (stream) {
        stream.viewers.delete(socket.id);
        io.to(streamId).emit('viewer-left', {
          viewerId: socket.id
        });
        io.to(streamId).emit('viewer-count', stream.viewers.size);
      }
      viewers.delete(socket.id);
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});