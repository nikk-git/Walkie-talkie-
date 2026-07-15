'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useWebRTC } from '@/hooks/useWebRTC';
import { useRouter } from 'next/navigation';

export default function WalkieTalkie({ roomId, username }) {
  const router = useRouter();
  const { peers, talkingUsers, isMuted, toggleMute, myId, connectionStatus } = useWebRTC(roomId, username);

  // Manage audio elements for each peer
  const audioRefs = useRef({});

  useEffect(() => {
    Object.entries(peers).forEach(([peerId, peer]) => {
      if (peer.stream && audioRefs.current[peerId]) {
        const audioEl = audioRefs.current[peerId];
        if (audioEl.srcObject !== peer.stream) {
          audioEl.srcObject = peer.stream;
          // Force play to handle autoplay policies
          audioEl.play().catch(() => {
            console.log('Audio autoplay blocked for', peerId);
          });
        }
      }
    });
  }, [peers]);

  // Ensure audio plays after any user interaction (autoplay policy workaround)
  const handleUserInteraction = useCallback(() => {
    Object.values(audioRefs.current).forEach(el => {
      if (el && el.paused && el.srcObject) {
        el.play().catch(() => {});
      }
    });
  }, []);

  const handleLeave = () => {
    sessionStorage.removeItem('wt_username');
    router.push('/');
  };

  const statusColor = connectionStatus === 'SUBSCRIBED' ? '#4ade80' : '#f87171';

  return (
    <div
      style={{ padding: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2rem' }}
      onClick={handleUserInteraction}
    >
      
      {/* Hidden audio elements for remote peers */}
      {Object.keys(peers).map(peerId => (
        <audio
          key={peerId}
          ref={el => (audioRefs.current[peerId] = el)}
          autoPlay
          playsInline
          style={{ display: 'none' }}
        />
      ))}

      <div style={{ textAlign: 'center' }}>
        <h2 style={{ marginBottom: '0.5rem' }}>Room {roomId}</h2>
        <p style={{ color: 'var(--text-muted)' }}>Connected as: {username}</p>
        <p style={{ fontSize: '0.75rem', marginTop: '0.5rem', color: statusColor }}>
          Realtime: {connectionStatus} &bull; ID: {myId?.slice(0, 8)}
        </p>
      </div>

      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3rem', width: '100%', maxWidth: '500px' }}>
        
        {/* PTT Button */}
        <div 
          className={`ptt-button ${!isMuted ? 'active' : ''}`}
          onMouseDown={() => toggleMute(false)}
          onMouseUp={() => toggleMute(true)}
          onMouseLeave={() => toggleMute(true)}
          onTouchStart={(e) => { e.preventDefault(); toggleMute(false); }}
          onTouchEnd={(e) => { e.preventDefault(); toggleMute(true); }}
        >
          {!isMuted ? 'TALKING' : 'PUSH TO TALK'}
        </div>

        {/* Active Users List */}
        <div style={{ width: '100%' }}>
          <h3 style={{ marginBottom: '1rem', color: 'var(--text-muted)', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '1px' }}>
            Participants ({Object.keys(peers).length + 1})
          </h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
            <div className={`user-badge ${!isMuted ? 'talking' : ''}`}>
              {username} (You)
            </div>
            {Object.entries(peers).map(([peerId, peer]) => (
              <div key={peerId} className={`user-badge ${talkingUsers.has(peerId) ? 'talking' : ''}`}>
                {peer.username || 'Unknown'}
              </div>
            ))}
          </div>
        </div>
      </div>

      <button className="btn btn-danger" onClick={handleLeave}>
        Leave Room
      </button>
    </div>
  );
}
