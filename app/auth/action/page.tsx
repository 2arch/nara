"use client";
import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { auth } from '../../firebase';
import { confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';

function AuthActionContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [mode, setMode] = useState<string | null>(null);
  const [oobCode, setOobCode] = useState<string | null>(null);
  const [email, setEmail] = useState<string>('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const modeParam = searchParams.get('mode');
    const codeParam = searchParams.get('oobCode');
    
    setMode(modeParam);
    setOobCode(codeParam);

    // Verify the code and get the email
    if (modeParam === 'resetPassword' && codeParam) {
      verifyPasswordResetCode(auth, codeParam)
        .then((email) => {
          setEmail(email);
          setLoading(false);
        })
        .catch((error) => {
          console.error('Invalid or expired reset code:', error);
          setError('This password reset link is invalid or has expired.');
          setLoading(false);
        });
    } else {
      setError('Invalid request');
      setLoading(false);
    }
  }, [searchParams]);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    if (!oobCode) {
      setError('Invalid reset code');
      return;
    }

    setIsProcessing(true);
    setError('');

    try {
      await confirmPasswordReset(auth, oobCode, newPassword);
      setSuccess(true);
      
      // Redirect to home page after 2 seconds
      setTimeout(() => {
        router.push('/');
      }, 2000);
    } catch (error: any) {
      console.error('Password reset error:', error);
      setError(error.message || 'Failed to reset password. Please try again.');
      setIsProcessing(false);
    }
  };

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: '#F8F8F0',
        fontFamily: 'IBM Plex Mono, monospace'
      }}>
        <div>Loading...</div>
      </div>
    );
  }

  if (success) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: '#F8F8F0',
        fontFamily: 'IBM Plex Mono, monospace'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>✓</div>
          <div style={{ fontSize: '18px', marginBottom: '10px' }}>Password reset successfully!</div>
          <div style={{ fontSize: '14px', color: '#666' }}>Redirecting to home page...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      backgroundColor: '#F8F8F0',
      fontFamily: 'IBM Plex Mono, monospace',
      padding: '20px'
    }}>
      <div style={{
        maxWidth: '400px',
        width: '100%',
        backgroundColor: 'white',
        padding: '40px',
        borderRadius: '8px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
      }}>
        <h1 style={{ marginBottom: '10px', fontSize: '24px' }}>Reset Password</h1>
        {email && (
          <p style={{ marginBottom: '30px', color: '#666', fontSize: '14px' }}>
            for {email}
          </p>
        )}

        {error ? (
          <div style={{
            padding: '15px',
            backgroundColor: '#fee',
            color: '#c00',
            borderRadius: '4px',
            marginBottom: '20px',
            fontSize: '14px'
          }}>
            {error}
          </div>
        ) : (
          <form onSubmit={handleResetPassword}>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>
                New Password
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={6}
                style={{
                  width: '100%',
                  padding: '12px',
                  fontSize: '14px',
                  border: '2px solid #ddd',
                  borderRadius: '4px',
                  fontFamily: 'IBM Plex Mono, monospace'
                }}
                placeholder="Enter new password"
              />
            </div>

            <div style={{ marginBottom: '30px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>
                Confirm Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                style={{
                  width: '100%',
                  padding: '12px',
                  fontSize: '14px',
                  border: '2px solid #ddd',
                  borderRadius: '4px',
                  fontFamily: 'IBM Plex Mono, monospace'
                }}
                placeholder="Confirm new password"
              />
            </div>

            <button
              type="submit"
              disabled={isProcessing}
              style={{
                width: '100%',
                padding: '14px',
                fontSize: '16px',
                backgroundColor: isProcessing ? '#ccc' : '#000',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: isProcessing ? 'not-allowed' : 'pointer',
                fontFamily: 'IBM Plex Mono, monospace'
              }}
            >
              {isProcessing ? 'Resetting...' : 'Reset Password'}
            </button>
          </form>
        )}
      </div>
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
        <div>Loading...</div>
      </div>
    }>
      <AuthActionContent />
    </Suspense>
  );
}