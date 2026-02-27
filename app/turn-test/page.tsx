'use client';

import React, { useState } from 'react';

// TURN 서버 연결 테스트 페이지
export default function TurnTestPage() {
  const [results, setResults] = useState<string[]>([]);
  const [testing, setTesting] = useState(false);

  const turnUrl = process.env.NEXT_PUBLIC_TURN_SERVER_URL || '';
  const turnUser = process.env.NEXT_PUBLIC_TURN_USERNAME || '';
  const turnCred = process.env.NEXT_PUBLIC_TURN_CREDENTIAL || '';

  const log = (msg: string) => {
    const ts = new Date().toISOString().slice(11, 23);
    setResults(prev => [...prev, `[${ts}] ${msg}`]);
  };

  const testTurnServer = async (
    label: string,
    iceServers: RTCIceServer[]
  ): Promise<{ host: number; srflx: number; relay: number }> => {
    return new Promise((resolve) => {
      const stats = { host: 0, srflx: 0, relay: 0 };
      log(`--- ${label} 테스트 시작 ---`);

      const pc = new RTCPeerConnection({ iceServers });
      pc.createDataChannel('test');

      const timeout = setTimeout(() => {
        pc.close();
        log(`--- ${label} 타임아웃 (10초) ---`);
        resolve(stats);
      }, 10000);

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          const c = e.candidate;
          const cType = c.type || 'unknown';
          if (cType === 'host') stats.host++;
          if (cType === 'srflx') stats.srflx++;
          if (cType === 'relay') stats.relay++;
          log(`  [${cType}] ${c.protocol} ${c.address}:${c.port} ${c.relatedAddress ? `(relay=${c.relatedAddress}:${c.relatedPort})` : ''}`);
        } else {
          clearTimeout(timeout);
          log(`--- ${label} gathering 완료 ---`);
          pc.close();
          resolve(stats);
        }
      };

      pc.onicegatheringstatechange = () => {
        log(`  gathering state: ${pc.iceGatheringState}`);
      };

      pc.createOffer().then(offer => pc.setLocalDescription(offer));
    });
  };

  const runTests = async () => {
    setResults([]);
    setTesting(true);

    // Test 1: STUN only
    const stunStats = await testTurnServer('STUN만 (Google)', [
      { urls: 'stun:stun.l.google.com:19302' },
    ]);
    log(`결과: host=${stunStats.host}, srflx=${stunStats.srflx}, relay=${stunStats.relay}`);
    log('');

    // Test 2: Self-hosted TURN (UDP)
    if (turnUrl) {
      const selfTurnStats = await testTurnServer(`자체 TURN (${turnUrl})`, [
        { urls: turnUrl, username: turnUser, credential: turnCred },
      ]);
      log(`결과: host=${selfTurnStats.host}, srflx=${selfTurnStats.srflx}, relay=${selfTurnStats.relay}`);
      if (selfTurnStats.relay === 0) {
        log('❌ 자체 TURN 서버에서 relay 후보 없음 - 서버 접근 불가!');
      } else {
        log('✅ 자체 TURN 서버 정상 작동!');
      }
      log('');

      // Test 3: Self-hosted TURN (TCP)
      const selfTurnTcpStats = await testTurnServer(`자체 TURN TCP (${turnUrl}?transport=tcp)`, [
        { urls: turnUrl.replace(':3478', ':3478?transport=tcp'), username: turnUser, credential: turnCred },
      ]);
      log(`결과: host=${selfTurnTcpStats.host}, srflx=${selfTurnTcpStats.srflx}, relay=${selfTurnTcpStats.relay}`);
      if (selfTurnTcpStats.relay === 0) {
        log('❌ 자체 TURN TCP에서 relay 후보 없음');
      } else {
        log('✅ 자체 TURN TCP 정상 작동!');
      }
      log('');
    } else {
      log('⚠️ NEXT_PUBLIC_TURN_SERVER_URL이 설정되지 않음 - 자체 TURN 테스트 건너뜀');
      log('');
    }

    // Test 4: Public TURN (openrelay)
    const publicTurnStats = await testTurnServer('공용 TURN (openrelay.metered.ca)', [
      {
        urls: [
          'turn:openrelay.metered.ca:80',
          'turn:openrelay.metered.ca:443',
          'turn:openrelay.metered.ca:443?transport=tcp',
        ],
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
    ]);
    log(`결과: host=${publicTurnStats.host}, srflx=${publicTurnStats.srflx}, relay=${publicTurnStats.relay}`);
    if (publicTurnStats.relay === 0) {
      log('❌ 공용 TURN에서도 relay 후보 없음');
    } else {
      log('✅ 공용 TURN 정상 작동!');
    }

    log('');
    log('=== 테스트 완료 ===');
    setTesting(false);
  };

  return (
    <div style={{ padding: 20, fontFamily: 'monospace', maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20, marginBottom: 16 }}>TURN 서버 연결 테스트</h1>
      
      <div style={{ marginBottom: 16, padding: 12, background: '#f0f0f0', borderRadius: 8 }}>
        <p><strong>자체 TURN:</strong> {turnUrl || '(미설정)'}</p>
        <p><strong>사용자:</strong> {turnUser || '(미설정)'}</p>
        <p><strong>비밀번호:</strong> {turnCred ? '****' : '(미설정)'}</p>
      </div>

      <button
        onClick={runTests}
        disabled={testing}
        style={{
          padding: '10px 24px',
          fontSize: 16,
          cursor: testing ? 'not-allowed' : 'pointer',
          background: testing ? '#ccc' : '#0070f3',
          color: 'white',
          border: 'none',
          borderRadius: 8,
          marginBottom: 16,
        }}
      >
        {testing ? '테스트 중...' : 'TURN 테스트 시작'}
      </button>

      <pre
        style={{
          background: '#1a1a2e',
          color: '#e0e0e0',
          padding: 16,
          borderRadius: 8,
          fontSize: 13,
          lineHeight: 1.5,
          overflow: 'auto',
          maxHeight: 600,
          whiteSpace: 'pre-wrap',
        }}
      >
        {results.length === 0
          ? '테스트 버튼을 눌러 TURN 서버 연결을 확인하세요.\n\n각 TURN 서버에 대해:\n- host: 로컬 네트워크 후보\n- srflx: STUN 반사 후보 (공인 IP)\n- relay: TURN 릴레이 후보 ← 이것이 중요!\n\nrelay 후보가 있어야 NAT 뒤에서 WebRTC 연결이 가능합니다.'
          : results.join('\n')}
      </pre>
    </div>
  );
}
