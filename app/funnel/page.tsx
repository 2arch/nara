"use client";

import React, { useState } from 'react';
import FirebaseAuth from './auth';
import StripePayment from './sales';
import Slideshow from './slideshow';
import { useRouter } from 'next/navigation';

const FunnelPage = () => {
  const [currentStep, setCurrentStep] = useState<'slideshow' | 'auth' | 'sales' | 'redirecting'>('slideshow');
  const router = useRouter();

  const handleSlideshowComplete = () => {
    setCurrentStep('auth');
  };

  const handleSlideshowSkip = () => {
    // Skip directly to home without premium upgrade
    router.push('/home');
  };

  const handleAuthComplete = () => {
    setCurrentStep('sales');
  };

  const handleSalesComplete = () => {
    setCurrentStep('redirecting');
    setTimeout(() => {
      router.push('/home');
    }, 2000);
  };

  const handleSkip = () => {
    setCurrentStep('redirecting');
    setTimeout(() => {
      router.push('/home');
    }, 2000);
  };

  if (currentStep === 'redirecting') {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="mb-4">
            <svg className="animate-spin h-12 w-12 text-blue-600 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
          <p className="text-xl text-gray-800 font-mono">Redirecting...</p>
        </div>
      </div>
    );
  }

  if (currentStep === 'slideshow') {
    return <Slideshow onComplete={handleSlideshowComplete} onSkip={handleSlideshowSkip} />;
  }

  return (
    <div className="min-h-screen bg-white relative">
      {currentStep === 'sales' && (
        <button 
          onClick={handleSkip}
          className="absolute top-4 right-4 text-sm text-gray-600 underline hover:no-underline"
        >
          Skip
        </button>
      )}
      
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center max-w-md w-full px-4">
          {currentStep === 'auth' ? (
            <div className="text-center w-full">
              <h1 className="text-2xl mb-8 font-mono text-black">Create Your Account</h1>
              <FirebaseAuth onAuthComplete={handleAuthComplete} />
              <button 
                onClick={() => router.push('/')}
                className="mt-4 text-sm text-gray-600 underline hover:no-underline"
              >
                Back to Home
              </button>
            </div>
          ) : (
            <div className="text-center w-full">
              <h1 className="text-2xl mb-4 font-mono text-black">Upgrade to Premium</h1>
              <p className="mb-8 text-gray-600">Unlock full access to Nara intelligence platform</p>
              <StripePayment onSalesComplete={handleSalesComplete} />
              <button 
                onClick={() => router.push('/')}
                className="mt-4 text-sm text-gray-600 underline hover:no-underline"
              >
                Back to Home
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FunnelPage;