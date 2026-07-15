'use client';

import { useEffect, useRef } from 'react';
import { useWebRTC } from '@/hooks/useWebRTC';
import { useRouter } from 'next/navigation';

export default function WalkieTalkie({ roomId, username }) {
  const router = useRouter();
  const { peers, talkingUsers, isMuted, toggleMute, myId } = useWebRTC(roomId, username);

  // Auto-play audio streams
  const audioRefs = useRef({});

  useEffect(() => {
    Object.keys(peers).forEach(peerId => {
      if (peers[peerId].stream && audioRefs.current[peerId]) {
        const audioEl = audioRefs.current[peerId];
        if (audioEl.srcObject !== peers[peerId].stream) {
          audioEl.srcObject = peers[peerId].stream;
        }
      }
    });
  }, [peers]);

  return (
    <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2rem' }}>
      
      {/* Audio elements for remote peers */}
      {Object.keys(peers).map(peerId => (
        <audio
          key={peerId}
          ref={el => (audioRefs.current[peerId] = el)}
          autoPlay
          style={{ display: 'none' }}
        />
      ))}

      <div style={{ textAlign: 'center' }}>
        <h2 style={{ marginBottom: '0.5rem' }}>Room {roomId}</h2>
        <p style={{ color: 'var(--text-muted)' }}>Connected as: {username}</p>
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
            {Object.keys(peers).map(peerId => (
              <div key={peerId} className={`user-badge ${talkingUsers.has(peerId) ? 'talking' : ''}`}>
                {peers[peerId].username}
              </div>
            ))}
          </div>
        </div>
      </div>

      <button className="btn btn-danger" onClick={() => router.push('/')}>
        Leave Room
      </button>
    </div>
  );
}
