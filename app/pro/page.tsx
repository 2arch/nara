'use client';

import { useState, useEffect } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, getUserProfile, type MembershipTier } from '@/app/firebase';
import { useRouter } from 'next/navigation';

export default function ProPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [userProfile, setUserProfile] = useState<{ membership: MembershipTier } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      setLoading(false);
      
      if (user) {
        const profile = await getUserProfile(user.uid);
        if (profile) {
          setUserProfile({ membership: profile.membership });
        }
      }
    });
    
    return () => unsubscribe();
  }, []);

  const handleSubscribe = async () => {
    if (!user) {
      router.push('/');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          plan: 'pro',
          interval: 'monthly',
          userId: user.uid,
        }),
      });

      const data = await response.json();
      
      if (data.url) {
        window.location.href = data.url;
      } else {
        console.error('Failed to create checkout session:', data.error);
      }
    } catch (error) {
      console.error('Error creating checkout session:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center font-mono">
        <div>Loading...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center font-mono">
        <div className="text-center">
          <h1 className="text-2xl mb-4">Sign in required</h1>
          <button 
            onClick={() => router.push('/')}
            className="px-4 py-2 border border-white hover:bg-white hover:text-black transition-colors"
          >
            Go to Sign In
          </button>
        </div>
      </div>
    );
  }

  const isPro = userProfile?.membership === 'pro';

  return (
    <div className="min-h-screen bg-black text-white p-8 font-mono">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-4xl mb-8">💎 Nara Pro</h1>
        
        {isPro ? (
          <div className="border border-green-500 p-6 mb-8">
            <h2 className="text-2xl text-green-500 mb-4">✓ You're already Pro!</h2>
            <p className="mb-4">You have unlimited AI operations and access to all Pro features.</p>
            <button 
              onClick={() => router.push('/')}
              className="px-4 py-2 border border-white hover:bg-white hover:text-black transition-colors"
            >
              Return to Nara
            </button>
          </div>
        ) : (
          <div className="border border-white p-6 mb-8">
            <div className="text-center mb-6">
              <div className="text-6xl mb-4">$7.99</div>
              <div className="text-lg text-gray-300">per month</div>
            </div>
            
            <div className="space-y-4 mb-8">
              <div className="flex items-center">
                <span className="text-green-500 mr-3">✓</span>
                <span>Unlimited AI operations</span>
              </div>
              <div className="flex items-center">
                <span className="text-green-500 mr-3">✓</span>
                <span>Priority support</span>
              </div>
              <div className="flex items-center">
                <span className="text-green-500 mr-3">✓</span>
                <span>Advanced features</span>
              </div>
              <div className="flex items-center">
                <span className="text-green-500 mr-3">✓</span>
                <span>Cancel anytime</span>
              </div>
            </div>
            
            <button 
              onClick={handleSubscribe}
              disabled={isLoading}
              className="w-full py-4 bg-white text-black font-bold hover:bg-gray-200 transition-colors disabled:opacity-50"
            >
              {isLoading ? 'Processing...' : 'Subscribe to Pro'}
            </button>
          </div>
        )}
        
        <div className="text-center text-gray-400">
          <p className="mb-2">Free tier: 5 AI operations per day</p>
          <p>Pro tier: Unlimited AI operations</p>
        </div>
      </div>
    </div>
  );
}