import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { v4 as uuidv4 } from 'uuid';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
  ]
};

export function useWebRTC(roomId, username) {
  const [peers, setPeers] = useState({});
  const [talkingUsers, setTalkingUsers] = useState(new Set());
  const [isMuted, setIsMuted] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState('Initializing...');
  const [micReady, setMicReady] = useState(false);

  // Stable ID via ref — never changes, never stale
  const myIdRef = useRef(uuidv4());
  const pcRef = useRef({});       // peerId -> RTCPeerConnection
  const channelRef = useRef(null);
  const streamRef = useRef(null);
  const audioElsRef = useRef({}); // peerId -> Audio element for playback

  const myId = myIdRef.current;

  // ─── 1. Acquire microphone (runs once) ────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then(s => {
        if (cancelled) { s.getTracks().forEach(t => t.stop()); return; }
        s.getAudioTracks().forEach(t => (t.enabled = false)); // PTT = start muted
        streamRef.current = s;
        setMicReady(true);
        setConnectionStatus('Mic ready');
      })
      .catch(err => {
        console.error('[Mic] Error:', err);
        setConnectionStatus('Mic blocked');
      });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, []);

  // ─── Helper: play remote audio for a peer ─────────────────────────────
  const playRemoteAudio = useCallback((peerId, remoteStream) => {
    // Reuse or create a persistent Audio element per peer
    if (!audioElsRef.current[peerId]) {
      audioElsRef.current[peerId] = new Audio();
      audioElsRef.current[peerId].autoplay = true;
    }
    const el = audioElsRef.current[peerId];
    if (el.srcObject !== remoteStream) {
      el.srcObject = remoteStream;
      el.play().catch(() => console.log('[Audio] Autoplay blocked for', peerId));
    }
  }, []);

  // ─── 2. Create peer connection ────────────────────────────────────────
  const makePeerConnection = useCallback((targetId, initiator) => {
    // If there's already a healthy connection, don't recreate
    const existing = pcRef.current[targetId];
    if (existing) {
      const state = existing.iceConnectionState;
      if (state === 'connected' || state === 'completed' || state === 'checking' || state === 'new') {
        console.log(`[WebRTC] Reusing existing PC for ${targetId} (state=${state})`);
        return existing;
      }
      // Close stale connection
      try { existing.close(); } catch (_) {}
      delete pcRef.current[targetId];
    }

    console.log(`[WebRTC] New PC for ${targetId.slice(0,8)}, initiator=${initiator}`);
    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current[targetId] = pc;

    // Add local tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => pc.addTrack(track, streamRef.current));
    }

    // ICE candidates → broadcast
    pc.onicecandidate = (e) => {
      if (e.candidate && channelRef.current) {
        channelRef.current.send({
          type: 'broadcast', event: 'ice-candidate',
          payload: { targetId, senderId: myId, candidate: e.candidate }
        });
      }
    };

    // Remote track received
    pc.ontrack = (event) => {
      console.log(`[WebRTC] Remote track from ${targetId.slice(0,8)}`);
      const rs = event.streams[0];
      setPeers(prev => ({ ...prev, [targetId]: { ...prev[targetId], stream: rs } }));
      playRemoteAudio(targetId, rs);
    };

    pc.oniceconnectionstatechange = () => {
      const st = pc.iceConnectionState;
      console.log(`[WebRTC] ICE ${targetId.slice(0,8)}: ${st}`);
      if (st === 'failed') {
        // Attempt ICE restart
        if (initiator && pc.signalingState !== 'closed') {
          console.log(`[WebRTC] ICE restart for ${targetId.slice(0,8)}`);
          pc.createOffer({ iceRestart: true })
            .then(offer => pc.setLocalDescription(offer))
            .then(() => {
              channelRef.current?.send({
                type: 'broadcast', event: 'offer',
                payload: { targetId, senderId: myId, sdp: pc.localDescription }
              });
            }).catch(() => {});
        }
      }
    };

    // Initiator sends offer
    if (initiator) {
      pc.createOffer()
        .then(offer => pc.setLocalDescription(offer))
        .then(() => {
          console.log(`[WebRTC] Offer → ${targetId.slice(0,8)}`);
          channelRef.current?.send({
            type: 'broadcast', event: 'offer',
            payload: { targetId, senderId: myId, sdp: pc.localDescription }
          });
        })
        .catch(err => console.error('[WebRTC] Offer error:', err));
    }

    return pc;
  }, [myId, playRemoteAudio]);

  // ─── 3. Supabase Realtime channel ─────────────────────────────────────
  useEffect(() => {
    if (!roomId || !micReady || !myId) return;

    console.log(`[Realtime] Joining room:${roomId} as ${myId.slice(0,8)}`);

    const channel = supabase.channel(`room:${roomId}`, {
      config: { presence: { key: myId }, broadcast: { self: false } }
    });
    channelRef.current = channel;

    // ── Presence sync: rebuild peer list from truth ──
    const syncPresence = () => {
      const state = channel.presenceState();
      const ids = Object.keys(state).filter(id => id !== myId);
      console.log('[Realtime] Sync peers:', ids.map(i => i.slice(0,8)));

      const activePeers = {};
      const talkers = new Set();
      ids.forEach(id => {
        const p = state[id]?.[0];
        if (p) {
          activePeers[id] = { username: p.username };
          if (p.isTalking) talkers.add(id);
        }
      });

      setPeers(prev => {
        const merged = {};
        Object.keys(activePeers).forEach(id => {
          merged[id] = { ...activePeers[id] };
          if (prev[id]?.stream) merged[id].stream = prev[id].stream;
        });
        return merged;
      });
      setTalkingUsers(talkers);
    };

    channel
      .on('presence', { event: 'sync' }, syncPresence)
      .on('presence', { event: 'join' }, ({ key }) => {
        console.log('[Realtime] Join:', key.slice(0,8));
        syncPresence();
        if (key !== myId) {
          // Use ID comparison to decide initiator → prevents both sides from
          // simultaneously creating offers and destroying each other's connections
          const iAmInitiator = myId > key;
          if (iAmInitiator) {
            setTimeout(() => makePeerConnection(key, true), 300);
          }
        }
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        console.log('[Realtime] Leave:', key.slice(0,8));
        // Clean up peer connection
        if (pcRef.current[key]) {
          try { pcRef.current[key].close(); } catch (_) {}
          delete pcRef.current[key];
        }
        // Clean up audio element
        if (audioElsRef.current[key]) {
          audioElsRef.current[key].srcObject = null;
          delete audioElsRef.current[key];
        }
        syncPresence();
      })
      // ── WebRTC signaling ──
      .on('broadcast', { event: 'offer' }, async ({ payload }) => {
        if (payload.targetId !== myId) return;
        console.log('[WebRTC] Offer ← ' + payload.senderId.slice(0,8));
        const pc = makePeerConnection(payload.senderId, false);
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          channel.send({
            type: 'broadcast', event: 'answer',
            payload: { targetId: payload.senderId, senderId: myId, sdp: pc.localDescription }
          });
        } catch (err) {
          console.error('[WebRTC] Answer error:', err);
        }
      })
      .on('broadcast', { event: 'answer' }, async ({ payload }) => {
        if (payload.targetId !== myId) return;
        console.log('[WebRTC] Answer ← ' + payload.senderId.slice(0,8));
        const pc = pcRef.current[payload.senderId];
        if (pc && pc.signalingState === 'have-local-offer') {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          } catch (err) {
            console.error('[WebRTC] setRemoteDesc error:', err);
          }
        }
      })
      .on('broadcast', { event: 'ice-candidate' }, async ({ payload }) => {
        if (payload.targetId !== myId) return;
        const pc = pcRef.current[payload.senderId];
        if (pc && pc.remoteDescription) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
          } catch (err) {
            console.warn('[WebRTC] ICE error:', err.message);
          }
        }
      });

    // Subscribe + track presence
    channel.subscribe(async (status, err) => {
      console.log('[Realtime] Status:', status, err || '');
      setConnectionStatus(status);
      if (status === 'SUBSCRIBED') {
        try {
          await channel.track({ username, isTalking: false });
          console.log('[Realtime] Tracked OK');
        } catch (e) {
          console.error('[Realtime] Track failed:', e);
        }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        // Auto-reconnect after 2s
        console.log('[Realtime] Channel lost, reconnecting in 2s...');
        setConnectionStatus('Reconnecting...');
        setTimeout(() => {
          if (channelRef.current === channel) {
            channel.subscribe();
          }
        }, 2000);
      }
    });

    // Cleanup
    return () => {
      console.log('[Realtime] Cleanup');
      channelRef.current = null;
      channel.untrack().catch(() => {});
      channel.unsubscribe();
      // Small delay before removing so Strict Mode second mount isn't affected
      const ch = channel;
      setTimeout(() => supabase.removeChannel(ch), 500);
      // Close all peer connections
      Object.values(pcRef.current).forEach(pc => { try { pc.close(); } catch (_) {} });
      pcRef.current = {};
      // Clean up audio elements
      Object.values(audioElsRef.current).forEach(el => { el.srcObject = null; });
      audioElsRef.current = {};
    };
  }, [roomId, micReady, myId, username, makePeerConnection]);

  // ─── 4. Push-to-Talk ──────────────────────────────────────────────────
  const toggleMute = useCallback(async (muted) => {
    setIsMuted(muted);
    streamRef.current?.getAudioTracks().forEach(t => (t.enabled = !muted));
    if (channelRef.current) {
      try {
        await channelRef.current.track({ username, isTalking: !muted });
      } catch (err) {
        console.error('[PTT] Track error:', err);
      }
    }
  }, [username]);

  return { peers, talkingUsers, isMuted, toggleMute, myId, connectionStatus };
}
