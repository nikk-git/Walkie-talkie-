import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { v4 as uuidv4 } from 'uuid';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ]
};

export function useWebRTC(roomId, username) {
  const [peers, setPeers] = useState({});
  const [talkingUsers, setTalkingUsers] = useState(new Set());
  const [isMuted, setIsMuted] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState('Initializing...');
  const [micReady, setMicReady] = useState(false);

  const myIdRef = useRef(uuidv4());
  const pcRef = useRef({});
  const channelRef = useRef(null);
  const streamRef = useRef(null);
  const audioElsRef = useRef({}); // peerId -> HTMLAudioElement
  const isTalkingRef = useRef(false);
  const trackTimeoutRef = useRef(null);

  // Called on any user interaction to unlock audio
  const unlockAudio = useCallback(() => {
    Object.values(audioElsRef.current).forEach(audio => {
      if (audio.paused && audio.srcObject) {
        audio.play().catch(() => {});
      }
    });
  }, []);

  // ─── 1. Acquire microphone ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then(s => {
        if (cancelled) { s.getTracks().forEach(t => t.stop()); return; }
        s.getAudioTracks().forEach(t => (t.enabled = false));
        streamRef.current = s;
        setMicReady(true);
        setConnectionStatus('Mic ready');
      })
      .catch(err => {
        console.error('[Mic]', err);
        setConnectionStatus('Mic blocked');
      });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, []);

  const myId = myIdRef.current;

  // ─── 2. Create peer connection ────────────────────────────────────
  const makePeerConnection = useCallback((targetId, initiator) => {
    const existing = pcRef.current[targetId];
    if (existing) {
      const st = existing.iceConnectionState;
      if (st === 'connected' || st === 'completed' || st === 'checking' || st === 'new') {
        return existing; // Reuse healthy connection
      }
      try { existing.close(); } catch (_) {}
      delete pcRef.current[targetId];
    }

    console.log(`[WebRTC] New PC ${targetId.slice(0, 8)}, init=${initiator}`);
    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current[targetId] = pc;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => pc.addTrack(t, streamRef.current));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate && channelRef.current) {
        channelRef.current.send({
          type: 'broadcast', event: 'ice-candidate',
          payload: { targetId, senderId: myId, candidate: e.candidate }
        });
      }
    };

    pc.ontrack = (event) => {
      console.log(`[WebRTC] Track from ${targetId.slice(0, 8)}`);
      const rs = event.streams[0];
      
      if (!audioElsRef.current[targetId]) {
        const audio = new Audio();
        audio.autoplay = true;
        audio.playsInline = true;
        document.body.appendChild(audio);
        audioElsRef.current[targetId] = audio;
      }
      const audio = audioElsRef.current[targetId];
      if (audio.srcObject !== rs) {
        audio.srcObject = rs;
        audio.play().catch(err => console.warn('[Audio] Autoplay blocked:', err));
      }
    };

    pc.oniceconnectionstatechange = () => {
      const st = pc.iceConnectionState;
      console.log(`[WebRTC] ICE ${targetId.slice(0, 8)}: ${st}`);
      if (st === 'failed' && initiator && pc.signalingState !== 'closed') {
        pc.createOffer({ iceRestart: true })
          .then(o => pc.setLocalDescription(o))
          .then(() => {
            channelRef.current?.send({
              type: 'broadcast', event: 'offer',
              payload: { targetId, senderId: myId, sdp: pc.localDescription }
            });
          }).catch(() => {});
      }
    };

    if (initiator) {
      pc.createOffer()
        .then(o => pc.setLocalDescription(o))
        .then(() => {
          channelRef.current?.send({
            type: 'broadcast', event: 'offer',
            payload: { targetId, senderId: myId, sdp: pc.localDescription }
          });
        })
        .catch(err => console.error('[WebRTC] Offer err:', err));
    }

    return pc;
  }, [myId]);

  // ─── 3. Supabase Realtime channel ─────────────────────────────────
  useEffect(() => {
    if (!roomId || !micReady || !myId) return;

    console.log(`[RT] Join room:${roomId} as ${myId.slice(0, 8)}`);

    const channelName = `room:${roomId}`;
    const channel = supabase.channel(channelName, {
      config: { presence: { key: myId }, broadcast: { self: false } }
    });
    channelRef.current = channel;

    const syncPresence = () => {
      const state = channel.presenceState();
      const activePeers = {};
      const talkers = new Set();

      Object.entries(state).forEach(([id, presences]) => {
        if (id !== myId && presences?.[0]) {
          activePeers[id] = { username: presences[0].username };
          if (presences[0].isTalking) talkers.add(id);
        }
      });

      setPeers(prev => {
        const merged = {};
        Object.keys(activePeers).forEach(id => {
          merged[id] = { ...activePeers[id] };
        });
        return merged;
      });
      setTalkingUsers(talkers);
    };

    channel
      .on('presence', { event: 'sync' }, syncPresence)
      .on('presence', { event: 'join' }, ({ key }) => {
        console.log(`[RT] Join: ${key.slice(0, 8)}`);
        syncPresence();
        // Only the peer with the higher ID initiates (prevents race condition)
        if (key !== myId && myId > key) {
          setTimeout(() => makePeerConnection(key, true), 500);
        }
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        console.log(`[RT] Leave: ${key.slice(0, 8)}`);
        if (pcRef.current[key]) {
          try { pcRef.current[key].close(); } catch (_) {}
          delete pcRef.current[key];
        }
        if (audioElsRef.current[key]) {
          try { 
            audioElsRef.current[key].pause(); 
            audioElsRef.current[key].srcObject = null;
            audioElsRef.current[key].remove();
          } catch (_) {}
          delete audioElsRef.current[key];
        }
        syncPresence();
      })
      .on('broadcast', { event: 'offer' }, async ({ payload }) => {
        if (payload.targetId !== myId) return;
        console.log(`[WebRTC] Offer <- ${payload.senderId.slice(0, 8)}`);
        const pc = makePeerConnection(payload.senderId, false);
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          channel.send({
            type: 'broadcast', event: 'answer',
            payload: { targetId: payload.senderId, senderId: myId, sdp: pc.localDescription }
          });
        } catch (err) { console.error('[WebRTC] Answer err:', err); }
      })
      .on('broadcast', { event: 'answer' }, async ({ payload }) => {
        if (payload.targetId !== myId) return;
        const pc = pcRef.current[payload.senderId];
        if (pc?.signalingState === 'have-local-offer') {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          } catch (err) { console.error('[WebRTC] setRemote err:', err); }
        }
      })
      .on('broadcast', { event: 'ice-candidate' }, async ({ payload }) => {
        if (payload.targetId !== myId) return;
        const pc = pcRef.current[payload.senderId];
        if (pc?.remoteDescription) {
          try { await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)); }
          catch (err) { console.warn('[WebRTC] ICE err:', err.message); }
        }
      });

    channel.subscribe(async (status, err) => {
      console.log(`[RT] Status: ${status}`, err || '');
      setConnectionStatus(status);
      if (status === 'SUBSCRIBED') {
        try {
          await channel.track({ username, isTalking: false });
          console.log('[RT] Tracked OK');
        } catch (e) { console.error('[RT] Track err:', e); }
      }
      // Don't auto-reconnect — Supabase client handles reconnection internally
    });

    return () => {
      channelRef.current = null;
      channel.untrack().catch(() => {});
      channel.unsubscribe();
      supabase.removeChannel(channel);
      Object.values(pcRef.current).forEach(pc => { try { pc.close(); } catch (_) {} });
      pcRef.current = {};
      Object.values(audioElsRef.current).forEach(a => { 
        try { a.pause(); a.srcObject = null; a.remove(); } catch (_) {} 
      });
      audioElsRef.current = {};
    };
  }, [roomId, micReady, myId, username, makePeerConnection]);

  const toggleMute = useCallback((muted) => {
    unlockAudio(); // Resume AudioContext on user gesture
    setIsMuted(muted);
    streamRef.current?.getAudioTracks().forEach(t => (t.enabled = !muted));
    
    const isTalking = !muted;
    if (isTalkingRef.current === isTalking) return;
    isTalkingRef.current = isTalking;

    if (channelRef.current) {
      clearTimeout(trackTimeoutRef.current);
      trackTimeoutRef.current = setTimeout(() => {
        if (channelRef.current) {
          channelRef.current.track({ username, isTalking }).catch(err => console.error('[PTT] err:', err));
        }
      }, 350); // 350ms debounce
    }
  }, [username, unlockAudio]);

  return { peers, talkingUsers, isMuted, toggleMute, myId, connectionStatus, unlockAudio };
}
