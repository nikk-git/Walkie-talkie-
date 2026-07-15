import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { v4 as uuidv4 } from 'uuid';

const configuration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]
};

export function useWebRTC(roomId, username) {
  const [peers, setPeers] = useState({});
  const [talkingUsers, setTalkingUsers] = useState(new Set());
  const [myId, setMyId] = useState('');
  const [stream, setStream] = useState(null);
  const [isMuted, setIsMuted] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState('Initializing...');
  
  const connections = useRef({});
  const channelRef = useRef(null);
  const streamRef = useRef(null);

  // Initialize unique client ID
  useEffect(() => {
    setMyId(uuidv4());
  }, []);

  // Initialize media safely
  useEffect(() => {
    let mounted = true;
    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then(s => {
        if (!mounted) {
          s.getTracks().forEach(t => t.stop());
          return;
        }
        s.getAudioTracks().forEach(track => track.enabled = false);
        setStream(s);
        streamRef.current = s;
      })
      .catch(err => {
        console.error("Error accessing mic:", err);
        alert("Microphone access is required to use the Walkie-Talkie! Please allow microphone permissions in your browser settings. If you are on a mobile device, ensure you are accessing the site via HTTPS.");
      });

    return () => {
      mounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const createPeerConnection = useCallback((targetId, initiator) => {
    if (connections.current[targetId]) return connections.current[targetId];

    console.log('Creating Peer Connection for:', targetId);
    const pc = new RTCPeerConnection(configuration);
    connections.current[targetId] = pc;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, streamRef.current);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate && channelRef.current) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'ice-candidate',
          payload: { targetId, senderId: myId, candidate: event.candidate }
        });
      }
    };

    pc.ontrack = (event) => {
      console.log('Received track from:', targetId);
      setPeers(prev => ({
        ...prev,
        [targetId]: { ...prev[targetId], stream: event.streams[0] }
      }));
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`ICE state for ${targetId}:`, pc.iceConnectionState);
      if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
        // Don't delete from peers immediately, presence sync will handle true leaves
        delete connections.current[targetId];
      }
    };

    if (initiator) {
      pc.createOffer()
        .then(offer => pc.setLocalDescription(offer))
        .then(() => {
          channelRef.current.send({
            type: 'broadcast',
            event: 'offer',
            payload: { targetId, senderId: myId, sdp: pc.localDescription }
          });
        });
    }

    return pc;
  }, [myId]);

  useEffect(() => {
    if (!roomId || !stream || !myId) return;

    const channel = supabase.channel(`room:${roomId}`, {
      config: { presence: { key: myId }, broadcast: { self: false } }
    });
    channelRef.current = channel;

    const updatePresenceState = () => {
      const state = channel.presenceState();
      console.log('Presence State Updated:', state);
      
      const activePeers = {};
      const activeTalkers = new Set();
      
      Object.keys(state).forEach(id => {
        if (id !== myId && state[id] && state[id].length > 0) {
          activePeers[id] = { username: state[id][0].username };
          if (state[id][0].isTalking) activeTalkers.add(id);
        }
      });
      
      setPeers(prev => {
        const merged = { ...activePeers };
        Object.keys(merged).forEach(id => {
          if (prev[id]?.stream) merged[id].stream = prev[id].stream;
        });
        return merged;
      });
      
      setTalkingUsers(activeTalkers);
    };

    channel
      .on('presence', { event: 'sync' }, updatePresenceState)
      .on('presence', { event: 'join' }, ({ key }) => {
        console.log('User joined:', key);
        updatePresenceState();
        if (key !== myId) {
           createPeerConnection(key, true);
        }
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        console.log('User left:', key);
        updatePresenceState();
        if (connections.current[key]) {
          connections.current[key].close();
          delete connections.current[key];
        }
      })
      .on('broadcast', { event: 'offer' }, async ({ payload }) => {
        if (payload.targetId !== myId) return;
        const pc = createPeerConnection(payload.senderId, false);
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        channel.send({
          type: 'broadcast',
          event: 'answer',
          payload: { targetId: payload.senderId, senderId: myId, sdp: pc.localDescription }
        });
      })
      .on('broadcast', { event: 'answer' }, async ({ payload }) => {
        if (payload.targetId !== myId) return;
        const pc = connections.current[payload.senderId];
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        }
      })
      .on('broadcast', { event: 'ice-candidate' }, async ({ payload }) => {
        if (payload.targetId !== myId) return;
        const pc = connections.current[payload.senderId];
        if (pc) {
          await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
        }
      });

    channel.subscribe(async (status, err) => {
      console.log('Supabase Channel Status:', status, err);
      setConnectionStatus(status);
      if (status === 'SUBSCRIBED') {
        try {
          const res = await channel.track({ username, isTalking: false });
          console.log('Track success:', res);
        } catch (e) {
          console.error('Track error:', e);
          setConnectionStatus('TRACK_ERROR');
        }
      }
    });

    return () => {
      channel.unsubscribe();
      supabase.removeChannel(channel);
      Object.values(connections.current).forEach(pc => pc.close());
    };
  }, [roomId, stream, myId, username, createPeerConnection]);

  const toggleMute = async (muted) => {
    setIsMuted(muted);
    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach(track => track.enabled = !muted);
    }
    if (channelRef.current) {
      try {
        await channelRef.current.track({ username, isTalking: !muted });
      } catch (err) {
        console.error('Failed to update presence:', err);
      }
    }
  };

  return { peers, talkingUsers, isMuted, toggleMute, myId, connectionStatus };
}
