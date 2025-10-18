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

  // Render nothing - just redirect silently
  return null;
}

export default function AuthActionPage() {
  return (
    <Suspense fallback={null}>
      <AuthActionContent />
    </Suspense>
  );
}
