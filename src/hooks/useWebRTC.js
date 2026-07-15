import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { v4 as uuidv4 } from 'uuid';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]
};

export function useWebRTC(roomId, username) {
  const [peers, setPeers] = useState({});
  const [talkingUsers, setTalkingUsers] = useState(new Set());
  const [isMuted, setIsMuted] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState('Initializing...');
  const [micReady, setMicReady] = useState(false);

  // Use a ref for myId so it's stable across renders and never stale in callbacks
  const myIdRef = useRef(uuidv4());
  const connectionsRef = useRef({});
  const channelRef = useRef(null);
  const streamRef = useRef(null);
  const mountedRef = useRef(false);

  const myId = myIdRef.current;

  // ─── 1. Acquire microphone ───────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then(s => {
        if (cancelled) { s.getTracks().forEach(t => t.stop()); return; }
        // Start muted (PTT)
        s.getAudioTracks().forEach(t => (t.enabled = false));
        streamRef.current = s;
        setConnectionStatus('Mic ready');
        setMicReady(true);
      })
      .catch(err => {
        console.error('Mic error:', err);
        setConnectionStatus('Mic blocked');
        alert('Microphone access is required. Please allow it in browser settings. On mobile, HTTPS is required.');
      });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, []);

  // ─── 2. Create a peer connection ─────────────────────────────────────
  const createPeerConnection = useCallback((targetId, initiator) => {
    // Close any existing stale connection
    if (connectionsRef.current[targetId]) {
      try { connectionsRef.current[targetId].close(); } catch (_) {}
      delete connectionsRef.current[targetId];
    }

    console.log(`[WebRTC] Creating PC for ${targetId}, initiator=${initiator}`);
    const pc = new RTCPeerConnection(ICE_SERVERS);
    connectionsRef.current[targetId] = pc;

    // Add local audio track
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, streamRef.current);
      });
    }

    // Send ICE candidates via Supabase broadcast
    pc.onicecandidate = (e) => {
      if (e.candidate && channelRef.current) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'ice-candidate',
          payload: { targetId, senderId: myId, candidate: e.candidate }
        });
      }
    };

    // When we receive a remote track, store the stream
    pc.ontrack = (event) => {
      console.log(`[WebRTC] Got remote track from ${targetId}`);
      const remoteStream = event.streams[0];
      setPeers(prev => ({
        ...prev,
        [targetId]: { ...prev[targetId], stream: remoteStream }
      }));

      // Force-play audio immediately (handles autoplay policy)
      try {
        const audio = new Audio();
        audio.srcObject = remoteStream;
        audio.autoplay = true;
        audio.play().catch(() => console.log('Autoplay blocked, will retry on interaction'));
      } catch (_) {}
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[WebRTC] ICE state ${targetId}: ${pc.iceConnectionState}`);
    };

    // If we are the initiator, create and send offer
    if (initiator) {
      pc.createOffer()
        .then(offer => pc.setLocalDescription(offer))
        .then(() => {
          console.log(`[WebRTC] Sending offer to ${targetId}`);
          channelRef.current?.send({
            type: 'broadcast',
            event: 'offer',
            payload: { targetId, senderId: myId, sdp: pc.localDescription }
          });
        })
        .catch(err => console.error('Offer error:', err));
    }

    return pc;
  }, [myId]);

  // ─── 3. Join Supabase Realtime channel ───────────────────────────────
  useEffect(() => {
    // Wait until mic is ready
    if (!roomId || !micReady || !myId) return;

    // Prevent Strict Mode double-mount from creating duplicate channels
    if (mountedRef.current) return;
    mountedRef.current = true;

    console.log(`[Realtime] Joining room:${roomId} as ${myId}`);

    const channel = supabase.channel(`room:${roomId}`, {
      config: {
        presence: { key: myId },
        broadcast: { self: false }
      }
    });
    channelRef.current = channel;

    // ── Presence handlers ──
    const syncPresence = () => {
      const state = channel.presenceState();
      console.log('[Realtime] Presence sync:', JSON.stringify(Object.keys(state)));

      const activePeers = {};
      const talkers = new Set();

      Object.entries(state).forEach(([id, presences]) => {
        if (id !== myId && presences?.length > 0) {
          activePeers[id] = { username: presences[0].username };
          if (presences[0].isTalking) talkers.add(id);
        }
      });

      setPeers(prev => {
        const merged = { ...activePeers };
        // Preserve existing streams
        Object.keys(merged).forEach(id => {
          if (prev[id]?.stream) merged[id].stream = prev[id].stream;
        });
        return merged;
      });
      setTalkingUsers(talkers);
    };

    channel
      .on('presence', { event: 'sync' }, syncPresence)
      .on('presence', { event: 'join' }, ({ key, newPresences }) => {
        console.log('[Realtime] User joined:', key);
        syncPresence();
        if (key !== myId) {
          // Small delay to let the other side finish subscribing
          setTimeout(() => createPeerConnection(key, true), 500);
        }
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        console.log('[Realtime] User left:', key);
        if (connectionsRef.current[key]) {
          try { connectionsRef.current[key].close(); } catch (_) {}
          delete connectionsRef.current[key];
        }
        syncPresence();
      })
      // ── WebRTC signaling via broadcast ──
      .on('broadcast', { event: 'offer' }, async ({ payload }) => {
        if (payload.targetId !== myId) return;
        console.log('[WebRTC] Received offer from', payload.senderId);
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
        console.log('[WebRTC] Received answer from', payload.senderId);
        const pc = connectionsRef.current[payload.senderId];
        if (pc && pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        }
      })
      .on('broadcast', { event: 'ice-candidate' }, async ({ payload }) => {
        if (payload.targetId !== myId) return;
        const pc = connectionsRef.current[payload.senderId];
        if (pc) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
          } catch (err) {
            console.warn('ICE candidate error:', err);
          }
        }
      });

    channel.subscribe(async (status, err) => {
      console.log('[Realtime] Channel status:', status, err || '');
      setConnectionStatus(status);
      if (status === 'SUBSCRIBED') {
        await channel.track({ username, isTalking: false });
        console.log('[Realtime] Presence tracked successfully');
      }
    });

    return () => {
      console.log('[Realtime] Cleanup');
      mountedRef.current = false;
      channel.untrack();
      channel.unsubscribe();
      supabase.removeChannel(channel);
      channelRef.current = null;
      Object.values(connectionsRef.current).forEach(pc => {
        try { pc.close(); } catch (_) {}
      });
      connectionsRef.current = {};
    };
  }, [roomId, micReady, myId, username, createPeerConnection]);

  // ─── 4. Push-to-Talk toggle ──────────────────────────────────────────
  const toggleMute = useCallback(async (muted) => {
    setIsMuted(muted);
    // Enable/disable local mic track
    streamRef.current?.getAudioTracks().forEach(t => (t.enabled = !muted));
    // Update presence so others see the "talking" indicator
    if (channelRef.current) {
      try {
        await channelRef.current.track({ username, isTalking: !muted });
      } catch (err) {
        console.error('Presence track error:', err);
      }
    }
  }, [username]);

  return { peers, talkingUsers, isMuted, toggleMute, myId, connectionStatus };
}
