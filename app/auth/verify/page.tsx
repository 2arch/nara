'use client';

import { useEffect, useState } from 'react';
import { completeSignInWithEmailLink } from '@/app/firebase';

export default function VerifyEmailPage() {
  const [message, setMessage] = useState('verifying...');

  useEffect(() => {
    const verifyEmailLink = async () => {
      try {
        const result = await completeSignInWithEmailLink();

        if (result.success && result.user) {
          setMessage('you are now verified. you may close this tab.');
        } else {
          setMessage(result.error || 'verification failed');
        }
      } catch (error: any) {
        setMessage(error.message || 'verification failed');
      }
    };

    verifyEmailLink();
  }, []);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      fontFamily: 'IBM Plex Mono, monospace',
      fontSize: '16px'
    }}>
      {message}
    </div>
  );
}
