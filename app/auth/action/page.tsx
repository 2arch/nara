'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { auth } from '@/app/firebase';
import { applyActionCode, checkActionCode } from 'firebase/auth';

function AuthActionContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Processing...');

  useEffect(() => {
    const handleAuthAction = async () => {
      const actionMode = searchParams.get('mode');
      const actionCode = searchParams.get('oobCode');

      setMode(actionMode);

      if (!actionCode) {
        setStatus('error');
        setMessage('Invalid action link');
        return;
      }

      try {
        // Check what kind of action this is
        const info = await checkActionCode(auth, actionCode);

        switch (actionMode) {
          case 'signIn':
            // For email link sign-in, redirect to verify page
            // which already handles the full sign-in flow
            const continueUrl = searchParams.get('continueUrl') || '/auth/verify';
            router.push(`${continueUrl}${window.location.search}`);
            break;

          case 'resetPassword':
            setStatus('success');
            setMessage('Password reset link verified');
            // You can redirect to a password reset form here
            break;

          case 'verifyEmail':
            await applyActionCode(auth, actionCode);
            setStatus('success');
            setMessage('Email verified successfully!');
            setTimeout(() => router.push('/'), 2000);
            break;

          default:
            setStatus('error');
            setMessage('Unknown action type');
        }
      } catch (error: any) {
        setStatus('error');
        setMessage(error.message || 'Action failed');
      }
    };

    handleAuthAction();
  }, [searchParams, router]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      backgroundColor: '#F8F8F0',
      color: '#162400',
      fontFamily: 'IBM Plex Mono, monospace',
      padding: '20px'
    }}>
      <div style={{
        textAlign: 'center',
        maxWidth: '500px',
        background: 'white',
        padding: '40px',
        borderRadius: '8px'
      }}>
        {status === 'loading' && (
          <>
            <div style={{
              fontSize: '48px',
              marginBottom: '20px',
              animation: 'pulse 2s ease-in-out infinite'
            }}>
              ⏳
            </div>
            <h1 style={{ fontSize: '24px', marginBottom: '10px' }}>
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
            <h1 style={{ fontSize: '24px', marginBottom: '10px' }}>
              {message}
            </h1>
            <p style={{ fontSize: '14px', opacity: 0.7 }}>
              Redirecting...
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <div style={{
              fontSize: '48px',
              marginBottom: '20px',
              color: '#FF0000'
            }}>
              ✗
            </div>
            <h1 style={{ fontSize: '24px', marginBottom: '10px' }}>
              Action Failed
            </h1>
            <p style={{ fontSize: '14px', marginBottom: '20px' }}>
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

export default function AuthActionPage() {
  return (
    <Suspense fallback={
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: '#F8F8F0',
        fontFamily: 'IBM Plex Mono, monospace'
      }}>
        Loading...
      </div>
    }>
      <AuthActionContent />
    </Suspense>
  );
}
