'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { completeSignInWithEmailLink } from '@/app/firebase';

export default function VerifyEmailPage() {
  const router = useRouter();
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [message, setMessage] = useState('Verifying your email link...');

  // Set background color on mount
  useEffect(() => {
    document.body.style.backgroundColor = '#162400';
    document.body.style.color = '#F0FF6A';
    return () => {
      document.body.style.backgroundColor = '';
      document.body.style.color = '';
    };
  }, []);

  useEffect(() => {
    const verifyEmailLink = async () => {
      try {
        const result = await completeSignInWithEmailLink();

        if (result.success && result.user) {
          setStatus('success');
          setMessage(result.isNewUser ? 'Account created successfully!' : 'Signed in successfully!');

          // Redirect to home after a brief delay
          setTimeout(() => {
            router.push('/');
          }, 1500);
        } else {
          setStatus('error');
          setMessage(result.error || 'Failed to verify email link');
        }
      } catch (error: any) {
        setStatus('error');
        setMessage(error.message || 'An error occurred during verification');
      }
    };

    verifyEmailLink();
  }, [router]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      backgroundColor: '#162400',
      color: '#F0FF6A',
      fontFamily: 'IBM Plex Mono, monospace',
      padding: '20px'
    }}>
      <div style={{
        textAlign: 'center',
        maxWidth: '500px'
      }}>
        {status === 'verifying' && (
          <>
            <div style={{
              fontSize: '48px',
              marginBottom: '20px',
              animation: 'pulse 2s ease-in-out infinite'
            }}>
              ⏳
            </div>
            <h1 style={{ fontSize: '24px', marginBottom: '10px', color: '#F0FF6A' }}>
              {message}
            </h1>
          </>
        )}

        {status === 'success' && (
          <>
            <div style={{
              fontSize: '48px',
              marginBottom: '20px'
            }}>
              ✓
            </div>
            <h1 style={{ fontSize: '24px', marginBottom: '10px', color: '#F0FF6A' }}>
              {message}
            </h1>
            <p style={{ fontSize: '14px', opacity: 0.7, color: '#F0FF6A' }}>
              Redirecting you to the homepage...
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <div style={{
              fontSize: '48px',
              marginBottom: '20px'
            }}>
              ✗
            </div>
            <h1 style={{ fontSize: '24px', marginBottom: '10px', color: '#F0FF6A' }}>
              Verification Failed
            </h1>
            <p style={{ fontSize: '14px', marginBottom: '20px', color: '#F0FF6A' }}>
              {message}
            </p>
            <button
              onClick={() => router.push('/')}
              style={{
                backgroundColor: '#F0FF6A',
                color: '#162400',
                border: 'none',
                padding: '10px 20px',
                fontSize: '14px',
                fontFamily: 'IBM Plex Mono, monospace',
                cursor: 'pointer',
                borderRadius: '4px'
              }}
            >
              Return to Home
            </button>
          </>
        )}
      </div>

      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
